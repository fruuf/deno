import { Knex } from "npm:knex";
import {
  batchInsert as batchInsertInternal,
  batchUpdate as batchUpdateInternal,
  batchUpsert as batchUpsertInternal,
  upsert as upsertInternal,
} from "./table/batch-operations.ts";
import { createSchemaGetter } from "./table/schema.ts";
import { createTempTable as createTempTableInternal } from "./table/temp-table.ts";

// Re-export types
export type { Returning, Schema } from "./table/schema.ts";

/**
 * Creates helper functions for batch operations on a database table
 */
export function createTable<Table extends { [k: string]: unknown }>(
  table: string,
) {
  const getTableSchema = createSchemaGetter(table);
  const tempTableMap = new Map<string, string>();

  function createTempTable<Columns extends keyof Table>(
    trx: Knex.Transaction,
    columns: Columns[],
  ) {
    return createTempTableInternal(
      trx,
      table,
      columns as (string | number)[],
      getTableSchema,
      tempTableMap,
    );
  }

  function batchInsert<
    KeyColumn extends keyof Table,
    InsertColumn extends Exclude<keyof Table, KeyColumn>,
  >(
    trx: Knex.Transaction,
    keyColumns: KeyColumn[],
    insertColumns: InsertColumn[],
    values: Pick<Table, KeyColumn | InsertColumn>[],
    returning: import("./table/schema.ts").Returning = "none",
  ): Promise<Table[]> {
    return batchInsertInternal(
      trx,
      table,
      keyColumns,
      insertColumns,
      values,
      getTableSchema,
      tempTableMap,
      returning,
    );
  }

  function upsert<
    KeyColumn extends keyof Table,
    UpdateColumn extends Exclude<keyof Table, KeyColumn>,
    InsertColumn extends Exclude<keyof Table, KeyColumn | UpdateColumn>,
  >(
    trx: Knex.Transaction,
    keyColumns: KeyColumn[],
    updateColumns: UpdateColumn[],
    insertColumns: InsertColumn[],
    value: Pick<Table, KeyColumn | UpdateColumn | InsertColumn>,
  ): Promise<Table> {
    return upsertInternal(
      trx,
      table,
      keyColumns,
      updateColumns,
      insertColumns,
      value,
    );
  }

  function batchUpsert<
    KeyColumn extends keyof Table,
    UpdateColumn extends Exclude<keyof Table, KeyColumn>,
    InsertColumn extends Exclude<keyof Table, KeyColumn | UpdateColumn>,
  >(
    trx: Knex.Transaction,
    keyColumns: KeyColumn[],
    updateColumns: UpdateColumn[],
    insertColumns: InsertColumn[],
    values: Pick<Table, KeyColumn | UpdateColumn | InsertColumn>[],
    returning: import("./table/schema.ts").Returning = "none",
  ): Promise<Table[]> {
    return batchUpsertInternal(
      trx,
      table,
      keyColumns,
      updateColumns,
      insertColumns,
      values,
      getTableSchema,
      tempTableMap,
      returning,
    );
  }

  function batchUpdate<
    KeyColumn extends keyof Table,
    UpdateColumn extends Exclude<keyof Table, KeyColumn>,
  >(
    trx: Knex.Transaction,
    keyColumns: KeyColumn[],
    updateColumns: UpdateColumn[],
    values: Pick<Table, KeyColumn | UpdateColumn>[],
    returning: import("./table/schema.ts").Returning = "none",
  ): Promise<Table[]> {
    return batchUpdateInternal(
      trx,
      table,
      keyColumns,
      updateColumns,
      values,
      getTableSchema,
      tempTableMap,
      returning,
    );
  }

  return { createTempTable, batchInsert, batchUpsert, batchUpdate, upsert };
}
