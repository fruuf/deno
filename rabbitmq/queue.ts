import { distinctUntilChanged, switchMap, takeUntil } from "npm:rxjs";
import { cacheObservable } from "../core.ts";
import { cleanupStream } from "../service.ts";
import { ensureExchangeStream, exchangeName } from "./exchange.ts";

export const PRIORITY = 10;

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
