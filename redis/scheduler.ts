import { parseJSON, serializeJSON } from "../json.ts";
import { repeatUntilShutdown } from "../service.ts";
import { uuid } from "../util.ts";
import { normalizeKey, rdel, rexpire, rget, rset } from "./multi.ts";
import { onClient } from "./redis.ts";
import { rzadd, rzrangebyscore, rzrem } from "./sorted-set.ts";

export function redisScheduler<Args extends unknown[]>(
  clientName: string,
  name: string,
  handler: (...args: Args) => Promise<void> | void,
  parallel = 100,
  precision = 250,
) {
  const redisKey = normalizeKey("scheduler", name);

  onClient(clientName, () => {
    repeatUntilShutdown(redisKey, async () => {
      let identifier: string | null = null;
      let removed = 0;
      do {
        [[identifier] = [null]] = await rzrangebyscore(
          clientName,
          redisKey,
          0,
          Date.now(),
          1,
        );
        if (identifier === null) return precision;
        removed = await rzrem(clientName, redisKey, [identifier]);
      } while (removed === 0);

      const argsKey = normalizeKey(redisKey, "args", identifier);
      const [json] = await Promise.all([
        rget(clientName, argsKey),
        rdel(clientName, argsKey),
        rzrem(clientName, redisKey, [identifier]),
      ]);
      if (!json) return 0;
      const args = parseJSON<Args>(json);
      await handler(...args);
      return 0;
    }, parallel);
  });

  async function scheduleIdentifier(
    duration: number,
    identifier: string,
    ...args: Args
  ) {
    const time = Date.now() + duration;
    const argsKey = normalizeKey(redisKey, "args", identifier);
    await Promise.all([
      await rset(clientName, argsKey, serializeJSON(args)),
      await rexpire(clientName, argsKey, 1000 * 60 * 60 * 24 + duration),
      await rzadd(clientName, redisKey, [[time, identifier]]),
    ]);
  }

  async function schedule(duration: number, ...args: Args) {
    const identifier = uuid();
    await scheduleIdentifier(duration, identifier, ...args);
    return identifier;
  }

  async function unschedule(identifier: string) {
    const argsKey = normalizeKey(redisKey, "args", identifier);
    const [remove] = await Promise.all([
      rzrem(clientName, redisKey, [identifier]),
      rdel(clientName, argsKey),
    ]);
    return remove > 0;
  }

  return { schedule, scheduleIdentifier, unschedule };
}
