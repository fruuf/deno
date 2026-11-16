import { distinctUntilChanged, switchMap, takeUntil } from "npm:rxjs";
import { cacheObservable } from "../core.ts";
import { cleanupStream, isTestModeEnabled } from "../service.ts";
import { ensureExchangeStream, exchangeName } from "./exchange.ts";

export const PRIORITY = 10;
// a failed message is retried once at the tail of its queue, then once per delay, then moved to the dead letter queue
export const RETRY_DELAYS = isTestModeEnabled
  ? [1_000, 1_000, 1_000, 1_000]
  : [5_000, 30_000, 300_000, 1_800_000];

export const retryQueueName = (queue: string, delay: number) =>
  `${queue}/retry/${delay}`;
export const failedQueueName = (queue: string) => `${queue}/failed`;

/**
 * Ensures a durable queue exists with the specified binding.
 */
export const ensureDurableQueueStream = cacheObservable(
  (name: string, exchange: string, queue: string, pattern: string) =>
    ensureExchangeStream(name, exchange).pipe(
      switchMap(async (channel) => {
        if (!channel) return null;

        await channel.assertQueue(queue, {
          durable: true,
          maxPriority: PRIORITY,
        });

        for (const delay of RETRY_DELAYS) {
          await channel.assertQueue(retryQueueName(queue, delay), {
            durable: true,
            messageTtl: delay,
            deadLetterExchange: "",
            deadLetterRoutingKey: queue,
          });
        }

        await channel.assertQueue(failedQueueName(queue), { durable: true });

        await channel.bindQueue(
          queue,
          exchangeName(name, exchange),
          pattern,
          { maxPriority: PRIORITY },
        );

        return channel;
      }),
      distinctUntilChanged(),
      takeUntil(cleanupStream),
    ),
  (name, exchange, queue, pattern) => `${name}/${exchange}/${queue}/${pattern}`,
  10_000,
  1,
);
