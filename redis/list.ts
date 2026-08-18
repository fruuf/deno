import { multiOperation } from "./multi.ts";

/** add values at the start of the list */
export function rlpush(
  clientName: string,
  key: string,
  values: string[],
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => {
      return redis.lpush(nextKey, ...values);
    },
    Number,
  );
}

/** add values at the end of the list */
export function rrpush(
  clientName: string,
  key: string,
  values: string[],
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.rpush(nextKey, ...values),
    Number,
  );
}

/** get the length of a list */
export function rllen(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.llen(nextKey),
    (value) => Number(value || "0"),
  );
}

/** removes and returns the first elements of the list stored at key. */
export function rlpop(clientName: string, key: string, count = 1) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.lpop(nextKey, count),
    (values: string[]) => values || [],
  );
}

/** removes and returns the last elements of the list stored at key. */
export function rrpop(clientName: string, key: string, count = 1) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.rpop(nextKey, count),
    (values: string[]) => values || [],
  );
}

/** return elements from position start to position end (inclusive) from low to high score */
export function rlrange(
  clientName: string,
  key: string,
  start: number,
  end: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.lrange(nextKey, start, end),
    (values: string[]) => values || [],
  );
}
