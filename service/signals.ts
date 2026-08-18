import { after } from "jsr:@std/testing/bdd";
import {
  combineLatest,
  filter,
  firstValueFrom,
  map,
  mergeMap,
  shareReplay,
  startWith,
  Subject,
  take,
  tap,
  withLatestFrom,
} from "npm:rxjs";
import { errorHandler } from "../error.ts";
import { logger } from "../log.ts";
import {
  delayUntilStart,
  isHandlersCompleteStream,
  isSettled,
  isStartupCompleteStream,
  isTestModeEnabled,
  settleTasks,
  shutdownHandlerSubject,
} from "./lifecycle.ts";

type ShutdownSignal = {
  reason: string;
  code?: number;
};
// Subject for shutdown signals
export const shutdownSignalSubject = new Subject<ShutdownSignal>();

/**
 * Stream that emits shutdown signal and logs the shutdown event.
 */
export const shutdownStream = shutdownSignalSubject.pipe(
  take(1),
  map((signal) => ({ ...signal, code: signal.code ?? 0 })),
  tap((signal) =>
    logger.info("service_shutdown", {
      signal: signal.reason,
      code: signal.code,
    })
  ),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

/**
 * Stream that tracks shutdown state as boolean.
 */
export const isShutdownStream = shutdownStream.pipe(
  map(() => true),
  startWith(false),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

/**
 * Stream that emits when service cleanup is complete.
 */
export const cleanupStream = combineLatest([
  isStartupCompleteStream,
  isShutdownStream,
  isHandlersCompleteStream,
]).pipe(
  filter(([isStartup, isShutdown, isComplete]) =>
    isStartup && isShutdown && isComplete
  ),
  map(() => null),
  take(1),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

// Stream that tracks when cleanup handlers are complete
const isCleanupHandlersCompleteStream = shutdownHandlerSubject.pipe(
  delayUntilStart(),
  mergeMap((handler) => cleanupStream.pipe(take(1), map(() => handler))),
  settleTasks(),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

// Stream that determines when service can exit
const isExitStream = combineLatest([
  isShutdownStream,
  isStartupCompleteStream,
  isHandlersCompleteStream,
  isCleanupHandlersCompleteStream,
]).pipe(
  map((
    [
      isShutdown,
      isStartupComplete,
      isHandlersComplete,
      isCleanupHandlersComplete,
    ],
  ) =>
    isShutdown && isStartupComplete && isHandlersComplete &&
    isCleanupHandlersComplete
  ),
  isSettled(),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

/**
 * Stream that emits when service should exit.
 */
export const exitStream = isExitStream.pipe(
  filter((isExit) => isExit),
  map(() => null),
  take(1),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

/**
 * Returns current shutdown state as promise.
 */
export function isShutdown() {
  return firstValueFrom(isShutdownStream);
}

/**
 * Triggers programmatic shutdown of the service.
 */
export function triggerShutdown(code = 0) {
  shutdownSignalSubject.next({ reason: "SHUTDOWN", code });
}

// Register system signal listeners
Deno.addSignalListener("SIGTERM", () => {
  shutdownSignalSubject.next({ reason: "SIGTERM" });
});

Deno.addSignalListener("SIGINT", () => {
  shutdownSignalSubject.next({ reason: "SIGINT" });
});

globalThis.addEventListener("unhandledrejection", (e) => {
  errorHandler(e.reason);
  shutdownSignalSubject.next({ reason: "UNHANDLED_REJECTION", code: 1 });
  e.preventDefault();
});

globalThis.addEventListener("error", (e) => {
  shutdownSignalSubject.next({ reason: "UNHANDLED_ERROR", code: 1 });
  e.preventDefault();
});

// Handle exit behavior based on mode
if (isTestModeEnabled) {
  exitStream.subscribe();
  after(async () => {
    shutdownSignalSubject.next({ reason: "TEST_MODE" });
    await firstValueFrom(exitStream);
  });
} else {
  exitStream.pipe(
    withLatestFrom(shutdownStream),
  ).subscribe(([, signal]) => {
    Deno.exit(signal.code);
  });
}
