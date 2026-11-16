// deno-lint-ignore-file no-explicit-any
import { assert } from "jsr:@std/assert";
import { Knex } from "npm:knex";
import { Transaction } from "../knex.ts";
import { compileSchema } from "./schema.ts";
import type { PgTable, StaticPg } from "./types.ts";
import { columnType, resolveColumn } from "./utils.ts";

/**
 * Looks up, for each request, the row with the highest order column value at or
 * before the requested one, among rows matching the request's key columns.
 * Registers a sort index on the key columns ordered by the order column, so index
 * merging keeps that column order (another pgQuery can't silently reorder it).
 * @returns A batch function returning one row or null per request, in request order
 */
export function pgMostRecent<
  Table extends PgTable<any>,
  KeyColumn extends keyof StaticPg<Table>,
  OrderColumn extends Exclude<keyof StaticPg<Table>, KeyColumn>,
>(
  table: Table,
  keyColumns: KeyColumn[],
  orderColumn: OrderColumn,
) {
  table.schema.indexes.push({
    type: "sort",
    table: table.name,
    columns: keyColumns as string[],
    where: {},
    orders: [orderColumn as string],
  });

  const keys = keyColumns as string[];
  const order = orderColumn as string;
  const columns = [...keys, order];
  let valueStr: string | null = null;

  // column types come from the compiled schema, resolved on first use once the
  // schema is complete
  function getValueStr() {
    if (valueStr === null) {
      const tables = compileSchema(table.schema);
      const compiled = tables.find(({ name }) => name === table.name);
      assert(compiled, `table "${table.name}" not found in its schema`);
      valueStr = [
        "?::int",
        ...columns.map((column) =>
          `?::${columnType(resolveColumn(compiled.columns[column], tables))}`
        ),
      ].join(", ");
    }
    return valueStr;
  }

  const fieldStr = columns.map((column) => `"${column}"`).join(", ");
  const whereStr = keys
    .map((column) => `"most_recent"."${column}" = "request"."${column}"`)
    .concat([`"most_recent"."${order}" <= "request"."${order}"`])
    .join(" and ");

  return async (
    trx: Knex | Transaction,
    requests: Pick<StaticPg<Table>, KeyColumn | OrderColumn>[],
  ): Promise<(StaticPg<Table> | null)[]> => {
    if (requests.length === 0) return [];

    const rowStr = `(${getValueStr()})`;
    const bindings = requests.flatMap((request, index) => [
      index,
      ...columns.map((column) => (request as Record<string, unknown>)[column]),
    ]);

    const rows: (StaticPg<Table> & { __request: number })[] = await trx.raw(
      `
        select "request"."__request", "result".*
        from (values ${requests.map(() => rowStr).join(", ")})
          as "request"("__request", ${fieldStr})
        left join lateral (
          select * from "${table.name}" as "most_recent"
          where ${whereStr}
          order by "most_recent"."${order}" desc
          limit 1
        ) as "result" on true
        order by "request"."__request"
      `,
      bindings as Knex.RawBinding[],
    );

    return rows.map(({ __request: _, ...row }) =>
      row.id === null ? null : row as unknown as StaticPg<Table>
    );
  };
}
