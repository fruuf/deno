import { IntegerSchema } from "../primitives.ts";
import { ExtendSchema } from "./core.ts";
import { NumberGTE, NumberLTE } from "./number.ts";

/**
 * Schema for pagination limit (1-50).
 */
export const LimitSchema = ExtendSchema(
  IntegerSchema,
  NumberGTE(1),
  NumberLTE(50),
);

/**
 * Schema for pagination offset (>= 0).
 */
export const OffsetSchema = ExtendSchema(
  IntegerSchema,
  NumberGTE(0),
);
