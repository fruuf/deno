import { distinct } from "jsr:@std/collections";
import { encodeHex } from "jsr:@std/encoding";
import { join } from "jsr:@std/path";
import { toCamelCase, toPascalCase } from "jsr:@std/text";
import { Knex } from "npm:knex";
import { logger } from "../log.ts";

/**
 * Database column metadata structure from PostgreSQL information schema
 */
export type Column = {
  table_name: string;
  column_name: string;
  not_nullable: string;
  udt_name: string;
};

/**
 * Parses database column metadata into TypeScript type information
 */
export function parseColumn({
  table_name,
  column_name,
  udt_name,
  not_nullable,
}: Column) {
  const isNullable = !not_nullable;

  const parsedColumn = {
    columnName: column_name,
    isNullable,
    parser: `row.${column_name}`,
    dependencies: [],
  };

  if (/(enum|status|type)$/.test(column_name) && udt_name === "varchar") {
    const type = toPascalCase(`${table_name}_${column_name}`);
    return {
      ...parsedColumn,
      tableType: type,
      parsedType: type,
      dependencies: [{ file: "./types.ts", type }],
    };
  }
  if (udt_name === "timestamptz" || udt_name === "date") {
    return {
      ...parsedColumn,
      tableType: "Date",
      parsedType: "number",
      parser: `Number(row.${column_name})`,
    };
  }

  if (udt_name === "uuid" || udt_name === "varchar" || udt_name === "text") {
    return {
      ...parsedColumn,
      tableType: "string",
      parsedType: "string",
    };
  }

  // not required due to types.setTypeParser(20, Number);
  // if (udt_name === "int8") {
  //   return {
  //     ...parsedColumn,
  //     tableType: "string",
  //     parsedType: "number",
  //     parser: `Number(row.${column_name})`,
  //   };
  // }

  if (
    udt_name === "float4" ||
    udt_name === "float8" ||
    udt_name === "int4" ||
    udt_name === "int8"
  ) {
    return {
      ...parsedColumn,
      tableType: "number",
      parsedType: "number",
    };
  }

  if (udt_name === "numeric") {
    return {
      columnName: column_name,
      isNullable,
      isGeneric: false,
      tableType: "bigint",
      parsedType: "number",
      parser: `Number(row.${column_name})`,
      dependencies: [],
    };
  }

  if (udt_name === "bool") {
    return {
      ...parsedColumn,
      tableType: "boolean",
      parsedType: "boolean",
    };
  }

  if (udt_name === "json" || udt_name === "jsonb") {
    const type = toPascalCase(`${table_name}_${column_name}`);
    return {
      ...parsedColumn,
      tableType: type,
      parsedType: type,
      dependencies: [{ file: "./types.ts", type }],
    };
  }

  if (udt_name === "cidr") {
    return {
      columnName: column_name,
      isNullable,
      isGeneric: false,
      tableType: "string",
      parsedType: "string",
      parser: `row.${column_name}`,
      dependencies: [],
    };
  }

  if (udt_name === "int8range") {
    return {
      columnName: column_name,
      isNullable,
      isGeneric: false,
      tableType: "string",
      parsedType: "string",
      parser: `row.${column_name}`,
      dependencies: [],
    };
  }

  throw new Error(
    `column type for "${udt_name}" in column "${column_name}" undefined`,
  );
}

/**
 * Generates TypeScript type definitions from database schema
 */
export async function writeTypes(knex: Knex, outputDir: string) {
  const tables = await knex<Column>("pg_attribute as a")
    .select(
      "t.relname as table_name",
      "a.attname as column_name",
      "ptt.typname as udt_name",
      "a.attnotnull as not_nullable",
    )
    .join("pg_class as t", "a.attrelid", "t.oid")
    .join("pg_namespace as s", "t.relnamespace", "s.oid")
    .join("pg_type as ptt", "ptt.oid", "a.atttypid")
    .join("pg_class as pc", "pc.relname", "t.relname")
    .leftJoin("pg_inherits as pi", "pi.inhrelid", "t.oid")
    .where("a.attnum", ">", 0)
    .where("a.attisdropped", false)
    .where("s.nspname", "public")
    .whereIn("pc.relkind", ["r", "m", "p"])
    .whereNull("pi.inhparent")
    .whereNotIn("t.relname", ["knex_migrations", "knex_migrations_lock"])
    .orderBy("t.relname")
    .orderBy("a.attnum");

  const tableTypes = Object.entries(
    Object.groupBy<string, Column>(tables, ({ table_name }) => table_name),
  )
    .map(([table, columns = []]) => ({
      tableName: table,
      tableType: toPascalCase(`table_${table}`),
      parsedType: toPascalCase(table),
      columns: columns
        .map(parseColumn)
        .sort((a, b) => a.columnName.localeCompare(b.columnName)),
    }))
    .sort((a, b) => a.tableName.localeCompare(b.tableName));

  const typeDependencies = (tableTypes.map((
    { columns },
  ) => (columns.map(({ dependencies }) => dependencies)).flat())).concat([{
    file: "@modules/knex",
    type: "createTable",
  }]).flat();

  const parsedTypes = tableTypes
    .map(
      ({
        tableName,
        tableType: parentTableType,
        parsedType: parentParsedType,
        columns,
      }) => {
        let tableTypeStr = columns
          .map(({ columnName, tableType, isNullable }) => {
            const isNullableStr = isNullable ? " | null" : "";
            return `  ${columnName}: ${tableType}${isNullableStr};`;
          })
          .join("\n");

        let parsedTypeStr = columns
          .map(({ columnName, parsedType, isNullable }) => {
            const isNullableStr = isNullable ? " | null" : "";
            const columnStr = toCamelCase(columnName);
            return `  ${columnStr}: ${parsedType}${isNullableStr};`;
          })
          .join("\n");

        tableTypeStr =
          `export type ${parentTableType} = {\n${tableTypeStr}\n};`;
        parsedTypeStr =
          `export type ${parentParsedType} = {\n${parsedTypeStr}\n};`;

        let typeParserStr = columns
          .map(({ columnName, parser, isNullable }) => {
            let parserStr = parser;
            if (isNullable) {
              parserStr = `row.${columnName} === null ? null : ${parserStr}`;
            }
            const columnStr = toCamelCase(columnName);
            return `    ${columnStr}: ${parserStr}`;
          })
          .join(",\n");

        typeParserStr =
          `export function parse${parentParsedType}Row(row: ${parentTableType}): ${parentParsedType} {\n  return {\n${typeParserStr}\n  };\n}`;

        let tableHelperStr = toCamelCase(`table_${tableName}`);
        tableHelperStr =
          `export const ${tableHelperStr} = createTable<${parentTableType}>("${tableName}");`;

        return [
          tableTypeStr,
          parsedTypeStr,
          typeParserStr,
          tableHelperStr,
        ].join("\n\n");
      },
    )
    .join("\n\n");

  const parsedDependencies = Object.entries(
    Object.groupBy(typeDependencies, ({ file }) => file),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, dependencies = []]) => {
      const typeStr = distinct(dependencies.map(({ type }) => type))
        .sort()
        .join(", ");

      return `import { ${typeStr} } from "${file}";`;
    })
    .join("\n");

  let contentStr = [parsedDependencies, parsedTypes]
    .filter(Boolean)
    .join("\n\n");

  contentStr = `${contentStr}\n`;

  const filename = join(outputDir, "database.ts");

  const currentStr = await Deno.readTextFile(filename).catch(() => "");

  const contentHash = encodeHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(contentStr),
    ),
  );

  if (currentStr.startsWith(`// ${contentHash}`)) return;

  await Deno.writeTextFile(filename, `// ${contentHash}\n${contentStr}`);
  logger.warn("write_db_schema", { filename });
}
