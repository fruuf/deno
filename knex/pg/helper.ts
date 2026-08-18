import { PgHelper } from "./types.ts";

export function isPgHelper(value: unknown): value is PgHelper<unknown> {
  return typeof value === "object" && value !== null &&
    "query" in value && "bindings" in value;
}

function createPgHelper<T>(
  query: string,
  bindings: unknown[] = [],
): PgHelper<T> {
  return { query, bindings } as PgHelper<T>;
}

export function PG_NULL(): PgHelper<null> {
  return createPgHelper("is null");
}

export function PG_NOT_NULL(): PgHelper<null> {
  return createPgHelper("is not null");
}

export function PG_GT(value: number): PgHelper<number> {
  return createPgHelper("> ?", [String(value)]);
}

export function PG_GTE(value: number): PgHelper<number> {
  return createPgHelper(">= ?", [String(value)]);
}

export function PG_LT(value: number): PgHelper<number> {
  return createPgHelper("< ?", [String(value)]);
}

export function PG_LTE(value: number): PgHelper<number> {
  return createPgHelper("<= ?", [String(value)]);
}

export function PG_GT_BI(value: bigint): PgHelper<bigint> {
  return createPgHelper("> ?", [String(value)]);
}

export function PG_GTE_BI(value: bigint): PgHelper<bigint> {
  return createPgHelper(">= ?", [String(value)]);
}

export function PG_LT_BI(value: bigint): PgHelper<bigint> {
  return createPgHelper("< ?", [String(value)]);
}

export function PG_LTE_BI(value: bigint): PgHelper<bigint> {
  return createPgHelper("<= ?", [String(value)]);
}
