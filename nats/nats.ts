import { withoutAll } from "jsr:@std/collections";
import { connect as natsConnect } from "npm:@nats-io/transport-node";
import { defer, Observable } from "npm:rxjs";
import { filter, share } from "npm:rxjs/operators";
import { cacheHandler, cacheTimeout } from "../cache.ts";
import { configString } from "../config.ts";
import { errorHandler } from "../error.ts";
import { parseJSON, serializeJSON } from "../json.ts";
import { logger } from "../log.ts";
import { createAsyncObservable } from "../rxjs/create-async-observable.ts";
import {
  addShutdownCleanupHandler,
  shutdownStream,
  triggerShutdown,
} from "../service.ts";
import { withTestIdentifier } from "../service/lifecycle.ts";
import { Json, wait } from "../util.ts";
import { emitReadMetrics, emitWriteMetrics } from "./metrics.ts";

type StreamItem = Record<string, Json>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Returns the configured NATS hostname for connection */
export async function getNatsHostname() {
}

/** Encodes data to Uint8Array using JSON serialization for NATS transport */
export function encode<Data>(data: Data): Uint8Array {
  return encoder.encode(serializeJSON(data));
}

/** Decodes Uint8Array buffer to typed data using JSON deserialization */
export function decode<Data>(buffer: Uint8Array): Data {
  return parseJSON(decoder.decode(buffer));
}

/** Gets or creates a cached NATS client connection with auto-reconnect */
export const getClient = cacheTimeout(
  null,
  async () => {
    const HOST = configString(`nats_host`, "nats:4222");
    const server = `nats://$${HOST}`;
    const client = await natsConnect({
      servers: [HOST],
      reconnectTimeWait: 1000,
      maxReconnectAttempts: 3,
      pingInterval: 5000,
      maxPingOut: 3,
      timeout: 10000,
      name: Deno.hostname(),
    });

    logger.info("nats_client", {
      server: server,
      clientIp: client.info?.client_ip,
    });

    addShutdownCleanupHandler(async () => {
      await client.flush();
      await client.close();
      await wait(1000);
    });

    client.closed().then((e: Error | void) => {
      logger.info("nats_closed", {
        server,
        error: e ? e.message : "none",
      });
      if (e) errorHandler(e);
      triggerShutdown();
    });

    return client;
  },
  Infinity,
);

type Stream<Item extends StreamItem> = {
  read: (partial?: Partial<Item>) => Observable<Item>;
  readQueue: (queue: string, partial?: Partial<Item>) => Observable<Item>;
  writeItem: (data: Item) => Promise<Item>;
  writeItems: (data: Item[]) => Promise<Item[]>;
};

function parseArg(arg: unknown) {
  return String(arg).toLowerCase().replace(/[.*]/g, "-");
}

const streamChannelSet = new Set<string>();

/** Creates a typed NATS stream for pub/sub with observable pattern and queue groups */
export function createStream<Item extends StreamItem>(
  host: string,
  subject: string,
  streamArgs?: (keyof Item)[],
): Stream<Item> {
  const channel = withTestIdentifier(`stream/${host}/${subject}`);
  if (streamChannelSet.has(channel)) {
    throw new Error(`subject "${subject}" on host "${host}" already exists`);
  }
  streamChannelSet.add(channel);

  async function writeItem(item: Item) {
    const nats = await getClient();
    const message = encode(item);

    emitWriteMetrics({ subject, host, messageByteLength: message.byteLength });

    if (streamArgs) {
      const messageArgs = streamArgs
        .map((arg) => parseArg(item[arg]))
        .join(".");
      nats.publish(`${channel}.${messageArgs}`, message);
    } else {
      nats.publish(channel, message);
    }

    return item;
  }

  function writeItems(items: Item[]) {
    return Promise.all(items.map(writeItem));
  }

  const cachedRead = cacheHandler(
    (queue: string, readArgs: string[]) =>
      [queue, ...readArgs].map(String).join("|"),
    (cleanupCache, queue, readArgs) =>
      createAsyncObservable<Item>(async (observer, cleanupObserver) => {
        cleanupObserver(cleanupCache);
        const nats = await getClient();
        let nextChannel = channel;
        if (streamArgs) {
          const channelArgs = readArgs.join(".");
          nextChannel = `${channel}.${channelArgs}`;
        }

        (async () => {
          for await (const m of nats.status()) {
            switch (m.type) {
              case "error":
                logger.error("nats_client_error", {
                  error: m.error.message,
                  channel: nextChannel,
                });
                break;
              case "staleConnection":
                logger.warn("nats_client_stale_connection", {
                  channel: nextChannel,
                });
                break;
              case "disconnect":
                logger.warn("nats_client_disconnect", {
                  channel: nextChannel,
                });
                break;
              case "reconnect":
                logger.warn("nats_client_reconnect", {
                  channel: nextChannel,
                });
                break;
              default:
                break;
            }
          }
        })();

        const subscription = nats.subscribe(
          nextChannel,
          queue ? { queue } : {},
        );

        logger.debug("nats_subscribe", { nextChannel, queue });

        cleanupObserver(() => {
          logger.debug("nats_unsubscribe", { nextChannel, queue });
          return subscription.drain();
        });

        (async () => {
          for await (const message of subscription) {
            emitReadMetrics({
              subject,
              host,
              queue: queue || undefined,
              messageByteLength: message.data.byteLength,
              subPendingMessages: subscription.getPending(),
              subReceivedMessages: subscription.getReceived(),
              subProcessedMessages: subscription.getProcessed(),
            });
            observer.next(decode<Item>(message.data));
          }
          observer.complete();
        })().catch(observer.error);

        if (queue) {
          const shutdown = shutdownStream.subscribe(async () =>
            await subscription.drain()
          );

          cleanupObserver(() => {
            shutdown.unsubscribe();
          });
        }
      }).pipe(share()),
  );

  function read(queue: string, partial: Partial<Item>) {
    const readArgs = (streamArgs || []).map((arg) =>
      partial[arg] === undefined ? "*" : parseArg(partial[arg])
    );
    const filterArgs = withoutAll(Object.keys(partial), streamArgs || []);
    // const readArgs = (streamArgs || []).map(() => "*");
    // const filterArgs = _.keys(partial);

    const stream = defer(() => cachedRead(queue, readArgs));
    if (filterArgs.length === 0) return stream;
    return stream.pipe(
      filter((item) => filterArgs.every((arg) => item[arg] === partial[arg])),
    );
  }

  return {
    read: (partial = {}) => read("", partial),
    readQueue: (queue: string, partial = {}) => read(queue, partial),
    writeItem,
    writeItems,
  };
}
