import { optionalKnexTransaction } from "../../knex.ts";
import { advisoryLock } from "../helper.ts";
import { Transaction } from "../knex.ts";
import { applyConstraints } from "./apply-constraints.ts";
import { applyIndexes, dropIndexes } from "./apply-indexes.ts";
import { applyTables } from "./apply-tables.ts";
import { applyTriggers } from "./apply-triggers.ts";
import { pgBoolean, pgString } from "./columns.ts";
import { pgUnique } from "./indexes.ts";
import { compileSchema, hashTables, pgSchema, pgTable } from "./schema.ts";
import type { PgSchema, StaticPg, Table } from "./types.ts";

const schema = pgSchema("schema");
const schemaTable = pgTable(schema, "schema", () => ({
  schema: pgString(),
  hash: pgString(),
  active: pgBoolean(),
}));
type TableSchema = StaticPg<typeof schemaTable>;
pgUnique(schemaTable, ["schema", "hash"]);
pgUnique(schemaTable, ["schema"], { active: true });

const compiledTables = compileSchema(schema);
const compiledHash = hashTables(compiledTables);

async function applyCompiledTables(
  trx: Transaction,
  schema: string,
  hash: string,
  tables: Table[],
) {
  const [existingSchema] = await trx<TableSchema>("schema")
    .where("schema", schema)
    .where("hash", hash);

  if (existingSchema) {
    return;
  }

  await trx<TableSchema>("schema")
    .update("active", false)
    .where("schema", schema)
    .where("active", true);

  await trx<TableSchema>("schema")
    .insert({ schema, hash, active: true });

  await applyTables(trx, tables);
  const appliedIndexes = await applyIndexes(trx, tables);
  await applyConstraints(trx, tables, appliedIndexes);
  await applyTriggers(trx, tables);
  await dropIndexes(trx, appliedIndexes);
}

/**
 * Applies schema changes to the database including tables, indexes, and constraints
 * @param name - Database connection name
 * @param trx - Optional transaction to use
 * @param nextSchema - Schema definition to apply
 * @returns Hash of the applied schema
 */
export async function applySchema(
  name: string,
  trx: Transaction | null,
  nextSchema: PgSchema,
) {
  const tables = compileSchema(nextSchema);
  const hash = hashTables(tables);
  await optionalKnexTransaction(name, trx, async (trx) => {
    await advisoryLock(trx, "applySchema");
    await applyTables(trx, compiledTables);
    await applyCompiledTables(trx, schema.name, compiledHash, compiledTables);
    await applyCompiledTables(trx, nextSchema.name, hash, tables);
  });
  return hash;
}
