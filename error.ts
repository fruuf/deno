import { logger } from "./log.ts";
import { meter, spanEvent, spanException } from "./metrics.ts";
import { isValue, randomString, Unwrap } from "./util.ts";

const errorCount = meter.createCounter("error_count");

/**
 * Base error class for application errors with telemetry.
 */
export class SafeError extends Error {
  errorType: string;
  constructor(errorType: string, message: string) {
    super(message);
    this.errorType = errorType;
    errorCount.add(1, { errorType });
  }
}

/**
 * Type guard to check if an error is a SafeError.
 */
export function isSafeError(e: unknown): e is SafeError {
  return e instanceof SafeError;
}

/**
 * Asserts that an error is a SafeError, throws if not.
 */
export function checkIsSafeError(e: unknown): asserts e is Error {
  if (isSafeError(e)) return;
  throw Error(`expected "${typeof e}" to be a safeError`);
}

function safeErrorValue(key: string, value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "undefined") {
    return value;
  }
  logger.warn("safe_error_value", {
    key,
    typeof: typeof value,
  });
  return null;
}

type SafeErrorValue = Unwrap<typeof safeErrorValue>;

function safeErrorEvent(error: SafeError) {
  checkIsSafeError(error);
  const { message, errorType, ...rest } = error;
  const next = Object.entries(rest).map(
    ([key, value]): [string, SafeErrorValue] => {
      const nextValue = safeErrorValue(key, value);
      return [key, nextValue];
    },
  );
  return { message, errorType, ...Object.fromEntries(next) };
}

/**
 * Type guard to check if a value is an Error instance.
 */
// deno-lint-ignore no-explicit-any
export function isError(e: any): e is Error {
  return e instanceof Error;
}

/**
 * Asserts that a value is an Error, throws if not.
 */
export function checkIsError(e: unknown): asserts e is Error {
  if (isError(e)) return;
  throw Error(`expected "${typeof e}" to be a error`);
}

/**
 * Creates a SafeError with the errorType as the message.
 */
export function createErrorMessage(errorType: string) {
  return new SafeError(errorType, errorType);
}

/**
 * Error thrown when input validation fails.
 */
export class InvalidError extends SafeError {
  constructor() {
    super("invalid", "invalid");
  }
}

/**
 * Error wrapper for unexpected errors with tracking ID.
 */
export class UnknownError extends SafeError {
  errorId: string;
  constructor(errorId: string) {
    super("unknown", "unknown");
    this.errorId = errorId;
  }
}

/**
 * Converts any error into a SafeError with logging and telemetry.
 */
export function errorHandler(
  error: unknown,
  errorContext?: Record<string, string>,
) {
  if ((error instanceof Error) === false) {
    logger.error("invalid_error", {
      ...errorContext,
      typeof: typeof error,
    });

    const nextError = new InvalidError();

    spanException(nextError);
    spanEvent("errorHandler", safeErrorEvent(nextError));
    return nextError;
  }

  if (isSafeError(error)) {
    spanException(error);
    spanEvent("errorHandler", safeErrorEvent(error));
    return error;
  }

  const errorId = randomString();

  const message = (error.stack ?? error.message).trim();

  logger.error("unknown_error", { ...errorContext, error: message, errorId });

  const nextError = new UnknownError(errorId);
  spanException(error);
  spanEvent("errorHandler", safeErrorEvent(nextError));
  return nextError;
}

export function swallowError<Args extends unknown[]>(
  handler: (...args: Args) => Promise<void> | void,
): (...args: Args) => Promise<void>;

export function swallowError<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result | void>;

export function swallowError<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
  defaultValue: Result,
): (...args: Args) => Promise<Result>;

/**
 * Wraps a function to catch errors and return a default value.
 */
export function swallowError<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
  defaultValue?: Result,
) {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (e) {
      const nextError = errorHandler(e);
      spanEvent("swallowError", safeErrorEvent(nextError));
      return defaultValue;
    }
  };
}

/**
 * Error thrown when a required resource is not found.
 */
export class NotFoundError extends SafeError {
  type: string;
  constructor(type: string) {
    super("notFound", `"${type}" notFound`);
    this.type = type;
  }
}

/**
 * Asserts a value exists, throws NotFoundError if null/undefined.
 */
export function checkIsValue<Value>(
  value: Value | undefined | null | void,
  type: string,
): asserts value is Value {
  if (!isValue(value)) {
    throw new NotFoundError(type);
  }
}

/**
 * Wraps a handler to ensure it returns a valid value.
 */
export function handlerCheckIsValue<Args extends unknown[], Value>(
  handler: (...args: Args) => Promise<Value | undefined | null | void>,
  type: string,
): (...args: Args) => Promise<Value> {
  return async (...args: Args) => {
    const result = await handler(...args);
    checkIsValue(result, type);
    return result;
  };
}

/**
 * Error thrown when an operation exceeds its timeout duration.
 */
export class TimeoutError extends SafeError {
  duration: number;
  constructor(duration: number) {
    super("timeout", "timeout");
    this.duration = duration;
  }
}

/**
 * Wraps a function with a timeout that throws TimeoutError.
 */
export function timeoutHandler<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
  duration: number,
) {
  return ((...args: Args) =>
    new Promise<Result>((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(
        () => {
          if (resolved) {
            return;
          }
          resolved = true;
          spanEvent("timeoutHandler", { duration });
          reject(new TimeoutError(duration));
        },
        duration,
      );
      Promise.resolve(handler(...args))
        .then((result) => {
          if (resolved) {
            return;
          }
          resolved = true;
          return resolve(result);
        }).catch((error) => {
          // lets make sure we handle the error of a promise that already timed out
          if (resolved) {
            errorHandler(error);
            return;
          }
          resolved = true;
          return reject(error);
        }).finally(() => {
          clearTimeout(timeout);
        });
    }));
}

/**
 * Creates a function that throws TimeoutError when duration exceeded.
 */
export function createCheckTimeout(duration: number) {
  const start = Date.now();
  return () => {
    const now = Date.now();
    if (now - start > duration) {
      spanEvent("createCheckTimeout", { duration });
      throw new TimeoutError(duration);
    }
  };
}
