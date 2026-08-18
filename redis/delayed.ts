import { redisCache } from "./cache.ts";
import { redisLock } from "./lock.ts";
import { normalizeKey } from "./multi.ts";
import { redisScheduler } from "./scheduler.ts";

export function redisDelayedHandler<Args, Result>(
  clientName: string,
  name: string,
  handler: (
    args: Args,
    result: Result | Error,
    identifier: string,
  ) => Promise<void>,
  timeout = 60_000,
) {
  const redisKey = normalizeKey("delayed-handler", name);
  const lockTimeout = timeout + 1000 * 60 * 60 * 24 * 30;
  const argsTimeout = timeout + 1000 * 60 * 60 * 24 * 7;
  const executeLock = redisLock(clientName, redisKey, lockTimeout);
  const argsCache = redisCache<Args>(clientName, redisKey);
  const timeoutScheduler = redisScheduler(
    clientName,
    redisKey,
    (identifier: string) => resolve(identifier, Error("timeout")),
  );

  async function schedule(identifier: string, args: Args) {
    if (await executeLock.isLocked(identifier)) return;

    await Promise.all([
      argsCache.set(identifier, args, argsTimeout),
      timeoutScheduler.scheduleIdentifier(timeout, identifier, identifier),
    ]);
  }

  async function resolve(identifier: string, result: Result | Error) {
    if (!(await argsCache.exists(identifier))) return;
    if (!(await executeLock.lock(identifier))) return;

    const [json] = await Promise.all([
      argsCache.get(identifier),
      argsCache.del(identifier),
      timeoutScheduler.unschedule(identifier),
    ]);

    await handler(json!, result, identifier);
  }

  return { schedule, resolve };
}
