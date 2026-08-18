import { create, singleValue } from "./core.ts";
import type {
  ParseBoolean as ParseBooleanType,
  ParseDate as ParseDateType,
  ParseNumber as ParseNumberType,
  ParseString as ParseStringType,
} from "./types.ts";

/**
 * Parser for string values with number conversion support.
 */
export const ParseString: ParseStringType = create({
  type: "string",
  parse: singleValue((value) => {
    if (typeof value === "string") {
      return { success: true, value };
    }
    if (typeof value === "number") {
      return { success: true, value: String(value) };
    }
    return {
      success: false,
      message: `string (${value})`,
    };
  }),
});

/**
 * Parser for numeric values with string conversion support.
 */
export const ParseNumber: ParseNumberType = create({
  type: "number",
  parse: singleValue((value) => {
    if (typeof value === "number") {
      return {
        success: true,
        value,
      };
    }
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
      return { success: true, value: Number(value) };
    }
    return {
      success: false,
      message: `number (${value})`,
    };
  }),
});

/**
 * Parser for boolean values with string conversion support.
 */
export const ParseBoolean: ParseBooleanType = create({
  type: "boolean",
  parse: singleValue((value) => {
    if (typeof value === "boolean") {
      return {
        success: true,
        value,
      };
    }
    if (typeof value === "string") {
      const cleanValue = value.toLowerCase();
      return {
        success: true,
        value: cleanValue === "true" ||
          cleanValue === "1" ||
          cleanValue === "enabled" ||
          cleanValue === "on" ||
          cleanValue === "yes",
      };
    }
    return {
      success: false,
      message: `boolean (${value})`,
    };
  }),
});

/**
 * Parser for date values that returns timestamp numbers.
 */
export const ParseDate: ParseDateType = create({
  type: "date",
  parse: singleValue((value) => {
    if (value instanceof Date) {
      return {
        success: true,
        value: Number(value),
      };
    }

    if (typeof value === "number") {
      return {
        success: true,
        value,
      };
    }

    if (typeof value === "string") {
      if (/^\d+$/.test(value)) {
        return { success: true, value: Number(value) };
      }
      return { success: true, value: Number(new Date(value)) };
    }
    return {
      success: false,
      message: `date (${value})`,
    };
  }),
});
