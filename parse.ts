/**
 * Parse module entry point - comprehensive parsing utilities for data validation and transformation.
 * Provides type-safe parsing with detailed error reporting and query support.
 */

// Core utilities
export {
  ParseError,
  ParseQuery,
  parseSchema,
  parseSchemaHandler,
} from "./parse/core.ts";

// Type definitions
export type {
  ParserType,
  StaticParse,
  StaticRecordParse,
} from "./parse/types.ts";

// Primitive parsers
export {
  ParseBoolean,
  ParseDate,
  ParseNumber,
  ParseString,
} from "./parse/primitives.ts";

// Complex parsers
export {
  ParseArray,
  ParseKeyValue,
  ParseOptional,
  ParseRecord,
  ParseUnion,
} from "./parse/complex.ts";

// Extended parsers
export {
  ParseAny,
  ParseBigInt,
  ParseDefault,
  ParseExtend,
  ParseLiteral,
  ParseLiteralMatch,
  ParseNull,
  ParseSchema,
} from "./parse/extensions.ts";
