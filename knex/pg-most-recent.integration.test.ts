import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { getKnex, knexTransaction, setupKnex } from "./knex.ts";
import {
  applySchema,
  pgDate,
  pgFloat,
  pgMostRecent,
  pgQuery,
  pgSchema,
  pgString,
  pgTable,
  pgUnique,
  StaticPg,
} from "./pg.ts";
import { compileSchema } from "./pg/schema.ts";

const schema = pgSchema("most-recent-test");

const tableRate = pgTable(schema, "recent_rate", () => ({
  currency: pgString(),
  market: pgString(),
  date: pgDate(),
  rate: pgFloat(),
}));
type TableRate = StaticPg<typeof tableRate>;
pgUnique(tableRate, ["currency", "market", "date"]);

const mostRecentRate = pgMostRecent(tableRate, ["currency", "market"], "date");

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("pgMostRecent", () => {
  before(async () => {
    await setupKnex("most-recent-test");
    await applySchema("most-recent-test", null, schema);
    await getKnex("most-recent-test")<TableRate>("recent_rate").insert([
      { currency: "btc", market: "spot", date: day(1), rate: 1 },
      { currency: "btc", market: "spot", date: day(3), rate: 3 },
      { currency: "btc", market: "spot", date: day(5), rate: 5 },
      { currency: "btc", market: "otc", date: day(2), rate: 20 },
      { currency: "eth", market: "spot", date: day(4), rate: 40 },
    ]);
  });

  it("returns the latest row at or before each request, in request order", async () => {
    const rows = await mostRecentRate(getKnex("most-recent-test"), [
      { currency: "btc", market: "spot", date: day(4) },
      { currency: "btc", market: "spot", date: day(3) }, // exact match
      { currency: "btc", market: "otc", date: day(9) }, // other key column
      { currency: "eth", market: "spot", date: day(3) }, // before the first row
      { currency: "doge", market: "spot", date: day(9) }, // unknown key
      { currency: "btc", market: "spot", date: day(4) }, // duplicate request
    ]);
    expect(rows.map((row) => row?.rate ?? null)).toEqual([
      3,
      3,
      20,
      null,
      null,
      3,
    ]);
    expect(rows[0]?.date).toEqual(day(3));
  });

  it("returns nothing for no requests", async () => {
    expect(await mostRecentRate(getKnex("most-recent-test"), [])).toEqual([]);
  });

  it("uses a backward scan on the (keys, order) index", async () => {
    await knexTransaction("most-recent-test", async (trx) => {
      // tiny table: force the planner off sequential scans to see the index is usable
      await trx.raw("set local enable_seqscan = off");
      const plan: { "QUERY PLAN": string }[] = await trx.raw(
        `explain select * from "recent_rate" as "most_recent"
          where "most_recent"."currency" = ? and "most_recent"."market" = ?
          and "most_recent"."date" <= ?::timestamptz
          order by "most_recent"."date" desc limit 1`,
        ["btc", "spot", day(4)],
      );
      expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toMatch(
        /Index Scan Backward using recent_rate_unique_\w+/,
      );
    });
  });

  it("keeps the unique index order when another query needs the order column", () => {
    const otherSchema = pgSchema("most-recent-merge");
    const table = pgTable(otherSchema, "rate", () => ({
      currency: pgString(),
      date: pgDate(),
    }));
    pgUnique(table, ["currency", "date"]);
    pgMostRecent(table, ["currency"], "date");
    pgQuery(table, ["date"]);

    // the unique index keeps (currency, date) and the date query gets its own index,
    // instead of the date query reordering the unique index
    const [compiled] = compileSchema(otherSchema);
    const layout = compiled.indexes
      .filter((index) =>
        !(index.columns.length === 1 && index.columns[0] === "id")
      )
      .map((index) =>
        `${index.type}(${[
          ...index.columns,
          ...(index.type === "sort" ? index.orders : []),
        ]})`
      );
    expect(layout.sort()).toEqual(["sort(date)", "unique(currency,date)"]);
  });
});
