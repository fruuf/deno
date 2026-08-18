import { normalizeKey, rdel, rexists, rexpire, rset, rttl } from "./multi.ts";

export function redisLock(
  clientName: string,
  name: string,
  duration = 1000 * 60,
) {
  return {
    async lock(key: string) {
      const redisKey = normalizeKey("lock", name, key);

      if (await rexists(clientName, redisKey)) return false;

      const [exists, ttl] = await Promise.all([
        rexists(clientName, redisKey),
        rttl(clientName, redisKey),
        rset(clientName, redisKey, "1"),
        rexpire(clientName, redisKey, duration),
      ]);

      if (!exists) return true;
      await rexpire(clientName, redisKey, ttl > 0 ? ttl : duration);
      return false;
    },
    isLocked(key: string) {
      const redisKey = normalizeKey("lock", name, key);
      return rexists(clientName, redisKey);
    },
    async release(key: string) {
      const redisKey = normalizeKey("lock", name, key);
      await rdel(clientName, redisKey);
    },
  };
}
