import { chunk } from "jsr:@std/collections";
import { multiOperation } from "./multi.ts";

/** sets values in a sorted set and returns how many values were added */
export function rzadd(
  clientName: string,
  key: string,
  values: [number, string][],
  mode?: "XX" | "NX" | "LT" | "GT" | "CH" | "INCR",
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => {
      if (mode) {
        return redis.zadd(nextKey, mode, ...values.flat());
      }
      return redis.zadd(nextKey, ...values.flat());
    },
    Number,
  );
}

/** returns the cardinality (size) of a sorted set */
export function rzcard(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zcard(nextKey),
    Number,
  );
}

/** increments the score in a sorted set and returns the new score */
export function rzincrby(
  clientName: string,
  key: string,
  value: string,
  count: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zincrby(nextKey, count, value),
    Number,
  );
}

function parseZScores(results: string[]): [value: string, score: number][] {
  if (!results) return [];
  return chunk(results, 2).map(([value, score]) => [value, Number(score)]);
}

/** removes elements with the highest score from the set */
export function rzpopmax(clientName: string, key: string, count = 1) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zpopmax(nextKey, count),
    parseZScores,
  );
}

/** removes elements with the lowest score from the set */
export function rzpopmin(clientName: string, key: string, count = 1) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zpopmin(nextKey, count),
    parseZScores,
  );
}

/** return elements from position start to position end (inclusive) from low to high score */
export function rzrange(
  clientName: string,
  key: string,
  start: number,
  end: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) =>
      redis.zrange(nextKey, String(start), String(end), "WITHSCORES"),
    parseZScores,
  );
}

export function rzcount(
  clientName: string,
  key: string,
  start: number,
  end: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zcount(nextKey, start, end),
    Number,
  );
}

/** returns the position for a value based on the score */
export function rzrank(clientName: string, key: string, value: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zrank(nextKey, value),
    (rank: number | undefined) => (typeof rank === "number" ? rank : null),
  );
}

/** return elements from score min (inclusive) to score max (inclusive) from low to high score */
export function rzrangebyscore(
  clientName: string,
  key: string,
  min: number,
  max: number,
  limit?: number,
  offset?: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) =>
      limit
        ? redis.zrangebyscore(
          nextKey,
          min,
          max,
          "WITHSCORES",
          "LIMIT",
          String(offset || 0),
          String(limit),
        )
        : redis.zrangebyscore(nextKey, min, max, "WITHSCORES"),
    parseZScores,
  );
}

/** removes members from a sorted set and returns how many elements were removed */
export function rzrem(
  clientName: string,
  key: string,
  members: string[],
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zrem(nextKey, ...members),
    Number,
  );
}

/** removes elements from score min (inclusive) to score max (inclusive) and returns how many elements were removed */
export function rzremrangebyscore(
  clientName: string,
  key: string,
  min: number,
  max: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zremrangebyscore(nextKey, min, max),
    Number,
  );
}

/** return elements from position start to position end (inclusive) from high to low score */
export function rzrevrange(
  clientName: string,
  key: string,
  start: number,
  end: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zrevrange(nextKey, start, end, "WITHSCORES"),
    parseZScores,
  );
}

/** return the score for an element in a sorted set */
export function rzscore(clientName: string, key: string, value: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.zscore(nextKey, value),
    (score: string | undefined) =>
      typeof score === "string" ? Number(score) : null,
  );
}
