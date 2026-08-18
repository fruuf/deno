// deno-lint-ignore-file no-explicit-any
import { checkIsError, errorHandler } from "../error.ts";
import type { SchemaType } from "../schema.ts";
import { create, singleValue } from "./core.ts";
import { ParseString } from "./primitives.ts";
import type {
  ParseAny,
  ParseExtend,
  ParseLiteral,
  ParserType,
  ParseSchema,
  StaticParse,
} from "./types.ts";

/**
 * Creates a flexible parser that can handle any type with optional transformation.
 */
export function ParseAny<Next>(
  parse: (arg: any) => Next = (arg) => arg,
): ParseAny<Next> {
  return create({
    type: "any",
    parse: singleValue((value) => {
      try {
        return { success: true, value: parse(value) };
      } catch (e) {
        checkIsError(e);
        return { success: false, message: e.message };
      }
    }),
  });
}

/**
 * Creates a literal parser that always returns the specified value.
 */
export function ParseLiteral<Value extends string>(
  value: Value,
): ParseLiteral<Value> {
  return create({
    type: "literal",
    value,
    parse() {
      return { success: true, value };
    },
  });
}

/**
 * Creates a literal parser that matches against the specified value.
 */
export function ParseLiteralMatch<Value extends string>(
  value: Value,
): ParseLiteral<Value> {
  return create({
    type: "literal",
    value,
    parse: singleValue((match) => {
      if (match !== value) {
        return {
          success: false,
          message: `literal (${value} / ${match})`,
        };
      }
      return { success: true, value };
    }),
  });
}

/**
 * Creates an extended parser that transforms the result of another parser.
 */
export function ParseExtend<Parser extends ParserType, Next>(
  parser: Parser,
  parse: (arg: StaticParse<Parser>) => Next,
): ParseExtend<Next> {
  return create({
    type: "extend",
    parse(args) {
      try {
        const result = parser.parse(args);
        if (!result.success) {
          return result;
        }
        return { success: true, value: parse(result.value) };
      } catch (e) {
        checkIsError(e);
        return { success: false, message: e.message };
      }
    },
  });
}

/**
 * Creates a parser with a default value fallback.
 */
export function ParseDefault<Parser extends ParserType>(
  parser: Parser,
  value: StaticParse<Parser>,
): Parser {
  return {
    ...parser,
    parse(args) {
      const result = parser.parse(args);

      if (result.success) {
        return result;
      }

      return { success: true, value };
    },
  };
}

/**
 * Creates a schema parser that integrates with the schema validation system.
 */
export function ParseSchema<
  Parser extends ParserType,
  Schema extends SchemaType,
>(parser: Parser, schema: Schema): ParseSchema<Schema> {
  return create({
    type: "parser",
    parse(args) {
      const result = parser.parse(args);
      if (!result.success) {
        return result;
      }
      try {
        return { success: true, value: schema.parse(result.value) };
      } catch (e) {
        const handledError = errorHandler(e);
        return { success: false, message: handledError.message };
      }
    },
  });
}

/**
 * Parser that always returns null.
 */
export const ParseNull = ParseAny(() => null);

/**
 * Parser that converts strings to BigInt values.
 */
export const ParseBigInt = ParseExtend(ParseString, (string) => {
  if (string === "0x") {
    return BigInt(0);
  }
  return BigInt(string);
});
