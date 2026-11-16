import { expect } from "jsr:@std/expect";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { Knex } from "npm:knex";
import { errorHandler } from "../../error.ts";
import { expectAsyncError } from "../../test.ts";
import { uuid, wait } from "../../util.ts";
import { iterateQuery } from "../helper.ts";
import {
  getKnex,
  knexTransaction,
  knexTransactionHandler,
  onBeforeCommit,
  onBeforeRollback,
  onCommit,
  onRollback,
  setupKnex,
} from "../knex.ts";
import {
  applySchema,
  pgInteger,
  pgNullable,
  pgSchema,
  pgString,
  pgTable,
  StaticPg,
} from "../pg.ts";

const schema = pgSchema("knex-test");
const tableUser = pgTable(schema, "user", () => ({
  name: pgString(),
  age: pgNullable(pgInteger()),
}));
type TableUser = StaticPg<typeof tableUser>;

describe("npm:knex", () => {
  let knex: Knex;
  let userA: TableUser;
  let userB: TableUser;

  before(async () => {
    knex = await setupKnex("knex-test");
    await applySchema("knex-test", null, schema);
    [userA, userB] = await knex<TableUser>("user")
      .insert([{ name: "User A" }, { name: "User B" }])
      .returning("*");
  });

  it("gets knex", () => {
    const nextKnex = getKnex("knex-test");
    expect(nextKnex).toBeTruthy();
  });

  it("onCommit", async () => {
    const order: string[] = [];

    // first transaction is fine
    const result = await knexTransaction("knex-test", async (trx) => {
      onCommit(trx, async () => {
        await wait(50);
        order.push("onCommit50");
      });
      order.push("transaction");

      const [user] = await trx<TableUser>("user")
        .insert({
          id: uuid(),
          name: "User D",
        })
        .returning("*");

      onCommit(trx, async () => {
        await wait(100);
        order.push("onCommit100");
      });

      onCommit(trx, () => {
        order.push("onCommit");
      });

      return user;
    });

    order.push("after");
    await wait(200);
    order.push("after200");

    // second transaction handler fails
    await knex
      .transaction(async (trx) => {
        onCommit(trx, async () => {
          await wait(50);
          order.push("onCommit50");
        });
        order.push("transaction");

        await trx<TableUser>("user")
          .insert({
            id: uuid(),
            name: "User E",
          })
          .returning("*");

        onCommit(trx, () => {
          order.push("onCommit");
        });

        throw new Error("failed transaction");
      }).catch(errorHandler);

    order.push("after");
    await wait(200);
    order.push("after200");

    // third transaction violates a DB contraint
    await knex
      .transaction(async (trx) => {
        onCommit(trx, async () => {
          await wait(50);
          order.push("onCommit50");
        });

        onCommit(trx, () => {
          order.push("onCommit");
        });

        order.push("transaction");

        await trx<TableUser>("user")
          .insert({
            id: result.id,
            name: "User F",
          })
          .returning("*");
      }).catch(errorHandler);

    order.push("after");
    await wait(200);
    order.push("after200");

    expect(order).toEqual([
      "transaction",
      "after",
      "onCommit",
      "onCommit50",
      "onCommit100",
      "after200",
      "transaction",
      "after",
      "after200",
      "transaction",
      "after",
      "after200",
    ]);
  });

  it("onRollback", async () => {
    const order: string[] = [];

    // first transaction is fine
    const result = await knexTransaction("knex-test", async (trx) => {
      onRollback(trx, async () => {
        await wait(50);
        order.push("onRollback50");
      });
      order.push("transaction");

      const [user] = await trx<TableUser>("user")
        .insert({
          id: uuid(),
          name: "User D",
        })
        .returning("*");

      onRollback(trx, async () => {
        await wait(100);
        order.push("onRollback100");
      });

      onRollback(trx, () => {
        order.push("onRollback");
      });

      return user;
    });

    order.push("after");
    await wait(200);
    order.push("after200");

    // second transaction handler fails
    await knex
      .transaction(async (trx) => {
        onRollback(trx, async () => {
          await wait(50);
          order.push("onRollback50");
        });
        order.push("transaction");

        await trx<TableUser>("user")
          .insert({
            id: uuid(),
            name: "User E",
          })
          .returning("*");

        onRollback(trx, () => {
          order.push("onRollback");
        });

        throw new Error("failed transaction");
      }).catch(errorHandler);

    order.push("after");
    await wait(200);
    order.push("after200");

    // third transaction violates a DB contraint
    await knex
      .transaction(async (trx) => {
        onRollback(trx, async () => {
          await wait(50);
          order.push("onRollback50");
        });

        onRollback(trx, () => {
          order.push("onRollback");
        });

        order.push("transaction");

        await trx<TableUser>("user")
          .insert({
            id: result.id,
            name: "User F",
          })
          .returning("*");
      }).catch(errorHandler);

    order.push("after");
    await wait(200);
    order.push("after200");

    expect(order).toEqual([
      "transaction",
      "after",
      "after200",
      "transaction",
      "after",
      "onRollback",
      "onRollback50",
      "after200",
      "transaction",
      "after",
      "onRollback",
      "onRollback50",
      "after200",
    ]);
  });

  it("onBeforeCommit", async () => {
    const knex = getKnex("knex-test");
    const order = ["transactionStart"];
    const user = await knexTransaction("knex-test", async (trx) => {
      order.push("handlerStart");
      const [user] = await trx<TableUser>("user").where("id", userA.id);
      onBeforeCommit(trx, async () => {
        order.push("onBeforeCommitStart");
        await wait(100);
        await trx<TableUser>("user")
          .update("name", "User X")
          .where("id", userA.id);
        order.push("onBeforeCommitEnd");
      });
      order.push("handlerEnd");
      return user;
    });
    order.push("transactionEnd");

    const [nextUser] = await knex<TableUser>("user").where("id", userA.id);
    expect(user.name).toContain("User A");
    expect(nextUser.name).toEqual("User X");
    expect(order).toEqual([
      "transactionStart",
      "handlerStart",
      "handlerEnd",
      "onBeforeCommitStart",
      "onBeforeCommitEnd",
      "transactionEnd",
    ]);
  });

  it("onBeforeRollback", async () => {
    const order = ["transactionStart"];
    await expectAsyncError(
      knexTransactionHandler("knex-test", (trx) => {
        order.push("handlerStart");
        onBeforeRollback(trx, async () => {
          order.push("onBeforeRollbackStart");
          await wait(100);
          await trx<TableUser>("user")
            .update("name", "User X")
            .where("id", userB.id);
          order.push("onBeforeRollbackEnd");
        });
        order.push("handlerEnd");
        throw Error("rollback");
      }),
      "rollback",
    );
    order.push("transactionEnd");

    expect(order).toEqual([
      "transactionStart",
      "handlerStart",
      "handlerEnd",
      "onBeforeRollbackStart",
      "onBeforeRollbackEnd",
      "transactionEnd",
    ]);
  });

  it("iterates user", async () => {
    await knexTransaction("knex-test", async (trx) => {
      const results = iterateQuery(
        trx,
        trx<TableUser>("user")
          .whereIn("name", ["User D", "User A"])
          .orderBy("id"),
        5,
      );
      let users: TableUser[] = [];
      for await (const result of results) {
        users = [...users, ...result];
      }
      expect(users).toEqual(
        await trx<TableUser>("user")
          .whereIn("name", ["User D", "User A"])
          .orderBy("id"),
      );
    });
  });
});
