import { registerInstrumentations } from "npm:@opentelemetry/instrumentation";
import { IORedisInstrumentation } from "npm:@opentelemetry/instrumentation-ioredis";

registerInstrumentations({
  instrumentations: [new IORedisInstrumentation({})],
});

export { redisCache, redisCacheHandler } from "./redis/cache.ts";
export { redisDelayedHandler } from "./redis/delayed.ts";
export { redisFilterEmitted } from "./redis/filter-emitted.ts";
export { rllen, rlpop, rlpush, rlrange, rrpop, rrpush } from "./redis/list.ts";
export { redisLock } from "./redis/lock.ts";
export { redisMeasurement } from "./redis/measurement.ts";
export {
  normalizeKey,
  rdecr,
  rdecrby,
  rdel,
  rexists,
  rexpire,
  rflushdb,
  rget,
  rincr,
  rincrby,
  rincrbyfloat,
  rkeys,
  rset,
  rttl,
} from "./redis/multi.ts";
export { redisQueue } from "./redis/queue.ts";
export { RateLimitError, redisRateLimitHandler } from "./redis/rate-limit.ts";
export { getRedis, setupRedis } from "./redis/redis.ts";
export { redisRepeat } from "./redis/repeat.ts";
export { rsadd, rsmembers, rsrem } from "./redis/set.ts";
export {
  rzadd,
  rzcard,
  rzincrby,
  rzpopmax,
  rzpopmin,
  rzrange,
  rzrangebyscore,
  rzrank,
  rzrem,
  rzremrangebyscore,
  rzrevrange,
  rzscore,
} from "./redis/sorted-set.ts";
