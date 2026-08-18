import { pick } from "jsr:@std/collections";
import { Knex } from "npm:knex";
import { finalizeReturn } from "./finalize.ts";
import { Returning } from "./schema.ts";
import { createTempTable } from "./temp-table.ts";

function pickKeys<
  Value extends Record<string, unknown>,
  Key extends keyof Value,
>(
  keys: Key[],
  values: Value[],
): Pick<Value, Key>[] {
  return values.map((value) => pick<Value, Key>(value, keys));
}

/**
 * Performs batch insert operations with conflict handling.
 */
export async function batchInsert<
  Table extends { [k: string]: unknown },
  KeyColumn extends keyof Table,
  InsertColumn extends Exclude<keyof Table, KeyColumn>,
>(
  trx: Knex.Transaction,
  table: string,
  keyColumns: KeyColumn[],
  insertColumns: InsertColumn[],
  values: Pick<Table, KeyColumn | InsertColumn>[],
  getTableSchema: (trx: Knex.Transaction) => Promise<Record<string, string>>,
  tempTableMap: Map<string, string>,
  returning: Returning = "none",
): Promise<Table[]> {
  if (values.length === 0) {
    return [];
  }

  const tempTable = await createTempTable(
    trx,
    table,
    [
      ...keyColumns,
      ...insertColumns,
    ] as (string | number)[],
    getTableSchema,
    tempTableMap,
  );

  const insertFieldStr = ([...keyColumns, ...insertColumns] as string[])
    .map((field) => `"${field}"`)
    .join(", ");

  const conflictFieldStr = (keyColumns as string[])
    .map((column) => `"${column}"`)
    .join(", ");

  const returningStr = returning === "changed" ? "returning *" : "";

  const insertTableQuery = `
    insert into "${table}" (${insertFieldStr})
    (
      select distinct on (${conflictFieldStr}) ${insertFieldStr}
      from ${tempTable}
      order by ${conflictFieldStr}
    )
    on conflict (${conflictFieldStr}) do nothing
    ${returningStr}
  `;

  return finalizeReturn(
    trx,
    table,
    pickKeys([
      ...keyColumns,
      ...insertColumns,
    ], values),
    keyColumns,
    tempTable,
    insertTableQuery,
    returning,
  ) as Promise<Table[]>;
}

/**
 * Performs single upsert operation.
 */
export async function upsert<
  Table extends { [k: string]: unknown },
  KeyColumn extends keyof Table,
  UpdateColumn extends Exclude<keyof Table, KeyColumn>,
  InsertColumn extends Exclude<keyof Table, KeyColumn | UpdateColumn>,
>(
  trx: Knex.Transaction,
  table: string,
  keyColumns: KeyColumn[],
  updateColumns: UpdateColumn[],
  insertColumns: InsertColumn[],
  value: Pick<Table, KeyColumn | UpdateColumn | InsertColumn>,
): Promise<Table> {
  const setFieldStr = (updateColumns as string[])
    .map((column) => `"${column}" = :${column}`)
    .join(", ");

  const insertFieldStr = (
    [...keyColumns, ...updateColumns, ...insertColumns] as string[]
  )
    .map((field) => `"${field}"`)
    .join(", ");

  const insertValuesStr = (
    [...keyColumns, ...updateColumns, ...insertColumns] as string[]
  )
    .map((field) => `:${field}`)
    .join(", ");

  const conflictFieldStr = (keyColumns as string[])
    .map((column) => `"${column}"`)
    .join(", ");

  const upsertTableQuery = `
    insert into "${table}" (${insertFieldStr})
    values (${insertValuesStr})
    on conflict (${conflictFieldStr}) do update
    set ${setFieldStr}
    returning *;`;

  const [result] = await trx.raw(upsertTableQuery, value as Knex.ValueDict);

  return result;
}

/**
 * Performs batch upsert operations.
 */
export async function batchUpsert<
  Table extends { [k: string]: unknown },
  KeyColumn extends keyof Table,
  UpdateColumn extends Exclude<keyof Table, KeyColumn>,
  InsertColumn extends Exclude<keyof Table, KeyColumn | UpdateColumn>,
>(
  trx: Knex.Transaction,
  table: string,
  keyColumns: KeyColumn[],
  updateColumns: UpdateColumn[],
  insertColumns: InsertColumn[],
  values: Pick<Table, KeyColumn | UpdateColumn | InsertColumn>[],
  getTableSchema: (trx: Knex.Transaction) => Promise<Record<string, string>>,
  tempTableMap: Map<string, string>,
  returning: Returning = "none",
): Promise<Table[]> {
  if (values.length === 0) {
    return [];
  }

  const tempTable = await createTempTable(
    trx,
    table,
    [
      ...keyColumns,
      ...updateColumns,
      ...insertColumns,
    ] as (string | number)[],
    getTableSchema,
    tempTableMap,
  );

  const setFieldStr = (updateColumns as string[])
    .map((column) => `"${column}" = excluded."${column}"`)
    .join(", ");

  const insertFieldStr = (
    [...keyColumns, ...updateColumns, ...insertColumns] as string[]
  )
    .map((field) => `"${field}"`)
    .join(", ");

  const conflictFieldStr = (keyColumns as string[])
    .map((column) => `"${column}"`)
    .join(", ");

  const returningStr = returning === "changed" ? "returning *" : "";

  const whereStr = (updateColumns as string[])
    .map(
      (column) =>
        `"${table}"."${column}" is distinct from excluded."${column}"`,
    )
    .join(" or ");

  const upsertTableQuery = `
    insert into "${table}" (${insertFieldStr})
    (
      select distinct on (${conflictFieldStr}) ${insertFieldStr}
      from ${tempTable}
      order by ${conflictFieldStr}
    )
    on conflict (${conflictFieldStr}) do update
    set ${setFieldStr}
    where ${whereStr}
    ${returningStr}`;

  return finalizeReturn(
    trx,
    table,
    pickKeys([...keyColumns, ...insertColumns, ...updateColumns], values),
    keyColumns,
    tempTable,
    upsertTableQuery,
    returning,
  ) as Promise<Table[]>;
}

/**
 * Performs batch update operations.
 */
export async function batchUpdate<
  Table extends { [k: string]: unknown },
  KeyColumn extends keyof Table,
  UpdateColumn extends Exclude<keyof Table, KeyColumn>,
>(
  trx: Knex.Transaction,
  table: string,
  keyColumns: KeyColumn[],
  updateColumns: UpdateColumn[],
  values: Pick<Table, KeyColumn | UpdateColumn>[],
  getTableSchema: (trx: Knex.Transaction) => Promise<Record<string, string>>,
  tempTableMap: Map<string, string>,
  returning: Returning = "none",
): Promise<Table[]> {
  if (values.length === 0) {
    return [];
  }
  const tempTable = await createTempTable(
    trx,
    table,
    [
      ...keyColumns,
      ...updateColumns,
    ] as (string | number)[],
    getTableSchema,
    tempTableMap,
  );

  const insertFieldStr = ([...keyColumns, ...updateColumns] as string[])
    .map((field) => `"${field}"`)
    .join(", ");

  const conflictFieldStr = (keyColumns as string[])
    .map((column) => `"${column}"`)
    .join(", ");

  const setFieldStr = (updateColumns as string[])
    .map((column) => `"${column}" = "temp_table"."${column}"`)
    .join(", ");

  const whereUpdateStr = (updateColumns as string[])
    .map(
      (column) =>
        `"${table}"."${column}" is distinct from "temp_table"."${column}"`,
    )
    .join(" or ");

  const whereStr = (keyColumns as string[])
    .map((column) => `"${table}"."${column}" = "temp_table"."${column}"`)
    .concat([`(${whereUpdateStr})`])
    .join(" and ");

  const returningStr = returning === "changed" ? "returning *" : "";

  const updateTableQuery = `
    update "${table}"
    set ${setFieldStr}
    from (
      select distinct on (${conflictFieldStr}) ${insertFieldStr}
      from ${tempTable}
      order by ${conflictFieldStr}
    ) temp_table
    where ${whereStr}
    ${returningStr}
  `;
  return finalizeReturn(
    trx,
    table,
    pickKeys([...keyColumns, ...updateColumns], values),
    keyColumns,
    tempTable,
    updateTableQuery,
    returning,
  ) as Promise<Table[]>;
}
