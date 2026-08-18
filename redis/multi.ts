import { ChainableCommander, Cluster, Redis } from "npm:ioredis";

import { timeoutHandler } from "../error.ts";
import { getRedis, getRedisClient } from "./redis.ts";

/**
 * Normalizes key parts into a consistent format for Redis operations.
 */
export const normalizeKey = (...parts: (string[] | string)[]) =>
  parts
    .flat()
    .filter(Boolean)
    .map((part) => String(part).trim().toLowerCase())
    .join("/");

type Operation<
  Instance extends ChainableCommander | Redis | Cluster =
    | ChainableCommander
    | Redis
    | Cluster,
> = (
  instance: Instance,
  key: string,
) => ChainableCommander | Promise<unknown>;

// type OperationHandler<Value> = {
//   clientName: string;
//   key: string;
//   operation: Operation;
//   parseValue: (rawValue: unknown) => Value;
//   resolve: (value: Value) => void;
//   reject: (error: Error) => void;
// };

// let isRunning = false;
// // deno-lint-ignore no-explicit-any
// let operationsMap: Map<string, OperationHandler<any>[]> = new Map();

// function startMulti() {
//   if (isRunning) return;
//   isRunning = true;
//   queueMicrotask(() => {
//     const prevOperationsMap = operationsMap;
//     operationsMap = new Map();
//     isRunning = false;

//     for (const operationHandlers of prevOperationsMap.values()) {
//       const [{ clientName }] = operationHandlers;
//       const redis = getRedisClient(clientName);
//       let multi = redis.client.multi();
//       for (const { operation, key } of operationHandlers) {
//         multi = operation(multi, key);
//       }
//       multi
//         .exec()
//         .then((results) => {
//           console.log("results", results);
//           operationHandlers.forEach(
//             ({ resolve, reject, parseValue }, index) => {
//               if (!results) return reject(Error("emptyMultiResult"));
//               const [error, result] = results[index];
//               if (error) return reject(error);
//               return resolve(parseValue(result));
//             },
//           );
//         })
//         .catch((error) =>
//           operationHandlers.forEach(({ reject }) => reject(error))
//         );
//     }
//   });
// }

/**
 * Executes a Redis operation as part of a batched multi/transaction.
 */
export async function multiOperation<Value>(
  clientName: string,
  key: string,
  operation: Operation,
  // deno-lint-ignore no-explicit-any
  parseValue: (rawValue: any) => Value = (value) => value as Value,
) {
  const redis = getRedisClient(clientName);
  const redisKey = redis.prefix ? `${redis.prefix}/${key}` : key;

  const result = await timeoutHandler(operation, 5000)(
    getRedis(clientName),
    redisKey,
  );

  return parseValue(result);
}

/**
 * Resets the database.
 */
export function rflushdb(clientName: string) {
  return multiOperation(clientName, "", (redis) => redis.flushdb(), Number);
}

/**
 * Decrements a key by 1 and returns the new value.
 */
export function rdecr(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.decr(nextKey),
    Number,
  );
}

/**
 * Decrements a key by an integer and returns the new value.
 */
export function rdecrby(clientName: string, key: string, value: number) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.decrby(nextKey, value),
    Number,
  );
}

/**
 * Deletes a key and returns if the key existed before deletion.
 */
export function rdel(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.del(nextKey),
    Boolean,
  );
}

/**
 * Checks if a key exists.
 */
export function rexists(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.exists(nextKey),
    Boolean,
  );
}

/**
 * Expires a key (milliseconds) and returns if the key exists.
 */
export function rexpire(
  clientName: string,
  key: string,
  duration: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.pexpire(nextKey, duration),
    Boolean,
  );
}

/**
 * Gets the value of a key and returns null if the key does not exist.
 */
export function rget(
  clientName: string,
  key: string,
): Promise<string | null> {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.get(nextKey),
  );
}

/**
 * Increments a key by 1 and returns the new value.
 */
export function rincr(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.incr(nextKey),
    Number,
  );
}

/**
 * Increments a key by an integer and returns the new value.
 */
export function rincrby(clientName: string, key: string, value: number) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.incrby(nextKey, value),
    Number,
  );
}

/**
 * Increments a key by a float and returns the new value.
 */
export function rincrbyfloat(
  clientName: string,
  key: string,
  value: number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.incrbyfloat(nextKey, value),
    Number,
  );
}

/**
 * Searches for keys by pattern.
 */
export function rkeys(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.keys(nextKey),
    (keys: string[]) => {
      const client = getRedisClient(clientName);
      return keys.map((key) => key.substring(client.prefix.length + 1));
    },
  );
}

/**
 * Sets a value to a key and returns if the value was written.
 */
export function rset(
  clientName: string,
  key: string,
  value: string | number,
) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.set(nextKey, value),
    (result: string) => result === "OK",
  );
}

/**
 * Returns the expire time of a key (milliseconds, -1: no expire, -2: key does not exist).
 */
export function rttl(clientName: string, key: string) {
  return multiOperation(
    clientName,
    key,
    (redis, nextKey) => redis.pttl(nextKey),
    Number,
  );
}
