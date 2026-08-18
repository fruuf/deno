import { mirrorFields } from "../../migration.ts";

export async function up(knex) {
  await knex.schema.createTable("user", (table) => {
    table.uuid("id").primary();
    table.string("name").notNullable();
    table.integer("age").nullable();
  });

  await knex.schema.createTable("balance", (table) => {
    table.uuid("user_id").references("user.id").notNullable();

    table.string("currency").notNullable();
    table.specificType("amount", "double precision").notNullable();
    table.specificType("value", "double precision").notNullable();

    table.unique(["user_id", "currency"]);
  });

  await mirrorFields(knex, "user", "balance", [
    { source: "name", target: "user_name" },
    "age",
  ]);
}

export async function down() {}
