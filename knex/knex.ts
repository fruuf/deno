// re-export type, useful for Knex | Transaction
export type { Knex } from "npm:knex";

// Re-export connection utilities
export { createKnex } from "./instance.ts";

// Re-export instance management
export { getKnex, getKnexReader, remoteKnex, setupKnex } from "./instance.ts";

// Re-export transaction types and utilities
export {
  knexTransaction,
  knexTransactionHandler,
  optionalKnexReaderTransaction,
  optionalKnexReaderTransactionHandler,
  optionalKnexTransaction,
  optionalKnexTransactionHandler,
  type QueryBuilder,
  type Transaction,
  transactionKey,
} from "./transaction.ts";

// Re-export transaction hooks
export {
  onBeforeCommit,
  onBeforeRollback,
  onCommit,
  onRollback,
} from "./transaction-hooks.ts";
