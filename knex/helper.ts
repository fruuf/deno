import knexFactory, { Knex } from "npm:knex";
import { errorHandler } from "../error.ts";
import { randomString } from "../util.ts";
import { QueryBuilder, Transaction } from "./knex.ts";

/**
 * Knex client type constant for PostgreSQL database connections
 */
export const CLIENT = "pg";
const knexClient = knexFactory({ client: CLIENT });

/**
 * Creates a PostgreSQL now() expression with optional interval
 * @param interval - Optional interval string (e.g. '1 hour', '2 days')
 * @returns Date object that renders as SQL expression
 */
export function Now(interval?: string): Date {
  if (interval) {
    // deno-lint-ignore no-explicit-any
    return knexClient.raw(`(now() + interval '${interval}')`) as any;
  }
  // deno-lint-ignore no-explicit-any
  return knexClient.raw(`now()`) as any;
}

/**
 * Acquires a PostgreSQL advisory lock for the transaction duration
 * @param trx - Knex transaction
 * @param key - Lock key string
 */
export async function advisoryLock(trx: Knex.Transaction, key: string) {
  await trx.raw(`select pg_advisory_xact_lock(hashtext(?::text));`, [key]);
}

/**
 * Attempts to acquire a PostgreSQL advisory lock without blocking
 * @param trx - Knex transaction
 * @param key - Lock key string
 * @returns True if lock was acquired, false otherwise
 */
export async function tryAdvisoryLock(trx: Knex.Transaction, key: string) {
  type Lock = { lock: boolean };

  const [{ lock }] = await trx.raw<Lock[]>(
    `select pg_try_advisory_xact_lock(hashtext(?::text)) as lock;`,
    [key],
  );

  return lock;
}

/**
 * Defers creation of async iterator until iteration begins
 * @param handler - Function that creates the async iterator
 * @returns Function that returns async iterable
 */
export function deferAsyncIterator<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<AsyncIterator<Result>>,
): (...args: Args) => AsyncIterable<Result> {
  return (...args: Args) => ({
    [Symbol.asyncIterator]() {
      let iteratorPromise: Promise<AsyncIterator<Result>> | null = null;

      function getIterator() {
        if (iteratorPromise) return iteratorPromise;
        iteratorPromise = handler(...args);
        return iteratorPromise;
      }

      return {
        async next() {
          const iterator = await getIterator();
          return iterator.next();
        },
        async return() {
          if (!iteratorPromise) return { done: true, value: undefined };
          const iterator = await getIterator();
          if (iterator.return) return iterator.return();
          return { done: true, value: undefined };
        },
        async throw(error: Error) {
          if (!iteratorPromise) return Promise.reject(error);
          const iterator = await getIterator();
          if (iterator.throw) return iterator.throw(error);
          return Promise.reject(error);
        },
      };
    },
  });
}

/**
 * Iterates over query results using a database cursor for memory efficiency
 * @param trx - Transaction to use
 * @param query - Query to iterate
 * @param chunkSize - Number of rows per chunk (default: 1000)
 * @returns Async iterator over result chunks
 */
export const iterateQuery = deferAsyncIterator(
  async <Result extends Record<string, unknown>>(
    trx: Transaction,
    query: QueryBuilder<Result>,
    chunkSize = 1000,
  ) => {
    const cursor = randomString(32);
    const { sql, bindings } = query.toSQL();
    await trx.raw(`declare cursor_${cursor} cursor for ${sql}`, bindings);
    let isDone = false;
    return {
      async next() {
        if (isDone) return { value: undefined, done: true };
        const value = await trx.raw(
          `fetch ${chunkSize} from cursor_${cursor};`,
        );
        isDone = isDone || value.length === 0;
        if (isDone) {
          await trx.raw(`close cursor_${cursor};`).catch(errorHandler);
          return { value: undefined, done: true };
        }
        return { value, done: false };
      },
      async return() {
        if (!isDone) {
          isDone = true;
          await trx.raw(`close cursor_${cursor};`).catch(errorHandler);
        }
        return { value: undefined, done: true };
      },
      async throw(error: Error) {
        if (!isDone) {
          isDone = true;
          await trx.raw(`close cursor_${cursor};`).catch(errorHandler);
        }
        return Promise.reject(error);
      },
    };
  },
);

/**
 * Extracts IP address from CIDR notation
 * @param cidr - CIDR string (e.g. '192.168.1.0/24')
 * @returns IP address part
 */
export function parseCIDR(cidr: string) {
  const [ip] = cidr.split("/");
  return ip;
}
