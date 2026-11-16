import { swallowError } from "../../error.ts";
import { logger } from "../../log.ts";
import { isTestModeEnabled, repeatUntilShutdown } from "../../service.ts";
import { Now } from "../helper.ts";
import { knexTransaction, Transaction } from "../knex.ts";
import {
  dropEncryptedConstraint,
  ensureEncryptedConstraint,
} from "./apply-constraints.ts";
import { createEncryption, ENCRYPTED_PREFIX } from "./encryption.ts";
import { schemaEncryptPendingQuery, TableSchemaEncrypt } from "./internal.ts";
import type { Table } from "./types.ts";
import { encryptedColumns, encryptedConstraintName } from "./utils.ts";

// small batches in tests so a handful of rows takes several passes
const BATCH_SIZE = isTestModeEnabled ? 5 : 500;
// rows only become pending through applySchema, so polling is rarely busy. An
// error waits just as long, a row that cannot be decrypted fails every time
const IDLE_DELAY = 60000;
// columns encrypted at the same time per process, each worker locks its own row
const CONCURRENCY = 2;

/**
 * Brings the schema_encrypt rows in line with the schema and the active key.
 * Runs on every startup of the release whose schema is active, independent of
 * whether the schema hash changed:
 * - a column that is no longer encrypted loses its constraint and its row
 * - a newly encrypted column gets a pending row
 * - a row whose key is not the active key is reset, so the rotation
 *   re-encrypts the column
 * - a completed row of an enforced column whose constraint is missing is
 *   reset, so the rows are checked again before the constraint is added
 * - enforced is only ever raised, a pod that still declares the column
 *   unenforced leaves the row and the constraint alone
 */
export async function syncSchemaEncrypt(
  trx: Transaction,
  name: string,
  schema: string,
  tables: Table[],
) {
  const columns = tables.flatMap((table) =>
    encryptedColumns(table).map((column) => ({ table: table.name, ...column }))
  );
  const rows = await trx<TableSchemaEncrypt>("schema_encrypt")
    .where("schema", schema);

  for (const row of rows) {
    const encrypted = columns.some((next) =>
      next.table === row.table && next.column === row.column
    );
    if (encrypted) {
      continue;
    }
    await dropEncryptedConstraint(trx, row.table, row.column);
    await trx<TableSchemaEncrypt>("schema_encrypt").delete().where(
      "id",
      row.id,
    );
    logger.info("schema_encrypt_removed", {
      table: row.table,
      column: row.column,
    });
  }

  if (columns.length === 0) {
    return;
  }

  // only resolve the keys when there are encrypted columns, so services
  // without them do not need the secret
  const key = createEncryption(name).activeKeyId();
  const constraints = await trx("pg_constraint")
    .select<{ conname: string }[]>("conname")
    .whereIn(
      "conname",
      columns.map(({ table, column }) =>
        encryptedConstraintName(table, column)
      ),
    );

  for (const { table, column, enforced: declared } of columns) {
    const row = rows.find((row) =>
      row.table === table && row.column === column
    );
    const constraint = constraints.some((constraint) =>
      constraint.conname === encryptedConstraintName(table, column)
    );
    const enforced = declared || (row?.enforced ?? false);
    if (!row) {
      await trx<TableSchemaEncrypt>("schema_encrypt").insert({
        schema,
        table,
        column,
        key,
        cursor: null,
        completed: false,
        enforced,
        processed_at: Now(),
      });
      logger.info("schema_encrypt_pending", { table, column, key });
    } else if (row.key !== key) {
      await trx<TableSchemaEncrypt>("schema_encrypt")
        .update({
          key,
          cursor: null,
          completed: false,
          enforced,
          processed_at: Now(),
        })
        .where("id", row.id);
      logger.info("schema_encrypt_rotated", {
        table,
        column,
        key,
        previous: row.key,
      });
    } else if (enforced && row.completed && !constraint) {
      await trx<TableSchemaEncrypt>("schema_encrypt")
        .update({
          cursor: null,
          completed: false,
          enforced,
          processed_at: Now(),
        })
        .where("id", row.id);
      logger.info("schema_encrypt_pending", { table, column, key });
    } else if (enforced !== row.enforced) {
      await trx<TableSchemaEncrypt>("schema_encrypt")
        .update({ enforced })
        .where("id", row.id);
    }
  }
}

/**
 * Encrypts one batch of rows that are plaintext or use an older key, walking
 * the primary key from the stored cursor. A pass that finds nothing restarts
 * from the beginning once to catch rows written in the meantime, then adds
 * the check constraint, validates it in the next step and completes the row.
 * An unenforced column is completed without the constraint.
 * @returns True when there is more work
 */
async function processBatch(
  trx: Transaction,
  name: string,
  job: TableSchemaEncrypt,
) {
  const { encrypt, decrypt } = createEncryption(name);
  const keyPrefix = `${ENCRYPTED_PREFIX}${job.key}:`;

  let query = trx(job.table)
    .select<{ id: string; value: string }[]>("id", `${job.column} as value`)
    .whereNotNull(job.column)
    .whereNot(job.column, "like", `${keyPrefix}%`)
    .orderBy("id")
    .limit(BATCH_SIZE)
    // not for update, which would also block inserts that reference these rows
    .forNoKeyUpdate();
  if (job.cursor) {
    query = query.where("id", ">", job.cursor);
  }
  const rows = await query;

  if (rows.length > 0) {
    const values = rows.map(() => "(?::uuid, ?)").join(", ");
    // decrypt passes plaintext through, so rows of an older key are
    // re-encrypted rather than wrapped a second time
    const bindings = rows.flatMap(({ id, value }) => [
      id,
      encrypt(decrypt(value)),
    ]);
    await trx.raw(
      `update "${job.table}" as t set "${job.column}" = v.value
        from (values ${values}) as v(id, value)
        where t.id = v.id`,
      bindings,
    );
    const cursor = rows[rows.length - 1].id;
    await trx<TableSchemaEncrypt>("schema_encrypt")
      .update({ cursor, processed_at: Now() })
      .where("id", job.id);
    logger.info("schema_encrypt_batch", {
      table: job.table,
      column: job.column,
      rows: rows.length,
      cursor,
    });
    return true;
  }

  if (job.cursor) {
    await trx<TableSchemaEncrypt>("schema_encrypt")
      .update({ cursor: null, processed_at: Now() })
      .where("id", job.id);
    return true;
  }

  // the step that adds the constraint commits before the rows are validated
  if (
    job.enforced &&
    !await ensureEncryptedConstraint(trx, job.table, job.column)
  ) {
    return true;
  }
  await trx<TableSchemaEncrypt>("schema_encrypt")
    .update({ completed: true, processed_at: Now() })
    .where("id", job.id);
  logger.info("schema_encrypt_completed", {
    table: job.table,
    column: job.column,
    key: job.key,
    enforced: job.enforced,
  });
  return true;
}

/**
 * Processes one step of the least recently processed pending column that no
 * other worker holds, so parallel workers spread over the pending columns.
 * A row whose key is not this process's active key belongs to a newer version
 * of the service that rotated the key, so it is left alone.
 * @returns True when a batch was processed, false when nothing is pending
 */
export function processSchemaEncrypt(name: string, schema: string) {
  return knexTransaction(name, async (trx) => {
    const job = await schemaEncryptPendingQuery(trx, { schema })
      .orderBy("processed_at")
      .forUpdate()
      .skipLocked()
      .first();
    if (!job || job.key !== createEncryption(name).activeKeyId()) {
      return false;
    }
    return processBatch(trx, name, job);
  });
}

/**
 * Encrypts until nothing is pending, intended for tests
 */
export async function drainSchemaEncrypt(name: string, schema: string) {
  while (await processSchemaEncrypt(name, schema)) {
    // keep going
  }
}

/**
 * Works through pending columns in the background, batch after batch while
 * there is work and polling slowly otherwise, so a column that another pod's
 * startup reset is picked up without a restart. Schemas without encrypted
 * columns have nothing to do.
 */
export function startSchemaEncrypt(
  name: string,
  schema: string,
  tables: Table[],
) {
  if (isTestModeEnabled) {
    return;
  }
  if (tables.every((table) => encryptedColumns(table).length === 0)) {
    return;
  }
  repeatUntilShutdown(
    "schema_encrypt",
    swallowError(
      async () => (await processSchemaEncrypt(name, schema)) ? 0 : IDLE_DELAY,
      IDLE_DELAY,
    ),
    CONCURRENCY,
  );
}
