import { Observable } from "npm:rxjs";
import { filter, mergeMap } from "npm:rxjs/operators";
import { Key, resolveKey } from "../cache.ts";
import { swallowError } from "../error.ts";
import { isValue } from "../util.ts";
import { normalizeKey, rexists, rexpire, rset } from "./multi.ts";

export function redisFilterEmitted<Event>(
  clientName: string,
  name: string,
  getKey: Key<[Event]>,
  expire = 1000 * 60 * 60 * 24,
) {
  const resolvedKey = resolveKey(getKey);
  return (stream: Observable<Event>) =>
    stream.pipe(
      mergeMap(
        swallowError(async (event) => {
          const redisKey = normalizeKey(
            "filter-emitted",
            name,
            resolvedKey(event),
          );

          const [exists] = await Promise.all([
            rexists(clientName, redisKey),
            rset(clientName, redisKey, "1"),
            rexpire(clientName, redisKey, expire),
          ]);

          if (exists) return null;

          return event;
        }),
      ),
      filter(isValue),
    );
}
