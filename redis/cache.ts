import { cacheTimeout, Key, resolveKey } from "../cache.ts";
import { errorHandler, SafeError } from "../core.ts";
import { createCheckTimeout, timeoutHandler } from "../error.ts";
import { parseJSON, serializeJSON } from "../json.ts";
import { wait } from "../util.ts";
import { redisLock } from "./lock.ts";
import { normalizeKey, rdel, rexists, rexpire, rget, rset } from "./multi.ts";

export function redisCache<Value>(clientName: string, name: string) {
  return {
    async get(key: string) {
      const redisKey = normalizeKey("cache", name, key);
      const json = await rget(clientName, redisKey);
      if (json) return parseJSON(json) as Value;
      return null;
    },
    async set(key: string, value: Value, expire = 0): Promise<Value> {
      const redisKey = normalizeKey("cache", name, key);
      await Promise.all([
        rset(clientName, redisKey, serializeJSON(value)),
        expire > 0 ? rexpire(clientName, redisKey, expire) : null,
      ]);
      return value;
    },
    del(key: string) {
      const redisKey = normalizeKey("cache", name, key);
      return rdel(clientName, redisKey);
    },
    exists(key: string) {
      const redisKey = normalizeKey("cache", name, key);
      return rexists(clientName, redisKey);
    },
  };
}

type HandlerCache<Value> =
  | { success: true; value: Value }
  | { success: false; errorMessage: string; errorType: string };

export function redisCacheHandler<Args extends unknown[], Value>(
  clientName: string,
  name: string,
  duration: number,
  getKey: Key<Args>,
  handler: (...handlerArgs: Args) => Promise<Value> | Value,
  options?: { cacheSafeError?: boolean; handlerTimeout?: number },
) {
  const redisKey = normalizeKey("cache-handler", name);
  const resolvedKey = resolveKey(getKey);
  const cache = redisCache<HandlerCache<Value>>(clientName, redisKey);
  const handlerTimeout = options?.handlerTimeout ?? 60_000;
  const lock = redisLock(clientName, redisKey, handlerTimeout);
  const nextHandler = timeoutHandler(handler, handlerTimeout);

  async function executeHandler(
    checkTimeout: () => void,
    ...args: Args
  ): Promise<Value> {
    const key = resolvedKey(...args);
    const result = await cache.get(key);
    if (result?.success) {
      return result.value;
    }
    if (result?.success === false) {
      throw new SafeError(result.errorType, result.errorMessage);
    }
    if (!(await lock.lock(key))) {
      checkTimeout();
      await wait(500);
      return executeHandler(checkTimeout, ...args);
    }
    try {
      const value = await nextHandler(...args);
      await Promise.all([
        cache.set(key, { success: true, value }, duration),
        lock.release(key),
      ]);
      return value;
    } catch (e) {
      const handledError = errorHandler(e);

      if (options?.cacheSafeError) {
        await cache.set(
          key,
          {
            success: false,
            errorMessage: handledError.message,
            errorType: handledError.errorType,
          },
          duration,
        );
      }
      await lock.release(key);
      throw handledError;
    }
  }
  return cacheTimeout(
    resolvedKey,
    (...args) => executeHandler(createCheckTimeout(handlerTimeout), ...args),
    0,
  );
}
