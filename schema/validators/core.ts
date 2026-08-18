// deno-lint-ignore-file no-explicit-any
import type { SchemaType, StaticSchema } from "../types.ts";

/**
 * Extends a schema with additional validation steps.
 */
export function ExtendSchema<Schema extends SchemaType>(
  base: Schema,
  ...parsers: ((
    arg: StaticSchema<Schema>,
    path: string,
  ) => StaticSchema<Schema>)[]
): Schema {
  return {
    ...(base as any),
    parse: (arg: any, path = "") =>
      parsers.reduce(
        (nextArg, parse) => parse(nextArg, path),
        base.parse(arg, path),
      ),
  };
}

/**
 * Type guard to check if a value matches a schema.
 */
export function isSchema<Schema extends SchemaType>(
  schema: Schema,
  value: any,
): value is StaticSchema<Schema> {
  try {
    schema.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a handler that validates input with a schema before processing.
 */
export function createSchemaHandler<Schema extends SchemaType, Result>(
  schema: Schema,
  handler: (args: StaticSchema<Schema>) => Result,
) {
  return (args: StaticSchema<Schema>) => handler(schema.parse(args, ""));
}

export function validateSchema<Schema extends SchemaType>(
  schema: Schema,
  value: any,
): StaticSchema<Schema> {
  return schema.parse(value, "");
}
