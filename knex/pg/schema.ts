// deno-lint-ignore-file no-explicit-any
import { assert } from "jsr:@std/assert";
import { isValue } from "../../util.ts";
import { hashIndex, mergeIndexes } from "./indexes.ts";
import type {
  Index,
  PgColumn,
  PgColumns,
  PgDate,
  PgSchema,
  PgTable,
  PgUuid,
  Table,
} from "./types.ts";
import { hash, hashColumn, mergeColumns, pgColumnsArray } from "./utils.ts";

/**
 * Creates a PostgreSQL schema definition
 * @param name - The schema name
 * @returns PgSchema object
 */
export function pgSchema(name: string): PgSchema {
  return { name, tables: {}, indexes: [] };
}

/**
 * Creates a PostgreSQL table definition within a schema
 * @param schema - The schema to add the table to
 * @param name - The table name
 * @param columns - Function returning column definitions
 * @returns PgTable object
 */
export function pgTable<Columns extends PgColumns>(
  schema: PgSchema,
  name: string,
  columns: () => Columns,
): PgTable<Columns> {
  let tables = schema.tables[name];
  if (!tables) {
    tables = [];
    schema.tables[name] = tables;
  }
  tables.push(columns);
  return { name, schema } as any;
}

/**
 * Extends an existing table with additional columns
 * @param table - The table to extend
 * @param columns - Function returning additional column definitions
 * @returns Extended PgTable object
 */
export function pgExtend<
  Table extends PgTable<any>,
  Columns extends PgColumns,
>(
  table: Table,
  columns: () => Columns,
): PgTable<Table["_columns"] & Columns> {
  let tables = table.schema.tables[table.name];
  if (!tables) {
    tables = [];
    table.schema.tables[table.name] = tables;
  }
  tables.push(columns);
  return { name: table.name, schema: table.schema } as any;
}

/**
 * Generates a hash for a table's structure including columns and indexes
 * @param table - The table to hash
 * @returns Hash string
 */
export function hashTable(table: Table) {
  return hash({
    table: table.name,
    columns: pgColumnsArray(table.columns)
      .map(({ key, column }) => ({ key, hash: hashColumn(column) })),
    indexes: table.indexes.map(hashIndex).sort(),
  });
}

/**
 * Generates a hash for multiple tables' structures
 * @param tables - Array of tables to hash
 * @returns Hash string
 */
export function hashTables(tables: Table[]) {
  return hash(tables.map(hashTable).sort());
}

function mergeTables(tables: Table[]) {
  function mergeGroupTables([first, second, ...rest]: Table[]): Table {
    if (!second) {
      return first;
    }
    const nextTable: Table = {
      name: first.name,
      columns: mergeColumns(first.columns, second.columns),
      indexes: [...first.indexes, ...second.indexes],
    };
    return mergeGroupTables([nextTable, ...rest]);
  }

  return Object.values(Object.groupBy(tables, ({ name: table }) => table))
    .filter(isValue)
    .map((tables) => mergeGroupTables(tables));
}

function createColumn<Column extends PgColumn>(
  column: Omit<Column, "_pg" | "_debug" | "_source">,
) {
  return column as Column;
}

/**
 * Compiles a schema definition into table structures with merged columns and indexes
 * @param schema - The schema to compile
 * @returns Array of compiled table definitions
 */
export function compileSchema(schema: PgSchema) {
  const tables = mergeTables(
    Object.entries(schema.tables)
      .map(
        ([table, handlers]): Table => {
          const columns = mergeColumns(
            handlers.reduce(
              (columns, handler) => mergeColumns(columns, handler()),
              {},
            ),
            {
              id: createColumn<PgUuid>({
                type: "uuid",
                default: "uuid_generate_v4()",
              }),
              created_at: createColumn<PgDate>({
                type: "date",
                default: "now()",
              }),
              updated_at: createColumn<PgDate>({
                type: "date",
                default: "now()",
              }),
            },
          );
          const columnsArray = pgColumnsArray(columns);
          const indexes = columnsArray
            .map(({ key, column }): Index | null => {
              const nextColumn = column.type === "nullable"
                ? column.column
                : column;
              if (nextColumn.type === "reference") {
                return {
                  type: "sort",
                  table,
                  columns: [key],
                  where: {},
                  orders: [],
                };
              }
              if (nextColumn.type === "forward") {
                const reference = columnsArray.find((find) =>
                  find.column === nextColumn.reference
                );
                assert(
                  reference,
                  `reference not found for table "${table}" on key ${key}`,
                );
                return {
                  type: "sort",
                  table,
                  columns: [reference.key],
                  where: {},
                  orders: [],
                };
              }
              return null;
            })
            .filter(isValue)
            .concat([{
              type: "unique",
              table,
              columns: ["id"],
              where: {},
            }]);

          return { name: table, columns, indexes };
        },
      ),
  );

  const indexes = schema.indexes.concat(
    tables.map((table) => table.indexes).flat(),
  );

  const nextTables = tables.map((table) => {
    const tableIndexes = mergeIndexes(
      indexes.filter((index) => index.table === table.name),
    );

    return {
      ...table,
      indexes: tableIndexes,
    };
  });

  return nextTables;
}
