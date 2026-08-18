import { multiOperation } from "./multi.ts";

/** adds values to a set and returns how many values were added */
export function rsadd(clientName: string, key: string, values: string[]) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.sadd(nextKey, ...values),
    Number,
  );
}

/** returns the members of a set */
export function rsmembers(
  clientName: string,
  key: string,
): Promise<string[]> {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.smembers(nextKey),
  );
}

/** removes members from a set and returns how many elements were removed */
export function rsrem(
  clientName: string,
  key: string,
  members: string[],
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.srem(nextKey, ...members),
    Number,
  );
}

/** check if a value is  member of a set and return true if it is. false if not */
export function rsismember(
  clientName: string,
  key: string,
  member: string,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.sismember(nextKey, member),
    Boolean,
  );
}

/** return size of a set  */
export function rscard(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.scard(nextKey),
    Number,
  );
}
