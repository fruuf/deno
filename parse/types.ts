// deno-lint-ignore-file no-explicit-any
import type { SchemaType, StaticSchema } from "../schema.ts";

/**
 * Success result of a parsing operation.
 */
export type ParseSuccess<Type> = { success: true; value: Type };

/**
 * Failure result of a parsing operation.
 */
export type ParseFailure = { success: false; message: string };

/**
 * Result of a parsing operation, either success or failure.
 */
export type ParseResult<Type> = ParseSuccess<Type> | ParseFailure;

/**
 * Function that handles parsing with given arguments.
 */
export type ParseHandler<Type> = (args: any[]) => ParseResult<Type>;

/**
 * Extended parser type with transformation functionality.
 */
export type ParseExtend<Type> = {
  type: "extend";
  parse: ParseHandler<Type>;
  _parse: Type;
};

/**
 * String parser type definition.
 */
export type ParseString = {
  type: "string";
  parse: ParseHandler<string>;
  _parse: string;
};

/**
 * Number parser type definition.
 */
export type ParseNumber = {
  type: "number";
  parse: ParseHandler<number>;
  _parse: number;
};

/**
 * Boolean parser type definition.
 */
export type ParseBoolean = {
  type: "boolean";
  parse: ParseHandler<boolean>;
  _parse: boolean;
};

/**
 * Date parser type definition that returns timestamp.
 */
export type ParseDate = {
  type: "date";
  parse: ParseHandler<number>;
  _parse: number;
};

/**
 * Any parser type for flexible parsing.
 */
export type ParseAny<Type> = {
  type: "any";
  parse: ParseHandler<Type>;
  _parse: Type;
};

/**
 * Literal parser type for exact string matching.
 */
export type ParseLiteral<Value extends string> = {
  type: "literal";
  value: Value;
  parse: ParseHandler<Value>;
  _parse: Value;
};

/**
 * Union parser type for multiple possible parsers.
 */
export type ParseUnion<Item extends ParserType> = {
  type: "union";
  items: Item[];
  parse: ParseHandler<StaticParse<Item>>;
  _parse: StaticParse<Item>;
};

/**
 * Optional parser type that allows null values.
 */
export type ParseOptional<Parser extends ParserType> = {
  type: "optional";
  parser: Parser;
  parse: ParseHandler<StaticParse<Parser> | null>;
  _parse: StaticParse<Parser> | null;
};

/**
 * Array parser type for collections of parsed values.
 */
export type ParseArray<Parser extends ParserType> = {
  type: "array";
  parser: Parser;
  parse: ParseHandler<StaticParse<Parser>[]>;
  _parse: StaticParse<Parser>[];
};

/**
 * Schema parser type that integrates with schema validation.
 */
export type ParseSchema<Base extends SchemaType> = {
  type: "parser";
  parse: ParseHandler<StaticSchema<Base>>;
  _parse: StaticSchema<Base>;
};

/**
 * Utility type for extracting static parse types from record parsers.
 */
export type StaticRecordParse<Parser> = Parser extends
  Record<string, ParserType> ? {
    [K in keyof Parser]: StaticParse<Parser[K]>;
  }
  : never;

/**
 * Record parser type for objects with typed fields.
 */
export type ParseRecord<Fields extends Record<string, ParserType>> = {
  type: "record";
  fields: Fields;
  parse: ParseHandler<StaticRecordParse<Fields>>;
  _parse: StaticRecordParse<Fields>;
};

/**
 * Union of all possible parser types.
 */
export type ParserType =
  | ParseAny<any>
  | ParseArray<any>
  | ParseBoolean
  | ParseDate
  | ParseExtend<any>
  | ParseLiteral<any>
  | ParseNumber
  | ParseOptional<any>
  | ParseRecord<any>
  | ParseSchema<any>
  | ParseString
  | ParseUnion<any>;

/**
 * Utility type for extracting the static type from a parser.
 */
export type StaticParse<Parser extends ParserType> = Parser["_parse"];
