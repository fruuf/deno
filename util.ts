import {
  asyncIteratorFrom,
  iteratorFrom,
  wrapAsyncIterator,
  wrapIterator,
} from "https://deno.land/x/iterator_helpers@v0.1.2/mod.ts";
import { assert } from "jsr:@std/assert";
import { delay } from "jsr:@std/async";
import { stripAnsiCode } from "jsr:@std/fmt/colors";
import { firstValueFrom, merge, Observable, timer } from "npm:rxjs";
import { logger } from "./log.ts";
import { shutdownStream } from "./service.ts";

export { asyncIteratorFrom, iteratorFrom, wrapAsyncIterator, wrapIterator };

/**
 * Generates a random UUID using the Web Crypto API.
 */
export function uuid() {
  return crypto.randomUUID();
}

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json | undefined };

/**
 * Type guard that checks if a value is not null or undefined.
 */
export function isValue<T>(value: T | undefined | null | void): value is T {
  return value !== undefined && value !== null;
}

/**
 * Exhaustive type checking helper that throws when reached.
 */
export function checkNever(item: never): never {
  logger.warn("check_never", { item: typeof item });
  assert(false);
}

/**
 * Waits for specified duration, optionally ending early on shutdown.
 */
export async function wait(duration: number, immediateOnShutdown = false) {
  if (duration <= 0) {
    return;
  }
  if (!immediateOnShutdown) {
    return delay(duration);
  }
  await firstValueFrom(merge(timer(duration), shutdownStream));
}

/**
 * Executes a shell command and returns the output.
 */
export async function execP(
  command: string,
  options: Deno.CommandOptions = {},
) {
  const [program, ...args] = command.split(/\s+/);
  const cmd = new Deno.Command(program, {
    ...options,
    args: [...args, ...(options.args ?? [])],
  });

  const { stdout, stderr, ...rest } = await cmd.output();

  return {
    stdout: stripAnsiCode(decoder.decode(stdout)).trim(),
    stderr: stripAnsiCode(decoder.decode(stderr)).trim(),
    ...rest,
  };
}

const decoder = new TextDecoder();
/**
 * Runs a command and returns stdout as a trimmed string.
 */
export async function runP(command: string, options = {}) {
  const { stdout, stderr, success, code } = await execP(command, options);
  if (success) {
    return stdout;
  }
  throw Error(stderr, { cause: { code } });
}

type RetryBackoffHandler = (attempt: number, error: unknown) => number;
type RetryBackoff = RetryBackoffHandler | number;

function parseRetryBackoff(retryBackoff: RetryBackoff): RetryBackoffHandler {
  if (typeof retryBackoff === "number") {
    return (attempt, error) => {
      if (attempt > retryBackoff) throw error;
      return 0;
    };
  }
  return retryBackoff;
}

/**
 * Wraps a function with retry logic and exponential backoff.
 */
export function retryHandler<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
  retryBackoff: RetryBackoff = 3,
) {
  const parsedRetry = parseRetryBackoff(retryBackoff);
  return (...args: Args) => {
    let attempt = 0;

    async function nextAttempt(): Promise<Result> {
      try {
        const result = await handler(...args);
        return result;
      } catch (e) {
        attempt += 1;
        const duration = parsedRetry(attempt, e);
        await delay(duration);
        return nextAttempt();
      }
    }

    return nextAttempt();
  };
}

/**
 * Executes a task with retry logic and exponential backoff.
 */
export function retryTask<Result>(
  task: () => Promise<Result> | Result,
  retryBackoff: RetryBackoff = 3,
): Promise<Result> {
  const handler = retryHandler(task, retryBackoff);
  return handler();
}

const randomStringChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function* randomStringIter(length: number) {
  for (let i = 0; i < length; i++) {
    const pos = Math.floor(Math.random() * randomStringChars.length);
    yield randomStringChars[pos];
  }
}
/**
 * Generates a random string of specified length using safe characters.
 */
export function randomString(length = 6) {
  return wrapIterator(randomStringIter(length)).toArray().join("");
}

export type UnwrapObservable<T> = T extends Observable<infer U> ? U : T;
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
export type UnwrapArray<T> = T extends Array<infer U> ? U : T;
export type UnwrapSet<T> = T extends Set<infer U> ? U : T;

export type Unwrap<T> = T extends (
  // deno-lint-ignore no-explicit-any
  ...args: any[]
) => Promise<Observable<infer A>> ? A
  // deno-lint-ignore no-explicit-any
  : T extends (...args: any[]) => Observable<infer B> ? B
  // deno-lint-ignore no-explicit-any
  : T extends (...args: any[]) => Promise<infer C> ? C
  // deno-lint-ignore no-explicit-any
  : T extends (...args: any[]) => infer D ? D
  : T extends Promise<Observable<infer E>> ? E
  : T extends Observable<infer F> ? F
  : T extends Promise<infer G> ? G
  : T;

export type EmptyRecord = Record<string, never>;
