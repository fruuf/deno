// deno-lint-ignore-file no-explicit-any
import {
  BooleanSchemaError,
  DateSchemaError,
  FloatSchemaError,
  IntegerSchemaError,
  StringSchemaError,
} from "./errors.ts";
import type {
  BooleanSchema as BooleanSchemaType,
  DateSchema as DateSchemaType,
  FloatSchema as FloatSchemaType,
  IntegerSchema as IntegerSchemaType,
  NullSchema as NullSchemaType,
  StringSchema as StringSchemaType,
} from "./types.ts";

/**
 * Creates a typed schema object with proper type inference.
 */
function create<Schema>(type: Omit<Schema, "_schema">): Schema {
  return type as any;
}

/**
 * Schema for null values - always returns null.
 */
export const NullSchema: NullSchemaType = create({
  type: "null",
  parse() {
    return null;
  },
});

/**
 * Schema for string values with type validation.
 */
export const StringSchema: StringSchemaType = create({
  type: "string",
  parse(arg, path = "") {
    if (typeof arg === "string") {
      return arg;
    }
    throw new StringSchemaError(path);
  },
});

/**
 * Schema for integer values - rounds floating point numbers.
 */
export const IntegerSchema: IntegerSchemaType = create({
  type: "integer",
  parse(arg, path = "") {
    if (typeof arg === "string" && /^\-?\d+$/.test(arg)) {
      return Number(arg);
    }
    if (typeof arg === "number") {
      return Math.round(arg);
    }
    throw new IntegerSchemaError(path);
  },
});

/**
 * Schema for floating-point numbers with type validation.
 */
export const FloatSchema: FloatSchemaType = create({
  type: "float",
  parse(arg, path = "") {
    if (typeof arg === "string" && /^\-?\d+(\.\d+)?$/.test(arg)) {
      return Number(arg);
    }
    if (typeof arg === "number") {
      return arg;
    }
    throw new FloatSchemaError(path);
  },
});

/**
 * Schema for boolean values with type validation.
 */
export const BooleanSchema: BooleanSchemaType = create({
  type: "boolean",
  parse(arg, path = "") {
    if (typeof arg === "boolean") {
      return arg;
    }
    throw new BooleanSchemaError(path);
  },
});

/**
 * Schema for date values - returns timestamp as number.
 */
export const DateSchema: DateSchemaType = create({
  type: "date",
  parse(arg, path = "") {
    const date = Number(new Date(arg));
    if (Number.isInteger(date)) {
      return date;
    }
    if (/^\d+$/.test(arg)) {
      return Number(arg);
    }
    throw new DateSchemaError(path);
  },
});
