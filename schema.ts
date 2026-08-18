/**
 * Schema validation module providing type-safe data validation and transformation.
 * Entry point that re-exports all public APIs from individual schema modules.
 */

// Re-export all types (only types, not duplicate names)
export type {
  SchemaType,
  StaticRecordSchema,
  StaticSchema,
} from "./schema/types.ts";

// Re-export all error classes
export {
  ArraySchemaError,
  Base64SchemaError,
  BooleanSchemaError,
  DateSchemaError,
  EmailSchemaError,
  EnumSchemaError,
  FloatSchemaError,
  IntegerSchemaError,
  IpSchemaError,
  LiteralSchemaError,
  MimeTypeSchemaError,
  NumberGTEError,
  NumberGTError,
  NumberLTEError,
  NumberLTError,
  RecordSchemaError,
  SchemaError,
  StringLengthGTEError,
  StringLengthGTError,
  StringLengthLTEError,
  StringLengthLTError,
  StringSchemaError,
  UnionSchemaError,
  UrlSchemaError,
  UuidSchemaError,
} from "./schema/errors.ts";

// Re-export primitive schemas (values)
export {
  BooleanSchema,
  DateSchema,
  FloatSchema,
  IntegerSchema,
  NullSchema,
  StringSchema,
} from "./schema/primitives.ts";

// Re-export composite schemas (functions)
export {
  ArraySchema,
  EnumSchema,
  LiteralSchema,
  OptionalSchema,
  RecordSchema,
  UnionSchema,
} from "./schema/composite.ts";

// Re-export validators and utilities
export {
  Base64Schema,
  CountrySchema,
  createSchemaHandler,
  EmailSchema,
  ExtendSchema,
  IpSchema,
  isSchema,
  LimitSchema,
  MimeTypeSchema,
  NumberGT,
  NumberGTE,
  NumberLT,
  NumberLTE,
  OffsetSchema,
  StringLengthGT,
  StringLengthGTE,
  StringLengthLT,
  StringLengthLTE,
  UrlSchema,
  UuidSchema,
  validateSchema,
} from "./schema/validators.ts";

// Re-export types
export type { CountryEnum } from "./schema/validators.ts";
