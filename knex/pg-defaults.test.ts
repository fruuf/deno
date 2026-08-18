import { expect } from "jsr:@std/expect/expect";
import { after, before, describe, it } from "jsr:@std/testing/bdd";
import { getKnex, setupKnex } from "./knex.ts";
import {
  applySchema,
  pgBoolean,
  pgDecimal,
  pgEnum,
  pgFloat,
  pgInteger,
  pgNullable,
  pgSchema,
  pgTable,
  StaticPg,
} from "./pg.ts";

describe("pg column defaults", () => {
  before(async () => {
    await setupKnex("test");
  });

  it("creates table with default values", async () => {
    const defaultSchema = pgSchema("defaults_test");

    const tableWithDefaults = pgTable(defaultSchema, "with_defaults", () => ({
      active: pgBoolean(true),
      inactive: pgBoolean(false),
      count: pgInteger(0),
      score: pgFloat(1.5),
      bigCount: pgInteger(1000000),
      price: pgDecimal(BigInt(5000)),
      status: pgNullable(pgEnum(["pending", "active", "completed"])),
      // Test columns without defaults
      noDefaultBool: pgBoolean(),
      noDefaultInt: pgInteger(),
    }));

    type TableWithDefaults = StaticPg<typeof tableWithDefaults>;

    // Apply the schema
    await applySchema("test", null, defaultSchema);

    const knex = getKnex("test");

    // Test inserting with defaults
    const [row1] = await knex<TableWithDefaults>("with_defaults")
      .insert({
        noDefaultBool: true,
        noDefaultInt: 42,
      })
      .returning("*");

    // Verify defaults were applied
    expect(row1.active).toBe(true);
    expect(row1.inactive).toBe(false);
    expect(row1.count).toBe(0);
    expect(row1.score).toBe(1.5);
    expect(row1.bigCount).toBe(1000000);
    expect(row1.price).toBe(BigInt(5000));
    expect(row1.status).toBe(null);
    expect(row1.noDefaultBool).toBe(true);
    expect(row1.noDefaultInt).toBe(42);

    // Test inserting with override values
    const [row2] = await knex<TableWithDefaults>("with_defaults")
      .insert({
        active: false,
        inactive: true,
        count: 10,
        score: 2.5,
        bigCount: 5000000,
        price: BigInt(4999), // 49.99
        status: "completed",
        noDefaultBool: false,
        noDefaultInt: 100,
      })
      .returning("*");

    // Verify overrides work
    expect(row2.active).toBe(false);
    expect(row2.inactive).toBe(true);
    expect(row2.count).toBe(10);
    expect(row2.score).toBe(2.5);
    expect(row2.bigCount).toBe(5000000);
    expect(row2.price).toBe(BigInt(4999));
    expect(row2.status).toBe("completed");
    expect(row2.noDefaultBool).toBe(false);
    expect(row2.noDefaultInt).toBe(100);
  });

  it("verifies column type definitions have default property", () => {
    // Test that the column definitions include the default value
    const boolWithDefault = pgBoolean(true);
    expect(boolWithDefault.default).toBe(true);

    const intWithDefault = pgInteger(42);
    expect(intWithDefault.default).toBe(42);

    const floatWithDefault = pgFloat(3.14);
    expect(floatWithDefault.default).toBe(3.14);

    const bigIntWithDefault = pgInteger(9999999);
    expect(bigIntWithDefault.default).toBe(9999999);

    const decimalWithDefault = pgDecimal(12345n);
    expect(decimalWithDefault.default).toBe(12345n);

    // Test columns without defaults
    const boolNoDefault = pgBoolean();
    expect(boolNoDefault.default).toBeUndefined();

    const intNoDefault = pgInteger();
    expect(intNoDefault.default).toBeUndefined();
  });

  after(async () => {
    // Clean up test schema
    const knex = getKnex("test");
    await knex.schema.dropTableIfExists("with_defaults");
  });
});
