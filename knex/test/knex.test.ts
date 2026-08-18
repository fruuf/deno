import { sortBy } from "jsr:@std/collections";
import { expect } from "jsr:@std/expect";
import { join } from "jsr:@std/path";
import { before, describe, it } from "jsr:@std/testing/bdd";
import { Knex } from "npm:knex";
import { errorHandler } from "../../error.ts";
import { expectAsyncError } from "../../test.ts";
import { randomString, uuid, wait } from "../../util.ts";
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
import { partitionTable } from "../migration.ts";
import { TableBalance, TableUser, tableUser } from "./database.ts";

describe("npm:knex", () => {
  let knex: Knex;
  before(async () => {
    knex = await setupKnex(
      "knex-test",
      join(import.meta.dirname ?? "", "migrations"),
    );
  });

  it("gets knex", () => {
    const nextKnex = getKnex("knex-test");
    expect(nextKnex).toBeTruthy();
  });

  let userA: TableUser;
  let userB: TableUser;

  it("batch insert user", async () => {
    userA = { id: uuid(), name: "User A", age: null };
    userB = { id: uuid(), name: "User B", age: null };

    const firstUsers = await knexTransaction(
      "knex-test",
      (trx) => tableUser.batchInsert(trx, ["id"], ["name"], [userA], "changed"),
    );

    expect(firstUsers).toHaveLength(1);

    const secondUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchInsert(trx, ["id"], ["name"], [userA, userB], "changed"),
    );

    expect(secondUsers).toHaveLength(1);
    expect([...firstUsers, ...secondUsers]).toEqual([userA, userB]);

    const allUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchInsert(trx, ["id"], ["name"], [userA, userB], "all"),
    );

    expect(sortBy(allUsers, ({ name }) => name)).toEqual([userA, userB]);

    const changedUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchInsert(trx, ["id"], ["name"], [userA, userB], "changed"),
    );

    expect(changedUsers).toHaveLength(0);
  });

  let userC: TableUser;

  it("batch upsert a user", async () => {
    userC = { id: uuid(), name: "User C", age: null };

    const firstUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchUpsert(
          trx,
          ["id"],
          ["name"],
          [],
          [userA, userB, userC],
          "changed",
        ),
    );

    expect(firstUsers).toEqual([userC]);

    const allUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchUpsert(
          trx,
          ["id"],
          ["name"],
          [],
          [userA, userB, userC],
          "all",
        ),
    );

    expect(sortBy(allUsers, ({ name }) => name)).toEqual([userA, userB, userC]);

    userA.name = `${userA.name} (changed)`;

    const changedUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchUpsert(
          trx,
          ["id"],
          ["name"],
          [],
          [userA, userB, userC],
          "changed",
        ),
    );

    expect(changedUsers).toEqual([userA]);
  });

  it("upsert a user", async () => {
    const user: TableUser = { id: uuid(), name: "User A", age: null };

    const firstUser = await knexTransaction(
      "knex-test",
      (trx) => tableUser.upsert(trx, ["id"], ["name"], [], user),
    );

    expect(firstUser).toEqual(user);

    user.name = `${user.name} (changed)`;

    const changedUser = await knexTransaction(
      "knex-test",
      (trx) => tableUser.upsert(trx, ["id"], ["name"], [], user),
    );

    expect(changedUser).toEqual(user);
  });

  let userD: TableUser;

  it("batch update a user", async () => {
    userD = { id: uuid(), name: "User D", age: null };

    const firstUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchUpdate(
          trx,
          ["id"],
          ["name"],
          [userA, userB, userC, userD],
          "changed",
        ),
    );

    expect(firstUsers).toHaveLength(0);

    const allUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchUpdate(
          trx,
          ["id"],
          ["name"],
          [userA, userB, userC, userD],
          "all",
        ),
    );

    expect(sortBy(allUsers, ({ name }) => name)).toEqual([
      userA,
      userB,
      userC,
    ]);

    userB.name = `${userB.name} (changed)`;

    const changedUsers = await knexTransaction(
      "knex-test",
      (trx) =>
        tableUser.batchUpdate(
          trx,
          ["id"],
          ["name"],
          [userA, userB, userC],
          "changed",
        ),
    );

    expect(changedUsers).toEqual([userB]);
  });

  // we need this test since w recycle temp-tables now
  // https://www.titanwolf.org/Network/q/4504f170-3946-457a-8cad-eee1002ec141/y
  it("multi-batch in the same transaction", async () => {
    const userIdA = uuid();
    const userIdB = uuid();

    await knexTransaction("knex-test", async (trx) => {
      await tableUser.batchInsert(
        trx,
        ["id"],
        ["name"],
        [
          { id: userIdA, name: "A" },
          { id: userIdB, name: "B" },
        ],
      );

      await trx<TableUser>("user").update("name", "C").where("id", userIdA);

      // if we dont reset the temp tables userA will still be in here and get reset to name A
      await tableUser.batchUpdate(
        trx,
        ["id"],
        ["name"],
        [{ id: userIdB, name: "D" }],
      );

      const [user] = await trx<TableUser>("user").where("id", userIdA);

      expect(user.name).toEqual("C");
    });
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

  it("partitions table", async () => {
    await knexTransaction("knex-test", async (trx) => {
      await partitionTable(trx, "user", "id");
      await trx.rollback();
    });
  });

  it("mirror fields", async () => {
    const knex = getKnex("knex-test");

    const [userA, userB] = await knex<TableUser>("user")
      .insert([
        { id: uuid(), name: randomString() },
        { id: uuid(), name: randomString() },
      ])
      .returning("*");

    const [balanceA] = await knex<TableBalance>("balance")
      .insert({ user_id: userA.id, currency: "usd", amount: 1, value: 1 })
      .returning("*");

    expect(balanceA.user_name).toEqual(userA.name);
    expect(balanceA.age).toEqual(userA.age);

    const [balanceB] = await knex<TableBalance>("balance")
      .update("user_id", userB.id)
      .where("user_id", userA.id)
      .returning("*");

    expect(balanceB.user_name).toEqual(userB.name);
    expect(balanceB.age).toEqual(userB.age);

    const [nextUserB] = await knex<TableUser>("user")
      .update("name", randomString())
      .where("id", userB.id)
      .returning("*");

    const [nextBalanceB] = await knex<TableBalance>("balance").where(
      "user_id",
      userB.id,
    );
    expect(nextBalanceB.user_name).toEqual(nextUserB.name);
    expect(nextBalanceB.age).toEqual(nextUserB.age);
  });
});
