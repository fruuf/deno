import { Knex } from "npm:knex";
import { withSpan } from "../metrics.ts";
import { completeHandlerBeforeShutdown } from "../service.ts";
import { uuid } from "../util.ts";
import { getKnex, getKnexReader } from "./instance.ts";

/**
 * Knex transaction type alias for database transactions
 */
export type Transaction<
  // deno-lint-ignore no-explicit-any
  TRecord extends Record<string, any> = any,
  TResult = unknown[],
> = Knex.Transaction<TRecord, TResult>;

/**
 * Knex query builder type alias for constructing database queries
 */
export type QueryBuilder<
  // deno-lint-ignore no-explicit-any
  TRecord extends Record<string, any> = any,
  // deno-lint-ignore no-explicit-any
  TResult = any,
> = Knex.QueryBuilder<TRecord, TResult>;

const transactionKeySymbol = Symbol("transactionKey");

/**
 * Executes a function within a database transaction
 */
export function knexTransaction<Result>(
  name: string,
  handler: (trx: Transaction) => Promise<Result> | Result,
): Promise<Result> {
  const knex = getKnex(name);
  const completeTransaction = completeHandlerBeforeShutdown(
    withSpan(
      "transaction",
      async (fn: (trx: Transaction) => Promise<Result> | Result) => {
        const result = await knex.transaction(async (tx: Transaction) => {
          const { commit, rollback } = tx;

          tx.commit = withSpan(
            "commit",
            (...args: unknown[]) => commit(...args),
            // deno-lint-ignore no-explicit-any
          ) as any;

          tx.rollback = withSpan(
            "rollback",
            (...args: unknown[]) => rollback(...args),
            // deno-lint-ignore no-explicit-any
          ) as any;

          const result = await fn(tx);

          return result;
        });

        return result;
      },
    ),
  ) as (fn: (trx: Transaction) => Promise<Result> | Result) => Promise<Result>;
  return completeTransaction((trx) => handler(trx));
}

/**
 * Executes a function within an optional transaction context
 */
export async function optionalKnexTransaction<Result>(
  name: string,
  trx: Transaction | null,
  handler: (trx: Transaction) => Promise<Result> | Result,
): Promise<Result> {
  if (trx) return await handler(trx);
  return knexTransaction(name, handler);
}

/**
 * Executes a function within an optional reader transaction context
 */
export async function optionalKnexReaderTransaction<Result>(
  name: string,
  trx: Transaction | null,
  handler: (trx: Transaction) => Promise<Result> | Result,
): Promise<Result> {
  const knex = getKnexReader(name);
  if (trx) return await handler(trx);
  return handler(knex as Transaction);
}

/**
 * Creates a handler that wraps function calls in a transaction
 */
export function knexTransactionHandler<Args extends unknown[], Result>(
  name: string,
  handler: (trx: Transaction, ...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result> {
  return (...args: Args) =>
    knexTransaction(name, (trx) => handler(trx, ...args));
}

/**
 * Creates a handler that wraps function calls in an optional transaction
 */
export function optionalKnexTransactionHandler<Args extends unknown[], Result>(
  name: string,
  handler: (trx: Transaction, ...args: Args) => Promise<Result> | Result,
): (trx: Transaction | null, ...args: Args) => Promise<Result> {
  return (trx, ...args: Args) =>
    optionalKnexTransaction(name, trx, (trx) => handler(trx, ...args));
}

/**
 * Creates a handler that wraps function calls in an optional reader transaction
 */
export function optionalKnexReaderTransactionHandler<
  Args extends unknown[],
  Result,
>(
  name: string,
  handler: (trx: Transaction, ...args: Args) => Promise<Result> | Result,
): (trx: Transaction | null, ...args: Args) => Promise<Result> {
  return (trx, ...args: Args) =>
    optionalKnexReaderTransaction(
      name,
      trx,
      (trx) => handler(trx, ...args),
    );
}

/**
 * Gets or creates a unique key for the given transaction
 */
export function transactionKey(trx: Transaction | null): string {
  // deno-lint-ignore no-explicit-any
  const trxAny = trx as any;
  if (!trxAny) return "null";
  if (trxAny[transactionKeySymbol]) return trxAny[transactionKeySymbol];
  const key = uuid();
  trxAny[transactionKeySymbol] = key;
  return key;
}
