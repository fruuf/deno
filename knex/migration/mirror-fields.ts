import { isValue } from "../../util.ts";
import { Transaction } from "../knex.ts";

type MirrorField = string | { source: string; target: string };

/**
 * Creates triggers to mirror fields from source table to target table
 */
export async function mirrorFields(
  trx: Transaction,
  sourceTable: string,
  targetTable: string,
  fields: MirrorField[],
  sourceKey = "id",
  targetKey = `${sourceTable}_${sourceKey}`,
) {
  const name = `mirror_${sourceTable}__${targetTable}`;

  type InformationSchemaColumn = {
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
  };

  const nextFields = fields.map((field) => {
    if (typeof field === "string") {
      return { sourceField: field, targetField: field };
    }
    return { sourceField: field.source, targetField: field.target };
  });

  const sourceTypes = await trx<InformationSchemaColumn>(
    "information_schema.columns",
  )
    .select("column_name", "data_type", "is_nullable")
    .where("table_name", sourceTable)
    .whereIn(
      "column_name",
      nextFields.map(({ sourceField: source }) => source),
    );

  const targetTypes = await trx<InformationSchemaColumn>(
    "information_schema.columns",
  )
    .select("column_name", "data_type", "is_nullable")
    .where("table_name", targetTable)
    .whereIn("column_name", [
      targetKey,
      ...nextFields.map(({ targetField }) => targetField),
    ]);

  const targetKeyNullable =
    targetTypes.find(({ column_name }) => column_name === targetKey)
      ?.is_nullable !== "NO";

  const parsedFields = nextFields.map((field) => {
    const sourceType = sourceTypes.find(
      ({ column_name }) => column_name === field.sourceField,
    );
    if (!sourceType) {
      throw new Error(
        `Source field ${field.sourceField} not found in ${sourceTable}`,
      );
    }
    const targetType = targetTypes.find(
      ({ column_name }) => column_name === field.targetField,
    );
    return {
      ...field,
      sourceType: sourceType.data_type,
      targetType: targetType?.data_type ?? null,
      sourceNullable: sourceType.is_nullable !== "NO",
      targetNullable: targetType?.is_nullable !== "NO" || targetKeyNullable,
    };
  });

  const tableColumn = parsedFields
    .map((field) => {
      if (
        field.sourceType === field.targetType &&
        field.sourceNullable === field.targetNullable
      ) {
        return [];
      }

      return [
        (!field.targetType &&
          `add column ${field.targetField} ${field.sourceType}`) ||
        (field.targetType !== field.sourceType &&
          `alter column "${field.targetField}" type ${field.sourceType}`) ||
        null,

        (!field.targetNullable &&
          field.sourceNullable &&
          `alter column "${field.targetField}" drop not null`) ||
        null,
      ];
    })
    .flat()
    .filter(isValue)
    .join(", ");

  if (tableColumn) {
    const tableQuery = `alter table "${targetTable}" ${tableColumn}`;
    await trx.raw(tableQuery);
  }

  const targetName = `${name}_target`;

  const targetHandlerColumn = parsedFields
    .map(
      (field) =>
        `new."${field.targetField}" := (select "${field.sourceField}" from "${sourceTable}" where "${sourceKey}" = new."${targetKey}");`,
    )
    .join("");

  const targetHandlerQuery = `
    create or replace function ${targetName}()
    returns trigger as $$
    begin
      ${targetHandlerColumn}
      return new;
    end;
    $$ language plpgsql
  `;
  await trx.raw(targetHandlerQuery);

  const targetTriggerQuery = `
    create or replace trigger "${targetName}"
    before insert or update on "${targetTable}"
    for each row execute function ${targetName}();
  `;

  await trx.raw(targetTriggerQuery);

  const sourceName = `${name}_source`;

  const sourceHandlerColumn = parsedFields
    .map((field) => `"${field.targetField}" = new."${field.sourceField}"`)
    .join(", ");

  const sourceHandlerWhere = parsedFields
    .map(
      (field) =>
        `"${field.targetField}" is distinct from new."${field.sourceField}"`,
    )
    .join(" or ");

  const sourceHandlerQuery = `
    create or replace function ${sourceName}()
    returns trigger as $$
    begin
      update "${targetTable}"
      set ${sourceHandlerColumn}
      where "${targetKey}" = new."${sourceKey}" and (${sourceHandlerWhere});
      return new;
    end;
    $$ language plpgsql
  `;
  await trx.raw(sourceHandlerQuery);

  const sourceTriggerQuery = `
    create or replace trigger "${sourceName}"
    after insert or update on "${sourceTable}"
    for each row execute function ${sourceName}();
  `;

  await trx.raw(sourceTriggerQuery);

  const updateColumn = parsedFields
    .map(
      (field) =>
        `"${field.targetField}" = "${sourceTable}"."${field.sourceField}"`,
    )
    .join(", ");

  const updateWhere = parsedFields
    .map(
      (field) =>
        `"${targetTable}"."${field.targetField}" is distinct from "${sourceTable}"."${field.sourceField}"`,
    )
    .join(" or ");

  const updateQuery = `
    update "${targetTable}"
    set ${updateColumn}
    from "${sourceTable}"
    where "${targetTable}"."${targetKey}" = "${sourceTable}"."${sourceKey}" and (${updateWhere})
  `;

  await trx.raw(updateQuery);

  const notNullColumn = parsedFields
    .map(
      (field) =>
        (field.targetNullable &&
          !field.sourceNullable &&
          `alter column "${field.targetField}" set not null`) ||
        null,
    )
    .filter(isValue)
    .join(", ");

  if (notNullColumn) {
    const notNullQuery = `alter table "${targetTable}" ${notNullColumn}`;
    await trx.raw(notNullQuery);
  }
}
