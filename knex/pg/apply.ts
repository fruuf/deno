import { optionalKnexTransaction } from "../../knex.ts";
import { logger } from "../../log.ts";
import { advisoryLock } from "../helper.ts";
import { Transaction } from "../knex.ts";
import { applyConstraints } from "./apply-constraints.ts";
import { applyIndexes, dropIndexes } from "./apply-indexes.ts";
import { applyTables } from "./apply-tables.ts";
import { applyTriggers } from "./apply-triggers.ts";
import { internalSchema, TableSchema } from "./internal.ts";
import { compileSchema, hashTables } from "./schema.ts";
import { startSchemaEncrypt, syncSchemaEncrypt } from "./schema-encrypt.ts";
import type { PgSchema, Table } from "./types.ts";

const compiledTables = compileSchema(internalSchema);
const compiledHash = hashTables(compiledTables);

/**
 * Applies a schema whose hash was not applied before.
 * @returns True when the hash is the active one, false when a newer release
 * has replaced it
 */
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
    return existingSchema.active;
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
  return true;
}

/**
 * Applies schema changes to the database including tables, indexes, and constraints.
 * Work that touches existing rows, such as encrypting a column, is recorded in
 * schema_encrypt and processed in the background after this returns. Only the
 * release whose schema is active does that: a pod of an older release that
 * starts later, or a rollback, leaves the encryption state alone.
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
  let active = false;
  await optionalKnexTransaction(name, trx, async (trx) => {
    await advisoryLock(trx, "applySchema");
    await applyTables(trx, compiledTables);
    await applyCompiledTables(
      trx,
      internalSchema.name,
      compiledHash,
      compiledTables,
    );
    active = await applyCompiledTables(trx, nextSchema.name, hash, tables);

    // the columns an older release knows as encrypted are not the ones of the
    // active schema, syncing them would remove its jobs and constraints
    if (active) {
      await syncSchemaEncrypt(trx, name, nextSchema.name, tables);
    } else {
      logger.info("schema_encrypt_skipped", { schema: nextSchema.name, hash });
    }
  });
  if (active) {
    startSchemaEncrypt(name, nextSchema.name, tables);
  }
  return hash;
}
