// deno-lint-ignore-file no-explicit-any
import { Knex } from "npm:knex";
import { Transaction } from "../knex.ts";
import { isPgHelper } from "./helper.ts";
import type { PgTable, PgTableParameters, StaticPg, Where } from "./types.ts";

/**
 * Generates SQL WHERE clause bindings for a table.
 */
export function whereSql(
  table: string,
  where: Record<string, unknown>,
) {
  const parts = Object.entries(where)
    .map(([key, binding]) => {
      const bindings: unknown[] = [binding];
      if (isPgHelper(binding)) {
        return {
          bindings: binding.bindings,
          sql: `"${table}"."${key}" ${binding.query}`,
        };
      }

      if (binding instanceof Array) {
        return { bindings, sql: `"${table}"."${key}" = any(?)` };
      }

      if (binding === null) {
        return { bindings: [], sql: `"${table}"."${key}" is null` };
      }

      return {
        bindings: [binding],
        sql: `"${table}"."${key}" = ?`,
      };
    });

  const bindings = parts.map(({ bindings }) => bindings).flat() as string[];
  const sql = parts.map(({ sql }) => sql).join(" and ");
  return { bindings, sql };
}

/**
 * Creates a query builder with automatic index creation for efficient querying.
 */
export function pgQuery<
  Table extends PgTable<any>,
  ParameterColumn extends keyof StaticPg<Table>,
  WhereColumn extends keyof StaticPg<Table>,
  OrderColumn extends Exclude<keyof StaticPg<Table>, ParameterColumn>,
>(
  table: Table,
  parameters: ParameterColumn[],
  where: Where<StaticPg<Table>, WhereColumn> = {} as any,
  orders: OrderColumn[] = [],
) {
  table.schema.indexes.push({
    type: "sort",
    table: table.name,
    columns: parameters as string[],
    where,
    orders: orders as string[],
  });
  const wherePart = whereSql(table.name, where);
  return (
    trx: Knex | Transaction,
    parameters: PgTableParameters<Table, ParameterColumn>,
  ) => {
    let query = trx<StaticPg<Table>>(`${table.name}`);
    if (wherePart.bindings.length > 0) {
      query = query.whereRaw(wherePart.sql, wherePart.bindings);
    }
    for (const [key, value] of Object.entries(parameters)) {
      if (value instanceof Array) {
        query = query.whereIn(
          `${table.name}.${key}`,
          value,
        );
      } else {
        query = query.where(`${table.name}.${key}`, value);
      }
    }

    return query;
  };
}

/**
 * Defines a unique constraint/index on specified columns.
 */
export function pgUnique<
  Table extends PgTable<any>,
  ParameterColumn extends keyof StaticPg<Table>,
  WhereColumn extends Exclude<keyof StaticPg<Table>, ParameterColumn>,
>(
  table: Table,
  parameters: ParameterColumn[],
  where: Where<StaticPg<Table>, WhereColumn> = {} as any,
) {
  table.schema.indexes.push({
    type: "unique",
    table: table.name,
    columns: parameters as string[],
    where,
  });
}
