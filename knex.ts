import { registerInstrumentations } from "npm:@opentelemetry/instrumentation";
import { KnexInstrumentation } from "npm:@opentelemetry/instrumentation-knex";

registerInstrumentations({
  instrumentations: [new KnexInstrumentation({})],
});

export {
  advisoryLock,
  iterateQuery,
  Now,
  parseCIDR,
  tryAdvisoryLock,
} from "./knex/helper.ts";
export {
  getKnex,
  getKnexReader,
  knexTransaction,
  knexTransactionHandler,
  onCommit,
  onRollback,
  optionalKnexReaderTransaction,
  optionalKnexReaderTransactionHandler,
  optionalKnexTransaction,
  optionalKnexTransactionHandler,
  remoteKnex,
  setupKnex,
  transactionKey,
} from "./knex/knex.ts";
export type { Knex, QueryBuilder, Transaction } from "./knex/knex.ts";
export {
  migrationHelpers,
  mirrorFields,
  partitionTable,
  uuidPKey,
} from "./knex/migration.ts";
export {
  applySchema,
  PG_GT,
  PG_GT_BI,
  PG_GTE,
  PG_GTE_BI,
  PG_LT,
  PG_LT_BI,
  PG_LTE,
  PG_LTE_BI,
  PG_NOT_NULL,
  PG_NULL,
  pgBoolean,
  pgDate,
  pgDecimal,
  pgEnum,
  pgExtend,
  pgFloat,
  pgForward,
  pgInteger,
  pgJson,
  pgNullable,
  pgQuery,
  pgReference,
  pgSchema,
  pgString,
  pgTable,
  pgText,
  pgUnique,
  pgUuid,
} from "./knex/pg.ts";
export type { StaticPg } from "./knex/pg.ts";
export { createTable } from "./knex/table.ts";
export { writeTypes } from "./knex/write-types.ts";
