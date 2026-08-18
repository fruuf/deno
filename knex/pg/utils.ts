// deno-lint-ignore-file no-explicit-any
import { assert } from "jsr:@std/assert";
import { crypto } from "jsr:@std/crypto";
import { encodeBase32 } from "jsr:@std/encoding";
import { checkNever } from "../../util.ts";
import type { PgColumn, PgColumns, PgForward, Table } from "./types.ts";

const textEncoder = new TextEncoder();

/**
 * Generates a 6-character MD5 hash of any value
 * @param value - Value to hash
 * @returns 6-character hash string
 */
export function hash(
  value: unknown,
) {
  return encodeBase32(
    crypto.subtle.digestSync("MD5", textEncoder.encode(JSON.stringify(value))),
  ).substring(0, 6).toLowerCase();
}

/**
 * Resolves forward references in a column definition to their actual types
 * @param column - Column to resolve
 * @param tables - Available tables for resolution
 * @returns Resolved column without forward references
 */
export function resolveColumn(
  column: PgColumn,
  tables: Table[],
): Exclude<PgColumn, PgForward<any, any, any>> {
  if (column.type !== "forward") {
    return column;
  }
  const table = tables.find((table) => table.name === column.table.name);
  assert(table);
  const source = resolveColumn(table.columns[column.key], tables);
  const reference = resolveColumn(column.reference, tables);
  if (source.type === "nullable") {
    return source;
  }
  if (reference.type === "nullable") {
    return { type: "nullable", column: source, default: null } as any;
  }
  return source;
}

/**
 * Generates a hash for a column definition
 * @param column - Column to hash
 * @returns Hash string
 */
export function hashColumn(column: PgColumn): string {
  if (column.type === "forward") {
    return hash({
      type: "forward",
      table: column.table.name,
      key: column.key,
      reference: hashColumn(column.reference),
    });
  }
  if (column.type === "nullable") {
    return hash({
      type: "nullable",
      column: hashColumn(column.column),
    });
  }
  if (column.type === "reference") {
    return hash({
      type: "reference",
      table: column.table.name,
      default: column.default,
    });
  }
  return hash(
    Object.entries(column)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

/**
 * Converts column object to sorted array of key-column pairs
 * @param pgColumns - Column definitions object
 * @returns Sorted array of {key, column} objects
 */
export function pgColumnsArray(pgColumns: PgColumns) {
  return Object.entries(pgColumns)
    .map(([key, column]) => ({ key, column }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Maps column types to PostgreSQL data types
 * @param column - Column definition
 * @returns PostgreSQL data type string
 */
export function columnType(
  column: Exclude<PgColumn, PgForward<any, any, any>>,
): string {
  if (column.type === "nullable") {
    return columnType(column.column);
  }
  if (column.type === "string") {
    return "varchar";
  }
  if (column.type === "text") {
    return "text";
  }
  if (column.type === "uuid") {
    return "uuid";
  }
  if (column.type === "reference") {
    return "uuid";
  }
  if (column.type === "boolean") {
    return "bool";
  }
  if (column.type === "integer") {
    return "int8";
  }
  if (column.type === "float") {
    return "float8";
  }
  if (column.type === "decimal") {
    return "numeric";
  }
  if (column.type === "date") {
    return "timestamptz";
  }
  if (column.type === "enum") {
    return "varchar";
  }
  if (column.type === "json") {
    return "jsonb";
  }
  return checkNever(column);
}

/**
 * Determines if a column is nullable
 * @param column - Column definition
 * @returns True if column is nullable
 */
export function columnNullable(
  column: Exclude<PgColumn, PgForward<any, any, any>>,
): boolean {
  if (column.type === "nullable") {
    return true;
  }
  return false;
}

/**
 * Merges two column definition objects, throwing on conflicts
 * @param baseColumns - First columns object
 * @param additionalColumns - Second columns object
 * @returns Merged columns object
 */
export function mergeColumns(
  baseColumns: PgColumns,
  additionalColumns: PgColumns,
) {
  const allKeys = [
    ...new Set([
      ...Object.keys(baseColumns),
      ...Object.keys(additionalColumns),
    ]),
  ].sort();
  return Object.fromEntries(
    allKeys.map((key) => {
      const baseColumn = baseColumns[key];
      const additionalColumn = additionalColumns[key];
      if (baseColumn && additionalColumn) {
        throw new Error(
          `column ${key} (${baseColumn.type}, ${additionalColumn.type})`,
        );
      }
      return [key, baseColumn || additionalColumn];
    }),
  );
}
