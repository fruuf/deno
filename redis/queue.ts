import { repeatUntilShutdown } from "../service.ts";
import { normalizeKey } from "./multi.ts";
import { onClient } from "./redis.ts";
import { rzadd, rzpopmin } from "./sorted-set.ts";

export function redisQueue(
  clientName: string,
  name: string,
  handler: (
    value: string,
    createdAt: number,
    retry: () => Promise<void>,
  ) => Promise<void>,
  parallel = 1,
) {
  const redisKey = normalizeKey("queue", name);

  async function queueValue(value: string) {
    await rzadd(clientName, redisKey, [[Date.now(), value]], "NX");
  }

  onClient(clientName, () => {
    repeatUntilShutdown(redisKey, async () => {
      const [[value, createdAt] = []] = await rzpopmin(clientName, redisKey, 1);
      if (value && createdAt) {
        await handler(value, createdAt, () => queueValue(value));
        return 0;
      }
      return 250;
    }, parallel);
  });

  return queueValue;
}
