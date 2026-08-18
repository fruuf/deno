import { swallowError, timeoutHandler } from "../error.ts";
import { repeatUntilShutdown, shutdownStream } from "../service.ts";
import { normalizeKey, rdel, rexpire, rget, rset } from "./multi.ts";
import { onClient } from "./redis.ts";

export function redisRepeat(
  clientName: string,
  name: string,
  handler: (isShutdown: () => boolean) => Promise<number>,
  timeout = 10000,
) {
  let isShutdown = false;
  shutdownStream.subscribe(() => {
    isShutdown = true;
  });

  const redisKey = normalizeKey("repeat", name);

  onClient(clientName, () => {
    repeatUntilShutdown(
      redisKey,
      swallowError(
        timeoutHandler(async () => {
          const [isRunning, scheduled] = await Promise.all([
            rget(clientName, normalizeKey(redisKey, "running")),
            rget(clientName, normalizeKey(redisKey, "scheduled")),
          ]);
          if (isRunning !== null) return 1000;
          if (scheduled !== null) {
            const now = Date.now();
            const nextScheduled = Number(scheduled);
            if (nextScheduled > now) return nextScheduled - now;
          }
          const [nextIsRunning] = await Promise.all([
            rget(clientName, normalizeKey(redisKey, "running")),
            rset(clientName, normalizeKey(redisKey, "running"), ""),
            rexpire(
              clientName,
              normalizeKey(redisKey, "running"),
              timeout * 2,
            ),
          ]);
          if (nextIsRunning !== null) return 1000;

          try {
            const start = Date.now();
            const duration = await handler(() => {
              if (isShutdown) return true;
              const now = Date.now();
              const duration = now - start;
              if (duration > timeout) return true;
              return false;
            });
            const nextSchedule = Date.now() + duration;

            await Promise.all([
              rdel(clientName, normalizeKey(redisKey, "running")),
              rset(
                clientName,
                normalizeKey(redisKey, "scheduled"),
                nextSchedule,
              ),
              rexpire(
                clientName,
                normalizeKey(redisKey, "scheduled"),
                duration,
              ),
            ]);
            return duration;
          } catch (e) {
            const duration = 10_000;
            const nextSchedule = Date.now() + duration;
            await Promise.all([
              rdel(clientName, normalizeKey(redisKey, "running")),
              rset(
                clientName,
                normalizeKey(redisKey, "scheduled"),
                nextSchedule,
              ),
              rexpire(
                clientName,
                normalizeKey(redisKey, "scheduled"),
                duration,
              ),
            ]);
            throw e;
          }
        }, timeout),
        timeout,
      ),
      1,
    );
  });
}
