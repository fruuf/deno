import { assert, equal } from "jsr:@std/assert";
import { logger } from "../../log.ts";
import { asyncQueue } from "../../queue.ts";
import { isValue } from "../../util.ts";
import { Transaction } from "../knex.ts";
import { hashIndex, whereSql } from "./indexes.ts";
import type { Table } from "./types.ts";

type AppliedDropIndex = {
  type: "drop";
  name: string;
};

type AppliedPrimaryIndex = {
  type: "primary";
  name: string;
  table: string;
};

export type AppliedIndex = AppliedDropIndex | AppliedPrimaryIndex;

/**
 * Applies index changes to database tables, creating or dropping indexes as needed.
 */
export async function applyIndexes(
  trx: Transaction,
  tables: Table[],
): Promise<AppliedIndex[]> {
  type IndexTable = {
    table_name: string;
    index_name: string;
  };

  const currentIndexes = await trx("pg_indexes")
    .select<IndexTable[]>("tablename as table_name", "indexname as index_name")
    .where("schemaname", "public")
    .whereIn("tablename", tables.map((table) => table.name));

  const nextIndexes = tables.map((table) => table.indexes).flat().map(
    (index) => {
      const hash = hashIndex(index);
      const name = index.type === "unique"
        ? `${index.table}_unique_${hash}`
        : `${index.table}_index_${hash}`;
      return {
        ...index,
        hash: hashIndex(index),
        name,
      };
    },
  );

  const allIndexes = currentIndexes.map((index) => index.index_name).concat(
    nextIndexes.map((index) => index.name),
  );

  const dropIndexes = await Promise.all(
    allIndexes.map(asyncQueue(async (name) => {
      const currentIndex = currentIndexes.find((index) =>
        index.index_name === name
      );
      const nextIndex = nextIndexes.find((index) => index.name === name);
      if (currentIndex && nextIndex) {
        return;
      }
      if (currentIndex) {
        return name;
      }
      if (!nextIndex) {
        return;
      }

      const typeStr = nextIndex.type === "unique" ? "unique index" : "index";
      const columns = nextIndex.type === "unique"
        ? nextIndex.columns
        : [...nextIndex.columns, ...nextIndex.orders];
      const columnStr = columns.map((column) => `"${column}"`);

      const where = whereSql(nextIndex.table, nextIndex.where);
      if (where.bindings.length === 0) {
        const query =
          `create ${typeStr} "${name}" on "${nextIndex.table}" (${columnStr})`;
        logger.info("create_index", { query });
        await trx.raw(query);
        return;
      }
      const query = trx.raw(
        `create ${typeStr} "${name}" on "${nextIndex.table}" (${columnStr}) where ${where.sql}`,
        where.bindings,
      ).toQuery();
      logger.info("create_index", { query });
      await trx.raw(query);
    })),
  );

  const appliedPrimaryIndexes: AppliedPrimaryIndex[] = tables.map((table) => {
    const primaryIndex = nextIndexes.find((index) =>
      index.type === "unique" &&
      index.table === table.name &&
      equal(index.columns, ["id"]) &&
      equal(index.where, {})
    );
    assert(primaryIndex);
    return { type: "primary", name: primaryIndex.name, table: table.name };
  });

  const appliedDropIndexes: AppliedDropIndex[] = dropIndexes.filter(isValue)
    .map((name): AppliedDropIndex => ({
      type: "drop",
      name,
    }));

  return [...appliedPrimaryIndexes, ...appliedDropIndexes];
}

/**
 * Drops indexes that were marked for removal during the apply process.
 */
export async function dropIndexes(
  trx: Transaction,
  appliedIndexes: AppliedIndex[],
) {
  await Promise.all(
    appliedIndexes.filter((index) => index.type === "drop").map(
      asyncQueue(async (index) => {
        const query = `drop index "${index.name}"`;
        logger.info("drop_index", { query });
        await trx.raw(query);
      }),
    ),
  );
}
