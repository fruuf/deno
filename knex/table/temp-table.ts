import { Knex } from "npm:knex";
import { randomString } from "../../util.ts";

/**
 * Creates a temporary table with specified columns for batch operations.
 */
export async function createTempTable<
  Table extends { [k: string]: unknown },
  Columns extends keyof Table,
>(
  trx: Knex.Transaction,
  table: string,
  columns: Columns[],
  getTableSchema: (trx: Knex.Transaction) => Promise<Record<string, string>>,
  tempTableMap: Map<string, string>,
) {
  const key = (columns as (string | number)[]).join("|");
  let tempTable = tempTableMap.get(key);

  if (!tempTable) {
    const random = randomString(16).toLowerCase();
    // postgres has a limit of 63 chars, lets make sure we stay below that
    tempTable = `${table.substr(0, 32)}__${random}`;
    tempTableMap.set(key, tempTable);
  }

  const schema = await getTableSchema(trx);

  const columnStr = (columns as (string | number)[])
    .map((column) => `"${column}" ${schema[String(column)]}`)
    .join(", ");

  await trx.raw(
    `create temp table if not exists "${tempTable}"(${columnStr}) on commit delete rows; `,
  );

  return tempTable;
}
