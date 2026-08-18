import {
  catchError,
  EMPTY,
  first,
  share,
  switchMap,
  takeUntil,
  throwError,
} from "npm:rxjs";
import { asyncQueue, createAsyncObservable } from "../core.ts";
import { checkIsError, errorHandler, swallowError } from "../error.ts";
import { parseJSON, serializeJSON } from "../json.ts";
import { logger } from "../log.ts";
import { spanAttribute } from "../metrics.ts";
import { normalizeKey } from "../redis.ts";
import {
  completeHandlerBeforeShutdown,
  repeatUntilShutdown,
  shutdownStream,
  withTestIdentifier,
} from "../service.ts";
import { randomString, retryHandler, wait } from "../util.ts";
import { ensureChannel, ensureValue } from "./channel.ts";
import { ensureExchangeStream, exchangeName } from "./exchange.ts";
import { ensureDurableQueueStream, PRIORITY } from "./queue.ts";

/**
 * Creates RabbitMQ stream with read/write operations for typed messages.
 */
export function createRabbitStream<Message extends Record<string, unknown>>(
  name: string,
  exchange: string,
  streamArgs: (keyof Message)[] = [],
) {
  const streamArgsSet = new Set(streamArgs);

  function getPattern(
    partial: Partial<Message> | undefined,
    checkKeys: boolean,
  ) {
    if (checkKeys && partial) {
      Object.keys(partial).forEach((key) => {
        if (!streamArgsSet.has(key)) throw Error(`invalid option "${key}"`);
      });
    }

    const pattern = streamArgs
      .map((streamArg) => {
        if (!partial) return "*";
        if (partial[streamArg] === undefined) return "*";
        const part = String(partial[streamArg]);
        if (part.includes("*")) {
          throw Error(`partial "${String(streamArg)}" contains "*" (${part})`);
        }
        if (part.includes(".")) {
          throw Error(`partial "${String(streamArg)}" contains "." (${part})`);
        }
        return part;
      })
      .join(".");

    return pattern;
  }

  function getQueueName(queue: string, pattern: string) {
    const nextQueue = pattern ? `${queue}(${pattern})` : queue;
    return withTestIdentifier(`${name}/${exchange}/${nextQueue}`);
  }

  const ensureWriteItem = completeHandlerBeforeShutdown(
    asyncQueue(retryHandler(async (message: Message) => {
      const channel = await ensureValue(ensureExchangeStream(name, exchange));
      const routingKey = getPattern(message, false);
      const uint8Array = new TextEncoder().encode(serializeJSON(message));
      const buffer = Buffer.from(uint8Array);
      const written = channel.publish(
        exchangeName(name, exchange),
        routingKey,
        buffer,
        { priority: PRIORITY },
      );
      if (!written) {
        throw Error("buffer full");
      }
    }, (attempt, error) => {
      checkIsError(error);
      if (attempt <= 20) {
        logger.info("retry_write_message", {
          name,
          exchange,
          error: error.message,
          attempt,
        });
        return attempt * 100;
      }
      throw error;
    })),
  );

  return {
    read(partial: Partial<Message> = {}) {
      const pattern = getPattern(partial, true);

      return ensureExchangeStream(name, exchange).pipe(
        switchMap((channel) => {
          if (!channel) return EMPTY;
          return createAsyncObservable<Message>(async (observer, cleanup) => {
            const queue = randomString(16);
            await channel.assertQueue(queue, {
              exclusive: true,
            });

            cleanup(async () => {
              await channel.deleteQueue(queue);
            });

            await channel.bindQueue(
              queue,
              exchangeName(name, exchange),
              pattern,
            );

            cleanup(async () => {
              await channel.unbindQueue(
                queue,
                exchangeName(name, exchange),
                pattern,
              );
            });

            const { consumerTag } = await channel.consume(
              queue,
              (message) => {
                if (!message) return;
                const json = parseJSON<Message>(message.content.toString());
                observer.next(json);
              },
              { noAck: true },
            );

            cleanup(async () => {
              await channel.cancel(consumerTag);
            });
          });
        }),
        takeUntil(shutdownStream),
        share(),
      );
    },
    readQueue(queue: string, partial: Partial<Message> = {}) {
      const pattern = getPattern(partial, true);
      const key = getQueueName(queue, pattern);
      const symbol = Symbol("readQueue");

      return ensureDurableQueueStream(name, exchange, key, pattern).pipe(
        switchMap((channel) => {
          if (!channel) return EMPTY;
          return createAsyncObservable<Message>(async (observer, cleanup) => {
            const { consumerTag } = await channel.consume(
              key,
              (message) => {
                if (!message) return;
                const json = parseJSON<Message>(message.content.toString());
                observer.next(json);
              },
              { noAck: true },
            );

            cleanup(async () => {
              await channel.cancel(consumerTag);
            });

            const subscription = shutdownStream
              .pipe(
                first(),
                switchMap(async () => {
                  await channel.cancel(consumerTag);
                  await wait(1000);
                  observer.error(symbol);
                }),
              )
              .subscribe();

            cleanup(() => subscription.unsubscribe());
          });
        }),
        catchError((e) => {
          if (e === symbol) return EMPTY;
          return throwError(() => e);
        }),
        share(),
      );
    },
    pullQueue(
      queue: string,
      handler: (message: Message, retries: number) => Promise<void> | void,
      partial: Partial<Message> = {},
      concurrency = 100,
    ) {
      const pattern = getPattern(partial, true);
      const key = getQueueName(queue, pattern);

      repeatUntilShutdown(
        normalizeKey("pull", key),
        swallowError(async () => {
          const ackChannel = await ensureValue(ensureChannel());
          const queueChannel = await ensureValue(
            ensureDurableQueueStream(name, exchange, key, pattern),
          );

          const message = await queueChannel.get(key, { noAck: false });
          if (!message) return 1_000;

          try {
            const json = parseJSON<Message>(message.content.toString());
            spanAttribute(
              "queue_priority",
              message.properties.priority ?? PRIORITY,
            );
            await handler(
              json,
              PRIORITY - (message.properties.priority ?? PRIORITY),
            );
            ackChannel.ack(message);
          } catch (e) {
            const error = errorHandler(e);
            const priority = message.properties.priority ?? PRIORITY;
            const nextPriority = Math.max(priority - 1, 0);

            if (nextPriority === 0) {
              logger.warn("rabbitmq_handler_failed_retries", {
                name,
                exchange,
                queue,
                pattern,
                retries: PRIORITY - priority,
                error: error.message,
              });
            } else {
              logger.info("rabbitmq_handler_failed", {
                name,
                exchange,
                queue,
                pattern,
                retries: PRIORITY - priority,
                error: error.message,
              });
            }

            ackChannel.nack(message, false, false);
            ackChannel.sendToQueue(
              key,
              message.content,
              { priority: Math.max(priority - 1, 0) },
            );

            return nextPriority === 0 ? 1_000 : 0;
          }

          try {
            const info = await ackChannel.checkQueue(key);
            spanAttribute("queue_messages", info.messageCount);
            spanAttribute("queue_consumers", info.consumerCount);
          } catch (e) {
            errorHandler(e);
          }
          return 0;
        }, 1_000),
        concurrency,
      );
    },
    async deleteQueue(queue: string, partial: Partial<Message> = {}) {
      const channel = await ensureValue(ensureExchangeStream(name, exchange));
      const pattern = getPattern(partial, true);
      const key = getQueueName(queue, pattern);
      return channel.deleteQueue(key);
    },
    writeItem(message: Message) {
      return ensureWriteItem(message);
    },
    async writeItems(messages: Message[]) {
      await Promise.all(messages.map(ensureWriteItem));
    },
  };
}
