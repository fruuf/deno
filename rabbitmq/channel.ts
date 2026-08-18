// @ts-types="npm:@types/amqplib"
import { Channel } from "npm:amqplib";
import {
  catchError,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  Observable,
  of,
  startWith,
  switchMap,
  takeUntil,
  timeout,
  timer,
} from "npm:rxjs";
import { cacheObservable, createAsyncObservable } from "../core.ts";
import { errorHandler } from "../error.ts";
import { cleanupStream } from "../service.ts";
import { isValue } from "../util.ts";
import { ensureConnection } from "./connection.ts";

/**
 * Creates a RabbitMQ channel from the current connection.
 */
const createChannel = () =>
  ensureConnection().pipe(
    switchMap((connection) => {
      if (!connection) return of(null);
      return createAsyncObservable<Channel>(async (observer, cleanup) => {
        const channel = await connection.createChannel();

        channel.on("error", (error: Error) => observer.error(error));
        channel.on("close", () => observer.error(Error("channel closed")));
        cleanup(() => channel.close());

        observer.next(channel);
      }).pipe(
        catchError((e, observable) => {
          errorHandler(e);
          return timer(5000).pipe(
            switchMap(() => observable),
            startWith(null),
          );
        }),
      );
    }),
    distinctUntilChanged(),
    takeUntil(cleanupStream),
  );

/**
 * Ensures a RabbitMQ channel is available and manages its lifecycle.
 */
export const ensureChannel = cacheObservable(createChannel, null, 0, 1);

/**
 * Ensures a value is available from the stream within timeout.
 */
export function ensureValue<Value>(stream: Observable<Value | null>) {
  return firstValueFrom(stream.pipe(filter(isValue), timeout(60_000)));
}
