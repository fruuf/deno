// deno-lint-ignore-file no-explicit-any
import {
  ArraySchemaError,
  EnumSchemaError,
  LiteralSchemaError,
  RecordSchemaError,
  UnionSchemaError,
} from "./errors.ts";
import type {
  ArraySchema,
  EnumSchema,
  LiteralSchema,
  OptionalSchema,
  RecordSchema,
  SchemaType,
  StaticRecordSchema,
  UnionSchema,
} from "./types.ts";

/**
 * Creates a typed schema object with proper type inference.
 */
function create<Schema>(type: Omit<Schema, "_schema">): Schema {
  return type as any;
}

/**
 * Creates a literal schema that matches exact string values.
 */
export function LiteralSchema<Value extends string>(
  value: Value,
): LiteralSchema<Value> {
  return create({
    type: "literal",
    value,
    parse(arg, path = "") {
      if (arg === value) {
        return value;
      }
      throw new LiteralSchemaError(path);
    },
  });
}

/**
 * Creates an enum schema with validation and utility methods.
 */
export function EnumSchema<Value extends string>(
  values: Value[] | Record<Value, any>,
): EnumSchema<Value> {
  const valueSet = new Set<Value>(
    Array.isArray(values) ? values : (Object.keys(values) as Value[]),
  );

  const enumDefinition = {
    type: "enum" as const,
    values: Array.from(valueSet),
    test(value: string): value is Value {
      return valueSet.has(value as Value);
    },
    parse(arg: any, path = "") {
      if (valueSet.has(arg)) {
        return arg;
      }
      throw new EnumSchemaError(path);
    },
  };

  const enumValue = (value: Value) => {
    if (valueSet.has(value)) {
      return LiteralSchema(value);
    }
    throw new Error(`value "${value}" is not in "${values}"`);
  };

  return create(Object.assign(enumValue, enumDefinition));
}

/**
 * Creates a union schema that tries multiple schema options.
 */
export function UnionSchema<Item extends SchemaType>(
  items: Item[],
): UnionSchema<Item> {
  return create({
    type: "union",
    items,
    parse(arg, path = "") {
      for (const item of items) {
        try {
          return item.parse(arg, path);
        } catch {
          // ignore
        }
      }
      throw new UnionSchemaError(path);
    },
  });
}

/**
 * Creates an optional schema that allows null/undefined values.
 */
export function OptionalSchema<Schema extends SchemaType>(
  base: Schema,
): OptionalSchema<Schema> {
  return create({
    type: "optional",
    base,
    parse(arg, path = "") {
      if ((arg === undefined) || (arg === null)) {
        return null;
      }
      return base.parse(arg, path);
    },
  });
}

/**
 * Creates an array schema that validates each element.
 */
export function ArraySchema<Schema extends SchemaType>(
  base: Schema,
): ArraySchema<Schema> {
  return create({
    type: "array",
    base,
    parse(args, path = "") {
      if (Array.isArray(args)) {
        return args.map((arg, i) =>
          base.parse(arg, path ? `${path}.${i}` : `${i}`)
        );
      }
      throw new ArraySchemaError(path);
    },
  });
}

/**
 * Creates a record schema that validates object fields.
 */
export function RecordSchema<Fields extends Record<string, SchemaType>>(
  fields: Fields,
): RecordSchema<Fields> {
  const parseFields = Object.entries(fields).map(
    ([key, { parse }]) => (arg: any, path: string) => [
      key,
      parse(arg[key], path ? `${path}.${key}` : key),
    ],
  );

  return create({
    type: "record",
    fields,
    parse(arg, path = "") {
      if (typeof arg === "object" && arg !== null) {
        const parsedFields = parseFields.map((handler) => handler(arg, path));
        return Object.fromEntries(parsedFields) as StaticRecordSchema<Fields>;
      }
      throw new RecordSchemaError(path);
    },
  });
}
