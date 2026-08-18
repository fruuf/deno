import {
  defaultIfEmpty,
  ignoreElements,
  lastValueFrom,
  mergeMap,
  Observable,
} from "npm:rxjs";
import { bindSpan, withSpan } from "../metrics.ts";
import { handlerTaskSubject } from "./lifecycle.ts";

export type Handler = () => Promise<void> | void;

/**
 * Creates task spawner that binds spans and manages promise lifecycle.
 */
export function spawnTask<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
  nextTask: (task: Handler) => void,
) {
  return (...args: Args) => {
    const nextHander = bindSpan(handler);
    return new Promise<Result>((resolve, reject) =>
      nextTask(() => Promise.resolve(nextHander(...args)).then(resolve, reject))
    );
  };
}

/**
 * Wraps handler to ensure completion before shutdown with span tracking.
 */
export function completeHandlerBeforeShutdown<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result> {
  return spawnTask(
    handler,
    (task) => handlerTaskSubject.next(task),
  );
}

/**
 * Completes promise before shutdown using handler wrapper.
 */
export const completePromiseBeforeShutdown = completeHandlerBeforeShutdown(
  <Result>(promise: Promise<Result>) => promise,
);

/**
 * Subscribes to observable and blocks shutdown until completion.
 */
export function subscribeUntilComplete<Event>(
  observable: Observable<Event>,
  // deno-lint-ignore require-await
  handler: (event: Event) => Promise<void> = async () => undefined,
) {
  completePromiseBeforeShutdown(
    lastValueFrom(
      observable.pipe(
        mergeMap(withSpan("subscribeUntilComplete", handler, true)),
        ignoreElements(),
        defaultIfEmpty(undefined),
      ),
    ),
  );
}
