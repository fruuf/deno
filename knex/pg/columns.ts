// deno-lint-ignore-file no-explicit-any
import { Json } from "../../util.ts";
import type {
  NullableColumns,
  PgBoolean,
  PgColumn,
  PgDate,
  PgDecimal,
  PgEnum,
  PgFloat,
  PgForward,
  PgInteger,
  PgJson,
  PgNullable,
  PgReference,
  PgString,
  PgTable,
  PgText,
  PgUuid,
  StaticPg,
} from "./types.ts";

function createColumn<Column extends PgColumn>(
  column: Omit<Column, "_pg" | "_debug" | "_source">,
) {
  return column as Column;
}

/**
 * Creates a PostgreSQL string column (varchar type)
 * @returns PgString column definition
 */
export function pgString(defaultValue?: string): PgString {
  return createColumn({ type: "string", default: defaultValue });
}

/**
 * Creates a PostgreSQL text column for unlimited length strings
 * @returns PgText column definition
 */
export function pgText(defaultValue?: string): PgText {
  return createColumn({ type: "text", default: defaultValue });
}

/**
 * Creates a PostgreSQL UUID column for unique identifiers
 * @returns PgUuid column definition
 */
export function pgUuid(): PgUuid {
  return createColumn({ type: "uuid" });
}

/**
 * Creates a PostgreSQL integer column (int4 type)
 * @param defaultValue - Optional default value for the column
 * @returns PgInteger column definition
 */
export function pgInteger(defaultValue?: number): PgInteger {
  return createColumn({
    type: "integer",
    default: defaultValue,
  });
}

/**
 * Creates a PostgreSQL float column (real type)
 * @param defaultValue - Optional default value for the column
 * @returns PgFloat column definition
 */
export function pgFloat(defaultValue?: number): PgFloat {
  return createColumn({
    type: "float",
    default: defaultValue,
  });
}

/**
 * Creates a PostgreSQL decimal column (numeric type) for exact numeric values
 * @param defaultValue - Optional default value for the column
 * @returns PgDecimal column definition
 */
export function pgDecimal(defaultValue?: bigint): PgDecimal {
  return createColumn({
    type: "decimal",
    default: defaultValue,
  });
}

/**
 * Creates a PostgreSQL boolean column
 * @param defaultValue - Optional default value for the column
 * @returns PgBoolean column definition
 */
export function pgBoolean(defaultValue?: boolean): PgBoolean {
  return createColumn({
    type: "boolean",
    default: defaultValue,
  });
}

/**
 * Creates a PostgreSQL date column (timestamptz type)
 * @returns PgDate column definition
 */
export function pgDate(): PgDate {
  return createColumn({ type: "date" });
}

/**
 * Creates a PostgreSQL enum column using varchar storage with TypeScript type safety
 * @param values - Array of allowed string values
 * @returns PgEnum column definition
 */
export function pgEnum<const Value extends string>(
  values: Value[],
  defaultValue?: Value,
): PgEnum<Value> {
  return createColumn({
    type: "enum",
    values,
    default: defaultValue,
  });
}

export function pgJson<Data extends Json>(): PgJson<Data> {
  return createColumn({
    type: "json",
  });
}

/**
 * Creates a foreign key reference to another table
 * @param table - The table to reference
 * @returns PgReference column definition
 */
export function pgReference<
  Table extends PgTable<any>,
>(
  table: Table,
): PgReference<Table> {
  return createColumn({ type: "reference", table: table });
}

/**
 * Wraps a column to make it nullable
 * @param column - The column to make nullable
 * @returns PgNullable column definition
 */
export function pgNullable<
  Column extends NullableColumns,
>(
  column: Column,
): PgNullable<Column> {
  return createColumn({ type: "nullable", column, default: column.default });
}

/**
 * Creates a forward reference to denormalize data from another table
 * @param table - The table containing the source data
 * @param key - The column key in the source table
 * @param reference - The reference column
 * @returns PgForward column definition
 */
export function pgForward<
  Table extends PgTable<any>,
  Key extends keyof StaticPg<Table>,
  Reference extends
    | PgReference<Table>
    | PgForward<any, any, any>
    | PgNullable<PgReference<Table>>,
>(
  table: Table,
  key: Key,
  reference: Reference,
): PgForward<Table, Key, Reference> {
  return createColumn({ type: "forward", table: table, key, reference });
}
