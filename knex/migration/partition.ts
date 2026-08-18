import { randomString } from "../../util.ts";
import { Transaction } from "../knex.ts";

/**
 * Partitions a table by hash on specified column into 2^exponent partitions
 */
export async function partitionTable(
  trx: Transaction,
  table: string,
  column = "id",
  skipIndexes: string[] = [],
  exponent = 4,
) {
  const partitions = 2 ** exponent;
  const tableVersion = randomString(8);

  await trx.raw(`lock table "${table}" in access exclusive mode`);

  type ForeignKey = {
    table_name: string;
    foreign_key: string;
    definition: string;
  };

  const foreignKeys: ForeignKey[] = await trx("pg_constraint")
    .select(
      trx.raw("conrelid::regclass AS table_name"),
      trx.raw("conname AS foreign_key"),
      trx.raw("pg_get_constraintdef(pg_constraint.oid) as definition"),
    )
    .innerJoin("pg_class", "pg_class.oid", "pg_constraint.confrelid")
    .whereRaw("pg_constraint.connamespace = 'public'::regnamespace")
    .where("pg_constraint.contype", "f")
    .where("pg_class.relkind", "r")
    .where("pg_class.relname", table);

  for (const foreignKey of foreignKeys) {
    await trx.raw(
      `alter table "${foreignKey.table_name}" drop constraint "${foreignKey.foreign_key}"`,
    );
  }

  type Index = {
    indexname: string;
    indexdef: string;
  };

  const indexes = await trx<Index>("pg_indexes")
    .where("schemaname", "public")
    .where("tablename", table);

  type Unlogged = {
    relpersistence: string;
    relname: string;
  };

  const unlogged = await trx<Unlogged>("pg_class")
    .select(["relpersistence", "relname"])
    .where("relname", table);

  if (unlogged.length !== 1) {
    throw new Error(`"${table}" must have exactly one pg_class entry`);
  }

  await trx.raw(`alter table "${table}" rename to "${table}_${tableVersion}"`);

  const unloggedStr = unlogged[0].relpersistence === "u" ? "unlogged" : "";

  await trx.raw(
    `create ${unloggedStr} table "${table}" (like "${table}_${tableVersion}" including all excluding indexes) partition by hash ("${column}");`,
  );

  for (let partition = 0; partition < partitions; partition += 1) {
    await trx.raw(
      `create ${unloggedStr} table "${table}_${partition}" partition of "${table}" for values with (modulus ${partitions}, remainder ${partition})`,
    );
  }

  await trx.raw(
    `insert into "${table}" (select * from "${table}_${tableVersion}")`,
  );

  await trx.raw(`drop table "${table}_${tableVersion}"`);

  for (const index of indexes) {
    if (!skipIndexes.includes(index.indexname)) await trx.raw(index.indexdef);
  }

  for (const foreignKey of foreignKeys) {
    await trx.raw(
      `alter table "${foreignKey.table_name}" add constraint "${foreignKey.foreign_key}" ${foreignKey.definition}`,
    );
  }
}
