// Re-export type required by knex.ts
export type { StaticPg } from "./pg/types.ts";

// Re-export column creation functions required by knex.ts
export {
  pgBoolean,
  pgDate,
  pgDecimal,
  pgEnum,
  pgFloat,
  pgForward,
  pgInteger,
  pgJson,
  pgNullable,
  pgReference,
  pgString,
  pgText,
  pgUuid,
} from "./pg/columns.ts";

// Re-export schema functions required by knex.ts
export { pgExtend, pgSchema, pgTable } from "./pg/schema.ts";

// Re-export index functions required by knex.ts
export { pgQuery, pgUnique } from "./pg/indexes.ts";

// Re-export apply function required by knex.ts
export { applySchema } from "./pg/apply.ts";

export {
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
} from "./pg/helper.ts";
