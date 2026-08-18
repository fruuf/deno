import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

type Replacer<Type> = {
  check(value: unknown): boolean;
  serialize(value: Type): string;
  parse(value: string): Type;
};

const REPLACERS: Record<string, Replacer<unknown>> = {
  bigint: {
    check: (value: unknown) => typeof value === "bigint",
    serialize: (value: bigint) => value.toString(10),
    parse: (value: string) => BigInt(value),
  },
  undefined: {
    check: (value: unknown) => value === undefined,
    serialize: () => "",
    parse: () => undefined,
  },
  Date: {
    check: (value: unknown) => value instanceof Date,
    serialize: (value: Date) => value.toISOString(),
    parse: (value: string) => new Date(value),
  },
  Uint8Array: {
    check: (value: unknown) => value instanceof Uint8Array,
    serialize: (array: Uint8Array) => encodeBase64(array),
    parse: (base64: string) => decodeBase64(base64),
  },
};

type Replaced = {
  __replaced: true;
  __type: string;
  __value: string;
};

// deno-lint-ignore no-explicit-any
function isReplaced(value: any): value is Replaced {
  if (value?.__replaced !== true) return false;

  if (typeof value?.__type !== "string") return false;

  if (typeof value?.__value !== "string") return false;
  return true;
}

function reviver(_key: string, value: unknown) {
  if (isReplaced(value)) {
    const { parse } = REPLACERS[value.__type];

    return parse(value.__value);
  }
  return value;
}

function parseNext(value: unknown, path = ""): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item, index) => parseNext(item, `${path}.${index}`));
  }

  if (value instanceof Object && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        parseNext(value, `${path}.${key}`),
      ]),
    );
  }

  for (const [type, { check, serialize }] of Object.entries(REPLACERS)) {
    if (check(value)) {
      return { __replaced: true, __type: type, __value: serialize(value) };
    }
  }

  throw Error(`invalid value "${typeof value}" at ${path} (${value})`);
}

/**
 * Serializes values with support for BigInt, Date, and Uint8Array.
 */
export function serializeJSON(value: unknown) {
  return JSON.stringify(parseNext(value));
}

/**
 * Parses JSON with support for BigInt, Date, and Uint8Array.
 */
export function parseJSON<Type>(json: string): Type {
  return JSON.parse(json, reviver);
}
