import { assert } from "jsr:@std/assert";
import { logger } from "../../log.ts";
import { asyncQueue } from "../../queue.ts";
import { isValue } from "../../util.ts";
import { Transaction } from "../knex.ts";
import type { AppliedIndex } from "./apply-indexes.ts";
import type { Table } from "./types.ts";
import { hash, pgColumnsArray, resolveColumn } from "./utils.ts";

/**
 * Applies constraints to database tables including primary keys and foreign keys.
 */
export async function applyConstraints(
  trx: Transaction,
  tables: Table[],
  appliedIndexes: AppliedIndex[],
) {
  type ConstraintTable = {
    table_name: string;
    constraint_name: string;
  };

  const currentConstraints = await trx("information_schema.key_column_usage")
    .select<ConstraintTable[]>("table_name", "constraint_name")
    .whereIn("table_name", tables.map((table) => table.name))
    .where("table_schema", "public");

  await Promise.all(tables.map(asyncQueue(async (table) => {
    const primaryIndex = appliedIndexes.find((index) =>
      index.type === "primary" &&
      index.table === table.name
    );
    assert(primaryIndex);

    const tableConstraints = currentConstraints.filter((constraints) =>
      constraints.table_name === table.name
    );

    const constraints: string[] = pgColumnsArray(table.columns)
      .map(
        ({ key, column }) => {
          let source = column;
          if (source.type === "forward") {
            source = resolveColumn(column, tables);
          }
          if (source.type === "nullable") {
            source = source.column;
          }
          if (source.type === "reference") {
            return `foreign key ("${key}") references "${source.table.name}" ("id")`;
          }
          return null;
        },
      )
      .filter(isValue);

    const nextConstraints = constraints.map((constraint) => ({
      name: `${table.name}_constraint_${hash(constraint)}`,
      constraint,
    })).concat([{
      name: primaryIndex.name,
      constraint: `primary key using index "${primaryIndex.name}"`,
    }]);

    const alterStr = [
      ...new Set(
        tableConstraints.map((constraint) => constraint.constraint_name).concat(
          nextConstraints.map((constraint) => constraint.name),
        ),
      ),
    ]
      .map(
        (name) => {
          const currentConstraint = tableConstraints.find((constraint) =>
            constraint.constraint_name === name
          );
          const nextConstraint = nextConstraints.find((constraint) =>
            constraint.name === name
          );
          if (currentConstraint && nextConstraint) {
            return;
          }
          if (currentConstraint && !nextConstraint) {
            return `drop constraint "${currentConstraint.constraint_name}"`;
          }
          if (!nextConstraint) {
            return;
          }
          return `add constraint "${nextConstraint.name}" ${nextConstraint.constraint}`;
        },
      )
      .filter(isValue).join(", ");

    if (alterStr) {
      const query = `alter table "${table.name}" ${alterStr}`;
      logger.info("alter_table_constraints", { query });
      await trx.raw(query);
    }
  })));
}
