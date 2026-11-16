import { assert } from "jsr:@std/assert";
import { logger } from "../../log.ts";
import { asyncQueue } from "../../queue.ts";
import { isValue } from "../../util.ts";
import { Transaction } from "../knex.ts";
import type { AppliedIndex } from "./apply-indexes.ts";
import { ENCRYPTED_PREFIX } from "./encryption.ts";
import type { Table } from "./types.ts";
import {
  encryptedConstraintName,
  hash,
  pgColumnsArray,
  resolveColumn,
} from "./utils.ts";

/**
 * Applies constraints to database tables including primary keys and foreign keys.
 */
export async function applyConstraints(
  trx: Transaction,
  tables: Table[],
  appliedIndexes: AppliedIndex[],
) {
  type ConstraintTable = {
    table_name: string;
    constraint_name: string;
  };

  const currentConstraints = await trx("information_schema.key_column_usage")
    .select<ConstraintTable[]>("table_name", "constraint_name")
    .whereIn("table_name", tables.map((table) => table.name))
    .where("table_schema", "public");

  await Promise.all(tables.map(asyncQueue(async (table) => {
    const primaryIndex = appliedIndexes.find((index) =>
      index.type === "primary" &&
      index.table === table.name
    );
    assert(primaryIndex);

    const tableConstraints = currentConstraints.filter((constraints) =>
      constraints.table_name === table.name
    );

    const constraints: string[] = pgColumnsArray(table.columns)
      .map(
        ({ key, column }) => {
          let source = column;
          if (source.type === "forward") {
            source = resolveColumn(column, tables);
          }
          if (source.type === "nullable") {
            source = source.column;
          }
          if (source.type === "reference") {
            return `foreign key ("${key}") references "${source.table.name}" ("id")`;
          }
          return null;
        },
      )
      .filter(isValue);

    const nextConstraints = constraints.map((constraint) => ({
      name: `${table.name}_constraint_${hash(constraint)}`,
      constraint,
    })).concat([{
      name: primaryIndex.name,
      constraint: `primary key using index "${primaryIndex.name}"`,
    }]);

    const alterStr = [
      ...new Set(
        tableConstraints.map((constraint) => constraint.constraint_name).concat(
          nextConstraints.map((constraint) => constraint.name),
        ),
      ),
    ]
      .map(
        (name) => {
          const currentConstraint = tableConstraints.find((constraint) =>
            constraint.constraint_name === name
          );
          const nextConstraint = nextConstraints.find((constraint) =>
            constraint.name === name
          );
          if (currentConstraint && nextConstraint) {
            return;
          }
          if (currentConstraint && !nextConstraint) {
            return `drop constraint "${currentConstraint.constraint_name}"`;
          }
          if (!nextConstraint) {
            return;
          }
          return `add constraint "${nextConstraint.name}" ${nextConstraint.constraint}`;
        },
      )
      .filter(isValue).join(", ");

    if (alterStr) {
      const query = `alter table "${table.name}" ${alterStr}`;
      logger.info("alter_table_constraints", { query });
      await trx.raw(query);
    }
  })));
}

/**
 * Adds the check constraint that rejects plaintext in an encrypted column, one
 * step per call, and each call needs its own transaction. Adding it as not valid
 * takes an access exclusive lock, but only for an instant because no rows are
 * checked. Validating reads every row under a lock that allows reads and writes.
 * In one transaction the first lock would be held until the rows are read.
 *
 * Postgres writes the row of a rejected write to its server log, plaintext
 * included. A value this constraint rejected has to be treated as exposed.
 * @returns True once the constraint exists and is validated
 */
export async function ensureEncryptedConstraint(
  trx: Transaction,
  table: string,
  column: string,
) {
  const name = encryptedConstraintName(table, column);
  const [existing] = await trx("pg_constraint")
    .select<{ convalidated: boolean }[]>("convalidated")
    .where("conname", name);
  if (!existing) {
    const query =
      `alter table "${table}" add constraint "${name}" check ("${column}" like '${ENCRYPTED_PREFIX}%') not valid`;
    logger.info("alter_table_constraints", { query });
    await trx.raw(query);
    return false;
  }
  if (!existing.convalidated) {
    await trx.raw(`alter table "${table}" validate constraint "${name}"`);
  }
  return true;
}

/**
 * Drops the check constraint of a column that is no longer encrypted
 */
export async function dropEncryptedConstraint(
  trx: Transaction,
  table: string,
  column: string,
) {
  const name = encryptedConstraintName(table, column);
  const query =
    `alter table if exists "${table}" drop constraint if exists "${name}"`;
  logger.info("alter_table_constraints", { query });
  await trx.raw(query);
}
