// deno-lint-ignore-file no-explicit-any
import { assert, equal } from "jsr:@std/assert";
import { chunk } from "jsr:@std/collections";
import { randomString } from "../../util.ts";
import { Transaction } from "../knex.ts";
import { pgUnique } from "./query.ts";
import { compileSchema } from "./schema.ts";
import type { PgTable, StaticPg } from "./types.ts";
import { columnType, resolveColumn } from "./utils.ts";

/**
 * Rows a batch helper returns: none, only inserted/changed rows, or every row matching the batch keys.
 */
export type Returning = "none" | "changed" | "all";

const quote = (columns: string[]) => columns.map((column) => `"${column}"`);

const pickColumns = (value: object, columns: string[]) =>
  Object.fromEntries(
    columns
      .filter((column) => column in value)
      .map((column) => [column, (value as Record<string, unknown>)[column]]),
  );

/**
 * Creates a per-helper temp table getter. Column types come from the compiled schema;
 * the conflict target is checked against it once, on first use.
 */
function createTempTable(
  table: PgTable<any>,
  columns: string[],
  conflictColumns: string[] | null,
) {
  // postgres has a limit of 63 chars, lets make sure we stay below that
  const tempTable = `${table.name.substring(0, 32)}__${
    randomString(16).toLowerCase()
  }`;
  let columnStr: string | null = null;

  return async (trx: Transaction) => {
    if (columnStr === null) {
      const tables = compileSchema(table.schema);
      const compiled = tables.find(({ name }) => name === table.name);
      assert(compiled, `table "${table.name}" not found in its schema`);

      // a narrower pgUnique on the same table absorbs ours, and postgres needs an exact match
      if (
        conflictColumns &&
        !compiled.indexes.some((index) =>
          index.type === "unique" &&
          equal(index.where, {}) &&
          index.columns.length === conflictColumns.length &&
          conflictColumns.every((column) => index.columns.includes(column))
        )
      ) {
        throw new Error(
          `"${table.name}" has no unique index on exactly (${
            conflictColumns.join(", ")
          }), a narrower pgUnique replaces it`,
        );
      }

      columnStr = columns
        .map((column) =>
          `"${column}" ${
            columnType(resolveColumn(compiled.columns[column], tables))
          }`
        )
        .join(", ");
    }

    await trx.raw(
      `create temp table if not exists "${tempTable}" (${columnStr}) on commit delete rows`,
    );
    return tempTable;
  };
}

async function executeBatch<Row>(
  trx: Transaction,
  table: string,
  tempTable: string,
  keyColumns: string[],
  values: Record<string, unknown>[],
  query: string,
  returning: Returning,
): Promise<Row[]> {
  for (const nextChunk of chunk(values, 1000)) {
    await trx(tempTable).insert(nextChunk);
  }

  const changedResults = await trx.raw(query);

  if (returning === "none") {
    await trx(tempTable).truncate();
    return [];
  }
  if (returning === "changed") {
    await trx(tempTable).truncate();
    return changedResults;
  }

  const joinOnStr = keyColumns
    .map((column) => `"${tempTable}"."${column}" = "${table}"."${column}"`)
    .join(" and ");

  const distinctStr = keyColumns
    .map((column) => `"result"."${column}"`)
    .join(", ");

  const allResults = await trx.raw(`
    select distinct on (${distinctStr}) "result".* from (
      select "${table}".* from "${table}"
      inner join "${tempTable}"
      on (${joinOnStr})
      for update
    ) "result"
    order by ${distinctStr}
  `);
  await trx(tempTable).truncate();
  return allResults;
}

/**
 * Batch insert that skips rows whose key already exists. Registers a unique index on the key columns.
 */
export function pgBatchInsert<
  Table extends PgTable<any>,
  KeyColumn extends keyof StaticPg<Table>,
  InsertColumn extends Exclude<keyof StaticPg<Table>, KeyColumn>,
>(
  table: Table,
  keyColumns: KeyColumn[],
  insertColumns: InsertColumn[],
) {
  pgUnique(table, keyColumns);

  const keys = keyColumns as string[];
  const columns = [...keys, ...insertColumns as string[]];
  const getTempTable = createTempTable(table, columns, keys);
  const fieldStr = quote(columns).join(", ");
  const conflictStr = quote(keys).join(", ");

  return async (
    trx: Transaction,
    values: Pick<StaticPg<Table>, KeyColumn | InsertColumn>[],
    returning: Returning = "none",
  ): Promise<StaticPg<Table>[]> => {
    if (values.length === 0) return [];
    const tempTable = await getTempTable(trx);

    return executeBatch(
      trx,
      table.name,
      tempTable,
      keys,
      values.map((value) => pickColumns(value, columns)),
      `
        insert into "${table.name}" (${fieldStr})
        (
          select distinct on (${conflictStr}) ${fieldStr}
          from "${tempTable}"
          order by ${conflictStr}
        )
        on conflict (${conflictStr}) do nothing
        ${returning === "changed" ? "returning *" : ""}
      `,
      returning,
    );
  };
}

/**
 * Batch insert that updates the update columns of existing rows when they differ.
 * Registers a unique index on the key columns.
 */
export function pgBatchUpsert<
  Table extends PgTable<any>,
  KeyColumn extends keyof StaticPg<Table>,
  UpdateColumn extends Exclude<keyof StaticPg<Table>, KeyColumn>,
  InsertColumn extends Exclude<
    keyof StaticPg<Table>,
    KeyColumn | UpdateColumn
  > = never,
>(
  table: Table,
  keyColumns: KeyColumn[],
  updateColumns: UpdateColumn[],
  insertColumns: InsertColumn[] = [],
) {
  assert(updateColumns.length > 0, "pgBatchUpsert needs update columns");
  pgUnique(table, keyColumns);

  const keys = keyColumns as string[];
  const updates = updateColumns as string[];
  const columns = [...keys, ...updates, ...insertColumns as string[]];
  const getTempTable = createTempTable(table, columns, keys);
  const fieldStr = quote(columns).join(", ");
  const conflictStr = quote(keys).join(", ");
  const setStr = updates
    .map((column) => `"${column}" = excluded."${column}"`)
    .join(", ");
  const whereStr = updates
    .map((column) =>
      `"${table.name}"."${column}" is distinct from excluded."${column}"`
    )
    .join(" or ");

  return async (
    trx: Transaction,
    values: Pick<StaticPg<Table>, KeyColumn | UpdateColumn | InsertColumn>[],
    returning: Returning = "none",
  ): Promise<StaticPg<Table>[]> => {
    if (values.length === 0) return [];
    const tempTable = await getTempTable(trx);

    return executeBatch(
      trx,
      table.name,
      tempTable,
      keys,
      values.map((value) => pickColumns(value, columns)),
      `
        insert into "${table.name}" (${fieldStr})
        (
          select distinct on (${conflictStr}) ${fieldStr}
          from "${tempTable}"
          order by ${conflictStr}
        )
        on conflict (${conflictStr}) do update
        set ${setStr}
        where ${whereStr}
        ${returning === "changed" ? "returning *" : ""}
      `,
      returning,
    );
  };
}

/**
 * Batch update of existing rows by key, skipping rows that wouldn't change. Never inserts.
 * Registers a unique index on the key columns, so each value updates at most one row.
 */
export function pgBatchUpdate<
  Table extends PgTable<any>,
  KeyColumn extends keyof StaticPg<Table>,
  UpdateColumn extends Exclude<keyof StaticPg<Table>, KeyColumn>,
>(
  table: Table,
  keyColumns: KeyColumn[],
  updateColumns: UpdateColumn[],
) {
  assert(updateColumns.length > 0, "pgBatchUpdate needs update columns");
  pgUnique(table, keyColumns);

  const keys = keyColumns as string[];
  const updates = updateColumns as string[];
  const columns = [...keys, ...updates];
  const getTempTable = createTempTable(table, columns, null); // no ON CONFLICT, so no exact-match check;
  const fieldStr = quote(columns).join(", ");
  const conflictStr = quote(keys).join(", ");
  const setStr = updates
    .map((column) => `"${column}" = "temp_table"."${column}"`)
    .join(", ");
  const changedStr = updates
    .map((column) =>
      `"${table.name}"."${column}" is distinct from "temp_table"."${column}"`
    )
    .join(" or ");
  const whereStr = keys
    .map((column) => `"${table.name}"."${column}" = "temp_table"."${column}"`)
    .concat([`(${changedStr})`])
    .join(" and ");

  return async (
    trx: Transaction,
    values: Pick<StaticPg<Table>, KeyColumn | UpdateColumn>[],
    returning: Returning = "none",
  ): Promise<StaticPg<Table>[]> => {
    if (values.length === 0) return [];
    const tempTable = await getTempTable(trx);

    return executeBatch(
      trx,
      table.name,
      tempTable,
      keys,
      values.map((value) => pickColumns(value, columns)),
      `
        update "${table.name}"
        set ${setStr}
        from (
          select distinct on (${conflictStr}) ${fieldStr}
          from "${tempTable}"
          order by ${conflictStr}
        ) temp_table
        where ${whereStr}
        ${returning === "changed" ? "returning *" : ""}
      `,
      returning,
    );
  };
}
