import { pgBoolean, pgDate, pgNullable, pgString } from "./columns.ts";
import { pgQuery, pgUnique } from "./indexes.ts";
import { pgSchema, pgTable } from "./schema.ts";
import type { StaticPg } from "./types.ts";

/**
 * Internal schema that tracks applied schema hashes and background work
 */
export const internalSchema = pgSchema("schema");

export const tableSchema = pgTable(internalSchema, "schema", () => ({
  schema: pgString(),
  hash: pgString(),
  active: pgBoolean(),
}));
export type TableSchema = StaticPg<typeof tableSchema>;
pgUnique(tableSchema, ["schema", "hash"]);
pgUnique(tableSchema, ["schema"], { active: true });

/**
 * One row per encrypted column: the key its rows are encrypted with and how far
 * the background encryption got. A key rotation resets the row to the new key.
 * Other kinds of background work get their own table.
 */
export const tableSchemaEncrypt = pgTable(
  internalSchema,
  "schema_encrypt",
  () => ({
    schema: pgString(),
    table: pgString(),
    column: pgString(),
    // id of the key every row is encrypted with once completed
    key: pgString(),
    // last processed id of the current pass, null before a pass starts
    cursor: pgNullable(pgString()),
    completed: pgBoolean(false),
    // whether completing adds the check constraint, kept on the row so pods
    // that still declare the column unenforced complete it the same way
    enforced: pgBoolean(false),
    // workers take the least recently processed column, so several columns
    // are encrypted in parallel instead of one after the other
    processed_at: pgDate(),
  }),
);
export type TableSchemaEncrypt = StaticPg<typeof tableSchemaEncrypt>;
pgUnique(tableSchemaEncrypt, ["schema", "table", "column"]);

export const schemaEncryptPendingQuery = pgQuery(
  tableSchemaEncrypt,
  ["schema"],
  { completed: false },
  ["processed_at"],
);
