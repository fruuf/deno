import { switchMap, takeUntil } from "npm:rxjs";
import { cacheObservable } from "../core.ts";
import { cleanupStream, withTestIdentifier } from "../service.ts";
import { ensureChannel } from "./channel.ts";

/**
 * Creates a normalized exchange name.
 */
export function exchangeName(name: string, exchange: string) {
  return withTestIdentifier(`${name}/${exchange}`);
}

/**
 * Ensures an exchange exists and returns the channel.
 */
export const ensureExchangeStream = cacheObservable(
  (name, exchange) =>
    ensureChannel().pipe(
      switchMap(async (channel) => {
        if (!channel) return null;
        await channel.assertExchange(exchangeName(name, exchange), "topic", {
          durable: true,
        });

        return channel;
      }),
      takeUntil(cleanupStream),
    ),
  exchangeName,
  10_000,
  1,
);
