// deno-lint-ignore-file no-explicit-any
import { create, indentMessage, singleValue } from "./core.ts";
import type {
  ParseArray,
  ParseOptional,
  ParseRecord,
  ParserType,
  ParseUnion,
  StaticRecordParse,
} from "./types.ts";

/**
 * Creates a union parser that tries multiple parsers in sequence.
 */
export function ParseUnion<Item extends ParserType>(
  items: Item[],
): ParseUnion<Item> {
  return create({
    type: "union",
    items,
    parse(args) {
      const messages: string[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const result = items[index].parse(args);

        if (result.success) {
          return result;
        }

        const itemMessage = indentMessage(result.message);
        messages.push(`union_item (${index})\n${itemMessage}`);
      }

      const unionMessage = indentMessage(messages.join("\n"));

      return {
        success: false,
        message: `union\n${unionMessage}`,
      };
    },
  });
}

/**
 * Creates an optional parser that allows null/undefined values.
 */
export function ParseOptional<Parser extends ParserType>(
  parser: Parser,
): ParseOptional<Parser> {
  return create({
    type: "optional",
    parser,
    parse(args) {
      if (args.every((value) => (value === null) || (value === undefined))) {
        return { success: true, value: null };
      }

      const result = parser.parse(args);

      if (result.success) {
        return result;
      }

      return {
        success: false,
        message: `optional\n${result.message}`,
      };
    },
  });
}

/**
 * Creates an array parser that parses each element with the given parser.
 */
export function ParseArray<Parser extends ParserType>(
  parser: Parser,
  allowEmpty = false,
): ParseArray<Parser> {
  return create({
    type: "array",
    parser,
    parse(args) {
      if (!allowEmpty && args.length === 0) {
        return {
          success: false,
          message: "array_empty",
        };
      }

      const results: any[] = [];
      for (let index = 0; index < args.length; index += 1) {
        const result = parser.parse([args[index]]);
        if (!result.success) {
          return {
            success: false,
            message: `array_element (${index})\n${result.message}`,
          };
        }
        results.push(result.value);
      }

      return {
        success: true,
        value: results,
      };
    },
  });
}

/**
 * Creates a key-value parser that converts objects to arrays of key-value pairs.
 */
export function ParseKeyValue<Parser extends ParserType>(
  parser: Parser,
): ParseArray<Parser> {
  return create({
    type: "array",
    parser,
    parse: singleValue((value) => {
      if (typeof value !== "object" || value === null) {
        return { success: false, message: `key_value (${typeof value})` };
      }

      const pairs = Object.entries(value).map(([key, pairValue]) => ({
        key,
        value: pairValue,
      }));

      const results: any[] = [];
      for (let index = 0; index < pairs.length; index += 1) {
        const result = parser.parse([pairs[index]]);
        if (!result.success) {
          return {
            success: false,
            message: `key_value_element (${index})\n${result.message}`,
          };
        }
        results.push(result.value);
      }

      return {
        success: true,
        value: results,
      };
    }),
  });
}

/**
 * Creates a record parser that parses objects with specified field types.
 */
export function ParseRecord<Fields extends Record<string, ParserType>>(
  fields: Fields,
): ParseRecord<Fields> {
  const fieldPairs = Object.entries(fields);

  return create({
    type: "record",
    fields,
    parse: singleValue((value) => {
      if (Array.isArray(value)) {
        return { success: false, message: `record_value (${value})` };
      }

      const resultPairs: [string, any][] = [];

      for (const [key, parser] of fieldPairs) {
        const result = parser.parse([value]);
        if (!result.success) {
          return {
            success: false,
            message: `record_key "${key}"\n${result.message}`,
          };
        }
        resultPairs.push([key, result.value]);
      }

      return {
        success: true,
        value: Object.fromEntries(resultPairs) as StaticRecordParse<Fields>,
      };
    }),
  });
}
