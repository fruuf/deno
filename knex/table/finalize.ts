import { chunk } from "jsr:@std/collections";
import { Knex } from "npm:knex";
import { Returning } from "./schema.ts";

/**
 * Finalizes batch operation results by processing temp table data.
 */
export async function finalizeReturn<
  Table extends { [k: string]: unknown },
  KeyColumn extends keyof Table,
>(
  trx: Knex.Transaction,
  table: string,
  values: Pick<Table, KeyColumn>[],
  keyColumns: KeyColumn[],
  tempTable: string,
  query: string,
  returning: Returning,
): Promise<Table[]> {
  for (const nextChunk of chunk(values, 1000)) {
    await trx(tempTable).insert(nextChunk);
  }

  const changedResults = await trx.raw(query);

  if (returning === "none") {
    await trx(tempTable).truncate();
    return [];
  }
  if (returning === "changed") {
    await trx(tempTable).truncate();
    return changedResults;
  }

  const joinOnStr = (keyColumns as string[])
    .map((column) => `"${tempTable}"."${column}" = "${table}"."${column}"`)
    .join(" and ");

  const distinctStr = (keyColumns as string[])
    .map((column) => `"result"."${column}"`)
    .join(", ");

  const selectQuery = `
    select distinct on (${distinctStr}) "result".* from (
      select "${table}".* from "${table}"
      inner join "${tempTable}"
      on (${joinOnStr})
      for update
    ) "result"
    order by ${distinctStr}
  `;

  const allResults = await trx.raw(selectQuery);
  await trx(tempTable).truncate();
  return allResults;
}
