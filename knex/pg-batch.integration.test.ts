import { sortBy } from "jsr:@std/collections";
import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { expectAsyncError } from "../test.ts";
import { uuid } from "../util.ts";
import { getKnex, knexTransaction, setupKnex } from "./knex.ts";
import {
  applySchema,
  pgBatchInsert,
  pgBatchUpdate,
  pgBatchUpsert,
  pgFloat,
  pgInteger,
  pgNullable,
  pgSchema,
  pgString,
  pgTable,
  pgUnique,
  StaticPg,
} from "./pg.ts";

const schema = pgSchema("batch-test");

const tableUser = pgTable(schema, "batch_user", () => ({
  name: pgString(),
  age: pgNullable(pgInteger()),
}));
type TableUser = StaticPg<typeof tableUser>;
type User = Pick<TableUser, "id" | "name" | "age">;

const insertUsers = pgBatchInsert(tableUser, ["id"], ["name", "age"]);
const upsertUsers = pgBatchUpsert(tableUser, ["id"], ["name"], ["age"]);
const updateUsers = pgBatchUpdate(tableUser, ["id"], ["name"]);

// no pgUnique: the helper alone registers unique (currency, day)
const tableRate = pgTable(schema, "batch_rate", () => ({
  currency: pgString(),
  day: pgString(),
  rate: pgFloat(),
}));
const upsertRates = pgBatchUpsert(tableRate, ["currency", "day"], ["rate"]);

// no pgUnique: the helper alone registers unique (slug)
const tableTag = pgTable(schema, "batch_tag", () => ({
  slug: pgString(),
  label: pgString(),
}));
pgBatchUpdate(tableTag, ["slug"], ["label"]);

const tableBalance = pgTable(schema, "batch_balance", () => ({
  owner: pgString(),
  currency: pgString(),
  amount: pgFloat(),
}));
// registers unique (owner, currency), which the narrower pgUnique below absorbs
const upsertBalances = pgBatchUpsert(
  tableBalance,
  ["owner", "currency"],
  ["amount"],
);
pgUnique(tableBalance, ["owner"]);

const plain = (rows: TableUser[]): User[] =>
  sortBy(
    rows.map(({ id, name, age }) => ({ id, name, age })),
    ({ name }) => name,
  );

describe("pg batch helpers", () => {
  before(async () => {
    await setupKnex("batch-test");
    await applySchema("batch-test", null, schema);
  });

  const userA: User = { id: uuid(), name: "User A", age: null };
  const userB: User = { id: uuid(), name: "User B", age: 2 };
  const userC: User = { id: uuid(), name: "User C", age: null };
  const userD: User = { id: uuid(), name: "User D", age: null };

  it("registers a unique index on the key columns", async () => {
    const indexes = await getKnex("batch-test")("pg_indexes")
      .select("tablename", "indexdef")
      .whereIn("tablename", ["batch_rate", "batch_tag"]);
    const unique = (table: string, columns: string) =>
      indexes.some(({ tablename, indexdef }) =>
        tablename === table &&
        String(indexdef).startsWith("CREATE UNIQUE INDEX") &&
        String(indexdef).endsWith(`(${columns})`)
      );
    expect(unique("batch_rate", "currency, day")).toBe(true);
    expect(unique("batch_tag", "slug")).toBe(true);

    const row = { currency: "eur", day: "2026-10-21", rate: 1.08 };
    await knexTransaction("batch-test", (trx) => upsertRates(trx, [row]));
    const [changed] = await knexTransaction(
      "batch-test",
      (trx) => upsertRates(trx, [{ ...row, rate: 1.09 }], "changed"),
    );
    expect(changed.rate).toEqual(1.09);
  });

  it("batch inserts", async () => {
    const first = await knexTransaction(
      "batch-test",
      (trx) => insertUsers(trx, [userA], "changed"),
    );
    expect(plain(first)).toEqual([userA]);

    const second = await knexTransaction(
      "batch-test",
      (trx) => insertUsers(trx, [userA, userB], "changed"),
    );
    expect(plain(second)).toEqual([userB]);

    const all = await knexTransaction(
      "batch-test",
      (trx) => insertUsers(trx, [userA, userB], "all"),
    );
    expect(plain(all)).toEqual([userA, userB]);

    const none = await knexTransaction(
      "batch-test",
      (trx) => insertUsers(trx, [userA, userB], "changed"),
    );
    expect(none).toHaveLength(0);
  });

  it("batch upserts", async () => {
    const first = await knexTransaction(
      "batch-test",
      (trx) => upsertUsers(trx, [userA, userB, userC], "changed"),
    );
    expect(plain(first)).toEqual([userC]);

    const all = await knexTransaction(
      "batch-test",
      (trx) => upsertUsers(trx, [userA, userB, userC], "all"),
    );
    expect(plain(all)).toEqual([userA, userB, userC]);

    userA.name = `${userA.name} (changed)`;
    const changed = await knexTransaction(
      "batch-test",
      (trx) => upsertUsers(trx, [userA, userB, userC], "changed"),
    );
    expect(plain(changed)).toEqual([userA]);
  });

  it("batch updates", async () => {
    const none = await knexTransaction(
      "batch-test",
      (trx) => updateUsers(trx, [userA, userB, userC, userD], "changed"),
    );
    expect(none).toHaveLength(0);

    const all = await knexTransaction(
      "batch-test",
      (trx) => updateUsers(trx, [userA, userB, userC, userD], "all"),
    );
    expect(plain(all)).toEqual([userA, userB, userC]);

    userB.name = `${userB.name} (changed)`;
    const changed = await knexTransaction(
      "batch-test",
      (trx) => updateUsers(trx, [userA, userB, userC], "changed"),
    );
    expect(plain(changed)).toEqual([userB]);
  });

  // temp tables are reused per connection, leftover rows must not leak into the next batch
  it("runs several batches in one transaction", async () => {
    const idA = uuid();
    const idB = uuid();

    await knexTransaction("batch-test", async (trx) => {
      await insertUsers(trx, [
        { id: idA, name: "A", age: null },
        { id: idB, name: "B", age: null },
      ]);
      await trx<TableUser>("batch_user").update("name", "C").where("id", idA);
      await updateUsers(trx, [{ id: idB, name: "D" }]);
      await updateUsers(trx, [{ id: idB, name: "E" }]);

      const rows = await trx<TableUser>("batch_user").whereIn("id", [idA, idB]);
      expect(plain(rows).map(({ name }) => name)).toEqual(["C", "E"]);
    });
  });

  it("rejects a conflict target without an exact unique index", async () => {
    await expectAsyncError(
      () =>
        knexTransaction(
          "batch-test",
          (trx) =>
            upsertBalances(trx, [{ owner: "a", currency: "usd", amount: 1 }]),
        ),
      "no unique index on exactly \\(owner, currency\\)",
    );
  });
});
