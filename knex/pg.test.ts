import { expect } from "jsr:@std/expect/expect";
import { after, before, describe, it } from "jsr:@std/testing/bdd";
import { randomString, uuid, wait } from "../util.ts";
import { getKnex, setupKnex } from "./knex.ts";
import {
  applySchema,
  pgBoolean,
  pgDate,
  pgDecimal,
  pgEnum,
  pgExtend,
  pgForward,
  pgInteger,
  pgNullable,
  pgQuery,
  pgReference,
  pgSchema,
  pgString,
  pgTable,
  pgText,
  pgUnique,
  StaticPg,
} from "./pg.ts";
import { mergeIndexes } from "./pg/indexes.ts";

export const schema = pgSchema("test");

export const tableAddress = pgTable(schema, "address", () => ({
  address: pgString(),
  owned: pgBoolean(),
  customer_id: pgNullable(pgString()),
}));

pgUnique(tableAddress, ["address"]);
export type TableAddress = StaticPg<typeof tableAddress>;

const tempTableBlock = pgTable(schema, "block", () => ({
  active: pgBoolean(),
  block_hash: pgString(),
  block_number: pgInteger(),
  block_slot: pgInteger(),
  block_at: pgDate(),
}));

export const tableBlock = pgExtend(tempTableBlock, () => ({
  parent_id: pgReference(tempTableBlock),
}));

pgUnique(tableBlock, ["block_number"], { active: true });

export type TableBlock = StaticPg<typeof tableBlock>;

export const tableTransaction = pgTable(schema, "transaction", () => ({
  block_id: pgNullable(pgReference(tableBlock)),
  transaction_hash: pgString(),
}));

export type TableTransaction = StaticPg<typeof tableTransaction>;

pgUnique(tableTransaction, ["transaction_hash", "block_id"]);

const transactionReference = pgReference(tableTransaction);
const transactionBlockReference = pgForward(
  tableTransaction,
  "block_id",
  transactionReference,
);
const addressFromReference = pgNullable(pgReference(tableAddress));
const addressToReference = pgNullable(pgReference(tableAddress));

export const tableTransfer = pgTable(schema, "transfer", () => ({
  transaction_id: transactionReference,
  address_from: pgNullable(pgString()),
  address_from_id: addressFromReference,
  address_to: pgNullable(pgString()),
  address_to_id: addressToReference,
  customer_from_id: pgForward(
    tableAddress,
    "customer_id",
    addressFromReference,
  ),
  customer_to_id: pgForward(tableAddress, "customer_id", addressToReference),
  amount: pgDecimal(),
  contract: pgString(),
  input: pgInteger(),
  output: pgInteger(),
  transaction_hash: pgForward(
    tableTransaction,
    "transaction_hash",
    transactionReference,
  ),
  block_id: transactionBlockReference,
  block_hash: pgForward(tableBlock, "block_hash", transactionBlockReference),
  block_active: pgForward(
    tableBlock,
    "active",
    transactionBlockReference,
  ),
  block_at: pgForward(tableBlock, "block_at", transactionBlockReference),
  accounted: pgBoolean(),
}));

export type TableTransfer = StaticPg<typeof tableTransfer>;

export const tableBalance = pgTable(schema, "balance", () => ({
  address_id: pgReference(tableAddress),
  amount: pgDecimal(),
  contract: pgString(),
  test_at: pgDate(),
}));

pgUnique(tableBalance, ["contract", "address_id"]);

export const tableUser = pgTable(schema, "user", () => ({
  name: pgString(),
  status: pgEnum(["active", "inactive", "suspended"]),
  role: pgEnum(["admin", "moderator", "user", "guest"]),
  email: pgNullable(pgString()),
}));

export type TableUser = StaticPg<typeof tableUser>;

export const getCustomerDeposits = pgQuery(
  tableTransfer,
  ["customer_to_id"],
  {},
  ["updated_at"],
);

export const getCustomerWithdrawals = pgQuery(
  tableTransfer,
  ["customer_from_id"],
  {},
  ["updated_at"],
);

export const getActiveUnaccounted = pgQuery(
  tableTransfer,
  [],
  { block_active: true, accounted: false },
  ["created_at"],
);

export const getInactiveAccounted = pgQuery(
  tableTransfer,
  [],
  { block_active: false, accounted: true },
  ["created_at"],
);

export const getOwnedAddress = pgQuery(tableAddress, ["address"], {
  owned: true,
});

export const getAddress = pgQuery(tableAddress, ["address"]);

// export const getA = pgQuery(
//   tableTransfer,
//   ["address_from_id"],
// );

// export const getB = pgQuery(
//   tableTransfer,
//   ["address_from_id"],
// );

// export const getC = pgQuery(
//   tableTransfer,
//   ["address_from_id", "address_to_id"],
// );

// export const getD = pgQuery(
//   tableTransfer,
//   ["contract", "address_from_id", "address_to_id"],
// );

// export const balanceA = pgQuery(tableBalance, ["address_id"], {
//   id: [
//     "c15ca9de-61b4-4fb8-b8db-f05579dcfccb",
//     "fb40a4fe-526d-455c-9d1e-59dcc9ba7812",
//   ],
// }, [
//   "created_at",
// ]);

// export const balanceB = pgQuery(tableBalance, ["created_at", "address_id"], {
//   id: [
//     "fb40a4fe-526d-455c-9d1e-59dcc9ba7812",
//     "c15ca9de-61b4-4fb8-b8db-f05579dcfccb",
//   ],
// });

// export const balanceC = pgQuery(
//   tableBalance,
//   ["created_at", "address_id"],
//   {},
//   ["updated_at"],
// );

// export const balanceD = pgQuery(
//   tableBalance,
//   ["updated_at", "address_id"],
//   {},
//   ["created_at"],
// );

// export const balanceE = pgQuery(
//   tableBalance,
//   ["address_id", "updated_at"],
//   {},
//   ["created_at", "contract"],
// );

// export const balanceF = pgQuery(
//   tableBalance,
//   ["created_at", "address_id", "updated_at"],
//   {},
//   ["contract"],
// );

// export const balanceG = pgQuery(
//   tableBalance,
//   ["address_id", "updated_at"],
//   {},
//   ["contract", "created_at"],
// );

describe("pg", () => {
  before(async () => {
    await setupKnex("test");
  });

  it("merges indexes", () => {
    const indexes = mergeIndexes([
      {
        table: "test",
        type: "unique",
        columns: ["id"],
        where: {},
      },
      {
        table: "test",
        type: "unique",
        columns: ["id", "customer_id"],
        where: {},
      },
      {
        table: "test",
        type: "unique",
        columns: ["customer_id", "type"],
        where: { active: true },
      },
      {
        table: "test",
        type: "sort",
        columns: ["type"],
        where: { active: true },
        orders: ["customer_id"],
      },
      {
        table: "test",
        type: "sort",
        columns: ["customer_id", "type"],
        where: {},
        orders: ["created_at"],
      },
      {
        table: "test",
        type: "sort",
        columns: ["user_id", "currency", "type"],
        where: {},
        orders: [],
      },
      {
        table: "test",
        type: "sort",
        columns: ["user_id"],
        where: {},
        orders: [],
      },
    ]);
    expect(indexes).toEqual([
      { table: "test", type: "unique", columns: ["id"], where: {} },
      {
        table: "test",
        type: "sort",
        columns: ["customer_id", "type"],
        where: {},
        orders: ["created_at"],
      },
      {
        table: "test",
        type: "unique",
        columns: ["type", "customer_id"],
        where: { active: true },
      },
      {
        table: "test",
        type: "sort",
        columns: ["user_id", "currency", "type"],
        where: {},
        orders: [],
      },
    ]);
  });

  it("applies schema", async () => {
    await setupKnex("test");

    const initialSchema = pgSchema("initial");

    const initialBlock = pgTable(initialSchema, "block", () => ({
      hash: pgString(),
    }));

    pgTable(
      initialSchema,
      "transaction",
      () => ({
        block_id: pgReference(initialBlock),
        hash: pgString(),
      }),
    );
    await applySchema("test", null, initialSchema);

    const prefixedSchema = pgSchema("prefixed");

    const prefixedBlock = pgTable(prefixedSchema, "block", () => ({
      block_hash: pgString(),
    }));

    const prefixedBlockReference = pgReference(prefixedBlock);

    pgTable(
      prefixedSchema,
      "transaction",
      () => ({
        block_id: prefixedBlockReference,
        transaction_hash: pgString(),
        block_hash: pgForward(
          prefixedBlock,
          "block_hash",
          prefixedBlockReference,
        ),
      }),
    );
    await applySchema("test", null, prefixedSchema);

    const blockTextSchema = pgSchema("block_text");

    const blockTextBlock = pgTable(blockTextSchema, "block", () => ({
      block_hash: pgNullable(pgText()),
      block_at: pgDate(),
    }));

    const blockTextBlockReference = pgReference(blockTextBlock);

    pgTable(
      blockTextSchema,
      "transaction",
      () => ({
        block_id: blockTextBlockReference,
        transaction_hash: pgString(),
        block_hash: pgForward(
          blockTextBlock,
          "block_hash",
          blockTextBlockReference,
        ),
      }),
    );
    await applySchema("test", null, blockTextSchema);

    const forwardReferenceSchema = pgSchema("forward_reference");

    const forwardReferenceBlock = pgTable(
      forwardReferenceSchema,
      "block",
      () => ({
        hash: pgInteger(),
        block_at: pgDate(),
      }),
    );

    const forwardReferenceBlockReference = pgNullable(
      pgReference(forwardReferenceBlock),
    );

    const forwardReferenceTransaction = pgTable(
      forwardReferenceSchema,
      "transaction",
      () => ({
        block_id: forwardReferenceBlockReference,
        hash: pgNullable(pgString()),
      }),
    );

    const forwardReferenceTransactionReference = pgReference(
      forwardReferenceTransaction,
    );

    const forwardReferenceTransactionBlockReference = pgForward(
      forwardReferenceTransaction,
      "block_id",
      forwardReferenceTransactionReference,
    );

    // type A = (typeof forwardReferenceTransactionBlockReference)["_debug"];

    const bHash = pgForward(
      forwardReferenceBlock,
      "hash",
      forwardReferenceTransactionBlockReference,
    );

    pgTable(
      forwardReferenceSchema,
      "transfer",
      () => ({
        transaction_id: forwardReferenceTransactionReference,
        transaction_hash: pgForward(
          forwardReferenceTransaction,
          "hash",
          forwardReferenceTransactionReference,
        ),
        block_id: forwardReferenceTransactionBlockReference,
        block_hash: bHash,
      }),
    );

    await applySchema("test", null, forwardReferenceSchema);

    const forwardRenameSchema = pgSchema("forward_rename");

    const forwardRenameBlock = pgTable(forwardRenameSchema, "block", () => ({
      hash: pgNullable(pgText()),
      block_at: pgDate(),
    }));

    const forwardRenameBlockReference = pgReference(forwardRenameBlock);

    const forwardRenameTransaction = pgTable(
      forwardRenameSchema,
      "transaction",
      () => ({
        block_id: forwardRenameBlockReference,
        hash: pgString(),
        block_hash: pgForward(
          forwardRenameBlock,
          "hash",
          forwardRenameBlockReference,
        ),
      }),
    );

    const forwardRenameTransactionReference = pgReference(
      forwardRenameTransaction,
    );

    pgTable(
      forwardRenameSchema,
      "transfer",
      () => ({
        transaction_id: forwardRenameTransactionReference,
        transaction_hash: pgForward(
          forwardRenameTransaction,
          "hash",
          forwardRenameTransactionReference,
        ),
        block_hash: pgForward(
          forwardRenameTransaction,
          "block_hash",
          forwardRenameTransactionReference,
        ),
      }),
    );

    await applySchema("test", null, forwardRenameSchema);
  });

  it("applies test schema", async () => {
    await applySchema("test", null, schema);
  });

  it("inserts and reads address", async () => {
    const knex = getKnex("test");
    const [address] = await knex<TableAddress>("address")
      .insert({
        address: randomString(),
        owned: true,
        customer_id: uuid(),
      })
      .returning("*");

    expect(address).toBeTruthy();
    expect(address.owned).toBe(true);
    expect(address.customer_id).toBeTruthy();
  });

  it("handles block relationships", async () => {
    const knex = getKnex("test");
    const blockId = uuid();
    const blockNumber = Math.floor(Math.random() * 1e12);

    const [block] = await knex<TableBlock>("block")
      .insert({
        id: blockId,
        parent_id: blockId,
        active: true,
        block_number: blockNumber,
        block_slot: blockNumber,
        block_hash: randomString(),
        block_at: new Date(),
      })
      .returning("*");

    expect(block.id).toBe(blockId);
    expect(block.parent_id).toBe(blockId);
    expect(block.active).toBe(true);
  });

  it("handles transaction and transfer relationships", async () => {
    const knex = getKnex("test");

    // Create a block first (self-referential parent)
    const blockId = uuid();
    const [block] = await knex<TableBlock>("block")
      .insert({
        id: blockId,
        parent_id: blockId, // Self-referential
        active: true,
        block_number: Math.floor(Math.random() * 1e12),
        block_slot: Math.floor(Math.random() * 1e12),
        block_hash: randomString(),
        block_at: new Date(),
      })
      .returning("*");

    // Create transaction
    const [transaction] = await knex<TableTransaction>("transaction")
      .insert({ block_id: block.id, transaction_hash: randomString() })
      .returning("*");

    // Create transfer
    const [transfer] = await knex<TableTransfer>("transfer")
      .insert({
        transaction_id: transaction.id,
        accounted: false,
        amount: BigInt(0),
        contract: "",
        input: 0,
        output: 0,
      })
      .returning("*");

    expect(transfer.transaction_id).toBe(transaction.id);
    expect(transfer.amount).toBe(BigInt(0));
  });

  it("updates transfer and propagates updated_at timestamp", async () => {
    const knex = getKnex("test");

    // Setup: Create block, transaction, and transfer
    const blockId = uuid();
    const [block] = await knex<TableBlock>("block")
      .insert({
        id: blockId,
        parent_id: blockId, // Self-referential
        active: true,
        block_number: Math.floor(Math.random() * 1e12),
        block_slot: Math.floor(Math.random() * 1e12),
        block_hash: randomString(),
        block_at: new Date(),
      })
      .returning("*");

    const [transaction] = await knex<TableTransaction>("transaction")
      .insert({ block_id: block.id, transaction_hash: randomString() })
      .returning("*");

    const [transfer] = await knex<TableTransfer>("transfer")
      .insert({
        transaction_id: transaction.id,
        accounted: false,
        amount: BigInt(0),
        contract: "",
        input: 0,
        output: 0,
      })
      .returning("*");

    // Update transfer
    const [nextTransfer] = await knex<TableTransfer>("transfer")
      .update("amount", BigInt(1))
      .where("id", transfer.id)
      .returning("*");

    // Update block
    const [nextBlock] = await knex<TableBlock>("block")
      .update("block_hash", randomString())
      .where("id", block.id)
      .returning("*");

    // Check updated transfer
    const [updatedTransfer] = await knex<TableTransfer>("transfer")
      .where("id", nextTransfer.id);

    expect(Number(nextBlock.updated_at))
      .toBe(Number(updatedTransfer.updated_at));
  });

  it("handles enum columns for user table", async () => {
    const knex = getKnex("test");

    const [user] = await knex<TableUser>("user")
      .insert({
        name: "Test User",
        status: "active",
        role: "admin",
        email: "test@example.com",
      })
      .returning("*");

    expect(user.status).toBe("active");
    expect(user.role).toBe("admin");
  });

  it("updates enum values correctly", async () => {
    const knex = getKnex("test");

    // First create a user
    const [user] = await knex<TableUser>("user")
      .insert({
        name: "Another Test User",
        status: "inactive",
        role: "user",
        email: "another@example.com",
      })
      .returning("*");

    // Update the user
    const [updatedUser] = await knex<TableUser>("user")
      .update({ status: "suspended", role: "moderator" })
      .where("id", user.id)
      .returning("*");

    expect(updatedUser.status).toBe("suspended");
    expect(updatedUser.role).toBe("moderator");
  });

  after(async () => {
    await wait(1000);
    // await Deno.remove(join(Deno.cwd(), "database.ts")).catch(() => {});
  });
});
