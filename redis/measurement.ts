import { sumOf } from "jsr:@std/collections";
import { normalizeKey, rexpire } from "./multi.ts";
import { rzincrby, rzrange, rzrevrange, rzscore } from "./sorted-set.ts";

export function redisMeasurement(
  clientName: string,
  name: string,
  duration = 1000 * 60 * 60 * 24,
  steps = 10,
) {
  const redisKey = normalizeKey("measurement", name);

  async function write(key: string, value: number) {
    const countKey = normalizeKey(
      redisKey,
      String(Math.floor((Date.now() / duration) * steps)),
    );

    await Promise.all([
      rzincrby(clientName, countKey, key, value),
      rexpire(
        clientName,
        countKey,
        Math.ceil((duration / steps) * (steps + 2)),
      ),
    ]);
  }

  async function read(key: string) {
    const now = Date.now();
    const count = Math.floor((now / duration) * steps);
    const scores = await Promise.all(
      Array(steps + 1).fill(null).map((_, offset) => offset)
        .reverse()
        .map(async (offset) => {
          const offsetKey = normalizeKey(redisKey, String(count - offset));
          const score = await rzscore(
            clientName,
            offsetKey,
            key,
          );
          return score ?? 0;
        }),
    );

    const [partial, ...rest] = scores;

    const multiplier = 1 -
      (now - (count * duration) / steps) / (duration / steps);

    return sumOf(rest, Number) + partial * multiplier;
  }

  async function max(limit = 10, factor = 2) {
    const now = Date.now();
    const count = Math.floor((now / duration) * steps);
    const members = await Promise.all(
      Array(steps + 1).fill(null).map(async (_, offset) => {
        const members = await rzrange(
          clientName,
          normalizeKey(redisKey, String(count - offset)),
          0,
          Math.round(limit * factor),
        );
        return members.map(([value]) => value);
      }),
    );

    const keySet = new Set(members.flat());

    const scores = await Promise.all(
      Array.from(keySet).map(async (key) => {
        const value = await read(key);
        return { key, value };
      }),
    );
    return (scores.sort((a, b) => b.value - a.value)).slice(0, limit);
  }

  async function min(limit = 10, factor = 2) {
    const now = Date.now();
    const count = Math.floor((now / duration) * steps);
    const members = await Promise.all(
      Array(steps + 1).fill(null).map(async (_, offset) => {
        const members = await rzrevrange(
          clientName,
          normalizeKey(redisKey, String(count - offset)),
          0,
          Math.round(limit * factor),
        );
        return members.map(([value]) => value);
      }),
    );

    const keySet = new Set(members.flat());

    const scores = await Promise.all(
      Array.from(keySet).map(async (key) => {
        const value = await read(key);
        return { key, value };
      }),
    );
    return scores.sort((a, b) => a.value - b.value).slice(0, limit);
  }

  return { write, read, max, min };
}
