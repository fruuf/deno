import { logger } from "../../log.ts";
import { asyncQueue } from "../../queue.ts";
import { isValue } from "../../util.ts";
import { Transaction } from "../knex.ts";
import type { Table } from "./types.ts";
import { columnNullable, columnType, resolveColumn } from "./utils.ts";

type ColumnTable = {
  table_name: string;
  column_name: string;
  is_nullable: "YES" | "NO";
  udt_name: string;
  column_default: string | null;
};

// deno-lint-ignore no-explicit-any
function toColumnDefault(type: string | null, value: any) {
  if (type === null) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return null;
  }
  if (type === "varchar" || type === "text") {
    return `'${value}'::character varying`;
  }
  return String(value);
}

/**
 * Applies table schema changes to the database, creating or altering tables as needed.
 */
export async function applyTables(trx: Transaction, tables: Table[]) {
  await trx.raw('create extension if not exists "uuid-ossp";');

  const currentTables = await trx("information_schema.columns")
    .select<ColumnTable[]>(
      "table_name",
      "column_name",
      "udt_name",
      "is_nullable",
      "column_default",
    )
    .whereIn("table_name", tables.map((table) => table.name)).where(
      "table_schema",
      "public",
    );

  await Promise.all(tables.map(asyncQueue(async (table) => {
    const currentColumns = currentTables.filter((column) =>
      column.table_name === table.name
    );

    const nextColumns = Object.entries(table.columns)
      .map(([key, column]) => {
        const nextColumn = resolveColumn(column, tables);
        return {
          key,
          type: columnType(nextColumn),
          nullable: columnNullable(nextColumn),
          default: nextColumn.default ?? null,
        };
      });

    if (currentColumns.length === 0) {
      const columns = nextColumns.map((column) => {
        const nextDefault = toColumnDefault(column.type, column.default);

        const defaultStr = nextDefault === null
          ? null
          : `default ${nextDefault}`;

        const notNullStr = column.nullable ? null : "not null";

        return [`"${column.key}" ${column.type}`, notNullStr, defaultStr]
          .filter(isValue).join(" ");
      });
      const query = `create table "${table.name}" (${columns.join(", ")})`;
      logger.info("create_table", { query });
      await trx.raw(query);
      return;
    }

    const actions = [
      ...new Set(
        currentColumns.map((column) => column.column_name).concat(
          nextColumns.map((column) => column.key),
        ),
      ),
    ].map((key) => {
      const currentColumn = currentColumns.find((column) =>
        column.column_name === key
      );
      const nextColumn = nextColumns.find((column) => column.key === key);
      if (!nextColumn) {
        return { action: "drop" as const, key };
      }

      const nextDefault = toColumnDefault(nextColumn.type, nextColumn.default);

      if (
        currentColumn &&
        ((currentColumn.udt_name !== nextColumn.type) ||
          (nextColumn.nullable !== (currentColumn.is_nullable === "YES")) ||
          (currentColumn?.column_default !== nextDefault))
      ) {
        return {
          action: "alter" as const,
          key,
          type: nextColumn.type,
          nullable: nextColumn.nullable,
          default: nextDefault,
          prevType: currentColumn.udt_name,
          prevNullable: currentColumn.is_nullable === "YES",
          prevDefault: currentColumn?.column_default,
        };
      }
      if (!currentColumn) {
        return {
          action: "create" as const,
          key,
          type: nextColumn.type,
          nullable: nextColumn.nullable,
          default: nextDefault,
        };
      }
      return null;
    }).filter(isValue);

    const alterStr = actions.map((action) => {
      if (action.action === "create") {
        if (action.nullable) {
          return [
            `add column "${action.key}" ${action.type} default ${action.default}`,
          ];
        }
        return [
          `add column "${action.key}" ${action.type} not null default ${action.default}`,
        ];
      }
      if (action.action === "alter") {
        const typeStr = action.type !== action.prevType &&
            `type ${action.type} using ("${action.key}"::${action.type})` ||
          null;

        const nullableStr =
          action.nullable && !action.prevNullable && "drop not null" ||
          !action.nullable && action.prevNullable && "set not null" ||
          null;

        const defaultStr = (action.default &&
          `set default ${action.default}`) ||
          (!action.default && action.prevDefault && "drop default") ||
          null;

        return [typeStr, defaultStr, nullableStr].filter(isValue).map((part) =>
          `alter column "${action.key}" ${part}`
        );
      }
      if (action.action === "drop") {
        return [`drop column "${action.key}"`];
      }
      throw new Error(`Unknown action: ${String(action)}`);
    }).flat().join(", ");

    if (alterStr) {
      const query = `alter table "${table.name}" ${alterStr}`;
      logger.info("alter_table", { query });
      await trx.raw(query);
    }
  })));
}
