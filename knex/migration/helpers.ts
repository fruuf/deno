import { Transaction } from "../knex.ts";

/**
 * Adds a UUID primary key to table and ensures it is populated
 */
export async function uuidPKey(trx: Transaction, table: string) {
  await trx.raw('create extension if not exists "uuid-ossp";');
  await trx.raw(
    `alter table ?? add id uuid primary key default uuid_generate_v4();`,
    [table],
  );
}
