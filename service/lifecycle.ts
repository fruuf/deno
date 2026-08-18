import { encodeBase58 } from "jsr:@std/encoding";
import { before } from "jsr:@std/testing/bdd";
import {
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  mergeMap,
  Observable,
  of,
  ReplaySubject,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  timer,
} from "npm:rxjs";
import { swallowError, timeoutHandler } from "../error.ts";
import { createAsyncObservable } from "../rxjs/create-async-observable.ts";

/**
 * Determines if the current module is running in test mode.
 */
export const isTestModeEnabled = Deno.mainModule.endsWith("test.ts");

export const TEST_IDENTIFIER = encodeBase58(
  new Uint8Array(
    Array(20).fill(0).map(() => Math.floor(Math.random() * 8)),
  ),
).toLowerCase().substring(0, 6);

function randomPort(min = 1024, max = 65535): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const TEST_HTTP_PORT = randomPort();
export const TEST_SERVICE_PORT = randomPort();

export function withTestIdentifier(identifier: string) {
  if (!isTestModeEnabled) {
    return identifier;
  }
  return `${TEST_IDENTIFIER}_${identifier}`;
}

/**
 * Determines if the current environment is production mode.
 */
export const isProductionModeEnabled =
  Deno.env.get("NODE_ENV") === "production";

const beforeSubject = new ReplaySubject<null>(1);

/**
 * Delays stream emission until test mode starts.
 */
export function delayUntilStart<Item>() {
  if (!isTestModeEnabled) return (stream: Observable<Item>) => stream;
  return (stream: Observable<Item>) =>
    stream.pipe(
      mergeMap((item) => beforeSubject.pipe(map(() => item))),
    );
}

/**
 * Creates operator that detects when stream has settled after completion.
 */
export function isSettled() {
  return (stream: Observable<boolean>) =>
    stream.pipe(
      delayUntilStart(),
      distinctUntilChanged(),
      switchMap((isComplete) =>
        isComplete ? timer(1000).pipe(map(() => true)) : of(false)
      ),
      startWith(false),
      distinctUntilChanged(),
    );
}

/**
 * Creates operator that tracks when counter stream reaches zero sum.
 */
export function isZeroSum() {
  return (stream: Observable<number>) =>
    stream.pipe(
      scan((sum, count) => sum + count, 0),
      map((count) => count === 0),
      startWith(true),
      distinctUntilChanged(),
    );
}

/**
 * Combines zero sum tracking with settlement detection.
 */
export function isSettledZeroSum() {
  return (stream: Observable<number>) => stream.pipe(isZeroSum(), isSettled());
}

/**
 * Processes tasks and tracks their completion for settlement.
 */
export function settleTasks() {
  return (stream: Observable<Handler>) =>
    stream.pipe(
      mergeMap((handler) =>
        createAsyncObservable<number>(async (observer) => {
          observer.next(1);
          await handler();
          observer.next(-1);
          observer.complete();
        })
      ),
      isSettledZeroSum(),
    );
}

export type Handler = () => Promise<void> | void;

// Subjects for managing different types of handlers
export const handlerTaskSubject = new Subject<Handler>();
export const startupHandlerSubject = new Subject<Handler>();
export const shutdownHandlerSubject = new Subject<Handler>();

// Stream that tracks when all handler tasks are complete
export const isHandlersCompleteStream = handlerTaskSubject.pipe(
  delayUntilStart(),
  settleTasks(),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

// Stream that tracks when startup handlers are complete
export const isStartupCompleteStream = startupHandlerSubject.pipe(
  delayUntilStart(),
  settleTasks(),
  shareReplay({ refCount: true, bufferSize: 1 }),
);

/**
 * Adds handler to run during service startup with timeout protection.
 */
export function addStartupSetupHandler(
  startupHandler: Handler,
  timeout = 300_000,
) {
  startupHandlerSubject.next(
    swallowError(timeoutHandler(startupHandler, timeout)),
  );
}

/**
 * Adds handler to run during service shutdown with timeout protection.
 */
export function addShutdownCleanupHandler(
  shutdownHandler: Handler,
  timeout = 300_000,
) {
  shutdownHandlerSubject.next(
    swallowError(timeoutHandler(shutdownHandler, timeout)),
  );
}

// Initialize test mode lifecycle if needed
if (isTestModeEnabled) {
  before(async () => {
    beforeSubject.next(null);
    await firstValueFrom(isStartupCompleteStream.pipe(filter(Boolean)));
  });
}
