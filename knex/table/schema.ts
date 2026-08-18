import { Knex } from "npm:knex";
import { cacheHandler } from "../../cache.ts";

/**
 * Database schema information from information_schema.
 */
export type Schema = {
  table_name: string;
  table_schema: string;
  column_name: string;
  data_type: string;
};

/**
 * Return type for batch operations.
 */
export type Returning = "none" | "changed" | "all";

/**
 * Creates a cached function to retrieve table schema information.
 */
export function createSchemaGetter(table: string) {
  return cacheHandler(
    (_trx: Knex.Transaction) => "",
    async (_, trx) => {
      const columns = await trx<Schema>("information_schema.columns")
        .select("column_name", "data_type")
        .where({
          table_name: table,
          table_schema: "public",
        });

      return Object.fromEntries(
        columns.map(({ column_name, data_type }) => [column_name, data_type]),
      );
    },
  );
}
