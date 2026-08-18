import { Key, resolveKey } from "../cache.ts";
import { SafeError } from "../error.ts";
import { logger } from "../log.ts";
import { normalizeKey, rdecrby, rexpire, rincrby, rttl } from "./multi.ts";

type RedisRateLimitHandlerOptionsType = {
  rollbackOnError: boolean;
  incrBy: number;
};

const validateRedisRateLimitHandlerOptions = (
  options: Partial<RedisRateLimitHandlerOptionsType> = {},
): RedisRateLimitHandlerOptionsType => {
  return {
    incrBy: 1,
    rollbackOnError: false,
    ...options,
  };
};

export class RateLimitError extends SafeError {
  constructor() {
    super("rateLimit", "rateLimit");
  }
}

export function redisRateLimitHandler<Args extends unknown[], Result>(
  clientName: string,
  name: string,
  duration: number,
  count: number,
  getKey: Key<Args>,
  handler: (...args: Args) => Promise<Result> | Result,
  options?: Partial<RedisRateLimitHandlerOptionsType>,
) {
  const { rollbackOnError, incrBy } = validateRedisRateLimitHandlerOptions(
    options,
  );
  const resolvedKey = resolveKey(getKey);

  return async (...args: Args) => {
    const redisKey = normalizeKey("rate-limit", name, resolvedKey(...args));
    const [currentCount, ttl] = await Promise.all([
      rincrby(clientName, redisKey, incrBy),
      rttl(clientName, redisKey),
    ]);

    if (ttl < 0) await rexpire(clientName, redisKey, duration);

    if (Number(currentCount) > count) {
      await rdecrby(clientName, redisKey, incrBy);
      logger.info("user_rate_limited", {
        name,
        duration,
        count,
        redisKey,
      });
      throw new RateLimitError();
    }

    try {
      return await handler(...args);
    } catch (e) {
      if (rollbackOnError) {
        await rdecrby(clientName, redisKey, incrBy);
      }
      throw e;
    }
  };
}
