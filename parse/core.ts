// deno-lint-ignore-file no-explicit-any
import { errorHandler, SafeError } from "../error.ts";
import type {
  ParseHandler,
  ParseResult,
  ParserType,
  StaticParse,
} from "./types.ts";

/**
 * Indents each line of a message with two spaces.
 */
export function indentMessage(message: string): string {
  return message
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/**
 * Creates a parser instance with error handling wrapper.
 */
export function create<Parser extends ParserType>(
  parser: Omit<Parser, "_parse">,
): Parser {
  const parse: ParseHandler<any> = (args) => {
    try {
      return parser.parse(args);
    } catch (e) {
      const handledError = errorHandler(e);
      return {
        success: false,
        message: handledError.message,
      };
    }
  };
  return {
    ...parser,
    parse,
  } as any;
}

/**
 * Creates a parser for a specific part of the data structure.
 */
export function ParsePart<Parser extends ParserType>(
  part: string,
  parser: Parser,
): Parser {
  return create({
    ...(parser as any),
    parse(args) {
      const nextArgs = args
        .map((arg) => {
          try {
            const next = arg[part];
            return Array.isArray(next) ? next : [next];
          } catch {
            return [null];
          }
        })
        .flat()
        .filter((arg) => arg !== undefined);

      const result = parser.parse(nextArgs);

      if (result.success) {
        return result;
      }

      if (args.length === 0) {
        return {
          success: false,
          message: `query_skip "${part}"\n${result.message}`,
        };
      }

      if (nextArgs.length === 0) {
        const keySet = new Set<string>();

        for (const arg of args) {
          const { __self: attrs, ...rest } = arg || {};
          for (const key of Object.keys({ ...attrs, ...rest })) {
            keySet.add(key);
          }
        }

        const keys = Array.from(keySet)
          .sort()
          .map((key) => `"${key}"`)
          .join(", ");

        return {
          success: false,
          message: `query_empty "${part}" (${keys})\n${result.message}`,
        };
      }

      return {
        success: false,
        message: `query "${part}" (${nextArgs.length})\n${result.message}`,
      };
    },
  });
}

/**
 * Creates a query parser that supports dot notation for nested data access.
 */
export function ParseQuery<Parser extends ParserType>(
  query: string,
  parser: Parser,
): Parser {
  return query
    .split(".")
    .reverse()
    .reduce((prevSchema, part) => ParsePart(part, prevSchema), parser);
}

/**
 * Creates a parse handler that expects exactly one argument.
 */
export function singleValue<Type>(
  handler: (value: any) => ParseResult<Type>,
): ParseHandler<Type> {
  return (args) => {
    if (args.length !== 1) {
      return {
        success: false,
        message: `single (${args.length})`,
      };
    }

    const [value] = args;

    return handler(value);
  };
}

/**
 * Error class for parse failures.
 */
export class ParseError extends SafeError {
  parseError: string;
  constructor(parseError: string) {
    super("parseError", "parseError");
    this.parseError = parseError;
  }
}

/**
 * Parses data using a parser and throws on failure.
 */
export function parseSchema<Parser extends ParserType>(
  parser: Parser,
  data: any,
): StaticParse<Parser> {
  const result = parser.parse(Array.isArray(data) ? data : [data]);
  if (result.success) {
    return result.value;
  }
  throw new ParseError(result.message);
}

/**
 * Creates a handler that parses data and applies a transformation function.
 */
export function parseSchemaHandler<Schema extends ParserType, Result>(
  schema: Schema,
  handler: (data: StaticParse<Schema>) => Result,
) {
  return (data: any) => handler(parseSchema(schema, data));
}
