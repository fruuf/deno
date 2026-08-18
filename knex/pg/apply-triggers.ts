import { assert } from "jsr:@std/assert";
import { distinctBy } from "jsr:@std/collections";
import { asyncQueue } from "../../queue.ts";
import { isValue } from "../../util.ts";
import { Transaction } from "../knex.ts";
import type { Table } from "./types.ts";
import { hash, pgColumnsArray, resolveColumn } from "./utils.ts";

/**
 * Applies database triggers for forward column references to maintain data consistency.
 */
export async function applyTriggers(
  trx: Transaction,
  tables: Table[],
) {
  const forwardedColumns = tables
    .map((table) => {
      const columns = pgColumnsArray(table.columns);
      return columns.map(({ key, column }) => {
        if (column.type !== "forward") {
          return null;
        }
        const reference = columns.find((find) =>
          find.column === column.reference
        );
        assert(reference);
        let nextReference = resolveColumn(reference.column, tables);
        if (nextReference.type === "nullable") {
          nextReference = nextReference.column;
        }
        assert(nextReference.type === "reference");
        const forwardedColumn = {
          sourceTable: nextReference.table.name,
          sourceKey: column.key,
          targetTable: table.name,
          targetKey: key,
          referenceKey: reference.key,
        };
        const columnHash = hash(forwardedColumn);
        return {
          hash: columnHash,
          ...forwardedColumn,
        };
      });
    })
    .flat()
    .filter(isValue);

  await Promise.all(tables.map(asyncQueue(async (table) => {
    const sourceTables = forwardedColumns.filter((forwarded) =>
      forwarded.sourceTable === table.name
    );
    const targetTables = forwardedColumns.filter((forwarded) =>
      forwarded.targetTable === table.name
    );

    function targetDependencies(key: string): typeof forwardedColumns {
      const targetTable = targetTables.find((table) => table.targetKey === key);
      if (!targetTable) {
        return [];
      }
      return [...targetDependencies(targetTable.referenceKey), targetTable];
    }
    const nextDependencies = distinctBy(
      targetTables
        .map((table) => [...targetDependencies(table.referenceKey), table])
        .flat(),
      ({ targetKey }) => targetKey,
    );

    const targetUpdates = nextDependencies
      .map(
        (field) =>
          `new."${field.targetKey}" := (select "${field.sourceKey}" from "${field.sourceTable}" where "id" = new."${field.referenceKey}");`,
      )
      .concat([`new."updated_at" = now();`]);

    const sourceUpdates = Object.values(
      Object.groupBy(
        sourceTables,
        (table) => `${table.targetTable}.${table.referenceKey}`,
      ),
    )
      .map((tables) => {
        if (!tables) {
          return null;
        }
        const [{ targetTable, referenceKey }] = tables;
        const fields = tables.map((table) => ({
          sourceKey: table.sourceKey,
          targetKey: table.targetKey,
        }));

        const sourceHandlerColumn = fields
          .map((field) => `"${field.targetKey}" = new."${field.sourceKey}"`)
          .concat([`"updated_at" = now()`])
          .join(", ");

        const sourceHandlerWhere = fields
          .map(
            (field) =>
              `"${field.targetKey}" is distinct from new."${field.sourceKey}"`,
          )
          .join(" or ");

        return `update "${targetTable}" set ${sourceHandlerColumn} where "${referenceKey}" = new."id" and (${sourceHandlerWhere});`;
      })
      .filter(isValue);

    const query1 = `
      create or replace function "${table.name}_before"()
      returns trigger as $$
      begin
        ${targetUpdates.join("")}
        return new;
      end;
      $$ language plpgsql
    `;
    await trx.raw(query1);

    const query2 = `
      create or replace trigger "${table.name}_before"
      before insert or update on "${table.name}"
      for each row execute function ${table.name}_before();
    `;
    await trx.raw(query2);

    const query3 = `
      create or replace function "${table.name}_after"()
      returns trigger as $$
      begin
        ${sourceUpdates.join("")}
        return new;
      end;
      $$ language plpgsql
    `;
    await trx.raw(query3);

    const query4 = `
      create or replace trigger "${table.name}_after"
      after insert or update on "${table.name}"
      for each row execute function ${table.name}_after();
    `;
    await trx.raw(query4);
  })));
}
