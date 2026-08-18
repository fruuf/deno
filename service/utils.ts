import { EMPTY, interval, map, merge, of, takeUntil } from "npm:rxjs";
import { spanAttribute, withSpan } from "../metrics.ts";
import { wait } from "../util.ts";
import { completeHandlerBeforeShutdown } from "./handlers.ts";
import { isShutdown, shutdownStream } from "./signals.ts";

/**
 * Emits values on interval until shutdown signal received.
 */
export function intervalUntilShutdown(duration: number, initialEmit = false) {
  return merge(interval(duration), initialEmit ? of(null) : EMPTY).pipe(
    map(() => null),
    takeUntil(shutdownStream),
  );
}

/**
 * Calculates immediate timeout duration for task spawning optimization.
 */
async function immediateDuration() {
  const start = Date.now();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  const end = Date.now();
  return Math.max(0, end - start);
}

/**
 * Repeatedly executes handler until shutdown with concurrency control.
 */
export function repeatUntilShutdown(
  name: string,
  handler: () => Promise<number>,
  concurrency = 1,
) {
  let counter = 0;
  const wrappedHandler = withSpan(
    name,
    completeHandlerBeforeShutdown(async () => {
      const start = Date.now();
      spanAttribute("repeat_concurrency", counter);
      const timeout = await handler();
      spanAttribute("repeat_duration", Date.now() - start);
      spanAttribute("repeat_timeout", timeout);
      return timeout;
    }),
    true,
  );

  const nextHandler = async () => {
    if (await isShutdown()) return;
    if (counter >= concurrency) return;
    counter += 1;
    const timeout = await wrappedHandler();
    counter -= 1;

    // No delay means spawn concurrent tasks
    if (timeout === 0) {
      const duration = await immediateDuration();
      // Protect process from excessive task spawning
      if (duration < 100) {
        nextHandler();
        nextHandler();
        return;
      }
    }

    // Another task running with delay, close this one
    if (counter > 0) return;

    // Wait delay time and spawn another task
    await wait(timeout, true);
    nextHandler();
  };
  nextHandler();

  return () => ({ concurrency: counter });
}
