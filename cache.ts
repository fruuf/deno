import { timeoutHandler } from "./error.ts";

export type Key<Args extends unknown[]> =
  | ((...args: Args) => string)
  | (keyof Args[0])[]
  | keyof Args[0]
  | null;

/**
 * Resolves a key definition into a function that generates cache keys.
 */
// deno-lint-ignore no-explicit-any
export function resolveKey<Args extends any[]>(
  key: Key<Args>,
): (...args: Args) => string {
  if (typeof key === "function") {
    return (...args: Args) => {
      const result = key(...args);
      if (Array.isArray(result)) {
        return result.join("/");
      }
      return result;
    };
  }

  if (Array.isArray(key)) {
    return (...[arg]: Args) => key.map((k) => arg[k]).join("/");
  }

  if (typeof key === "string" || typeof key === "number") {
    return (...[arg]: Args) => String(arg[key]);
  }

  if (key === null) {
    return () => "";
  }

  throw new Error(`invalid key "${String(key)}"`);
}

/**
 * Simple key function for string values.
 */
export function stringKey<Args extends [string, ...unknown[]]>(
  ...[key]: Args
): string {
  return key;
}

/**
 * Key function that converts numbers to strings.
 */
export function numberKey<Args extends [number, ...unknown[]]>(
  ...[key]: Args
): string {
  return String(key);
}

/**
 * Creates a cached version of a function with manual cleanup control.
 */
export function cacheHandler<Args extends unknown[], Result>(
  getKey: Key<Args>,
  handler: (cleanup: () => void, ...args: Args) => Result,
) {
  const cache = new Map<string, Result>();
  const resolvedKey = resolveKey(getKey);
  return (...args: Args) => {
    const key = resolvedKey(...args);

    if (cache.has(key)) return cache.get(key)! as Result;

    let cleanedUp = false;
    const cleanup = () => {
      cleanedUp = true;
      cache.delete(key);
    };
    const nextResult = handler(cleanup, ...args);
    if (!cleanedUp) {
      cache.set(key, nextResult);
    }
    return nextResult;
  };
}

/**
 * Creates a cached function with automatic timeout-based cleanup.
 */
export function cacheTimeout<Args extends unknown[], Result>(
  getKey: Key<Args>,
  handler: (...args: Args) => Promise<Result> | Result,
  duration = 0,
  timeout = Infinity,
) {
  const nextHandler = timeout !== Infinity
    ? timeoutHandler(handler, timeout)
    : handler;
  if (duration === 0) {
    return cacheHandler(
      getKey,
      async (cleanup, ...args) => {
        try {
          const result = await nextHandler(...args);
          queueMicrotask(cleanup);
          return result;
        } catch (e) {
          cleanup();
          throw e;
        }
      },
    );
  }

  return cacheHandler(
    getKey,
    async (cleanup, ...args) => {
      try {
        const result = await nextHandler(...args);

        if (duration < Infinity) {
          setTimeout(cleanup, duration);
        }
        return result;
      } catch (e) {
        cleanup();
        throw e;
      }
    },
  );
}
