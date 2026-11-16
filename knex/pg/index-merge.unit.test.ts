import { expect } from "jsr:@std/expect";
import { describe, it } from "jsr:@std/testing/bdd";
import { mergeIndexes } from "./index-merge.ts";
import type { Index, SortIndex, UniqueIndex } from "./types.ts";

const unique = (
  columns: string[],
  where: Record<string, unknown> = {},
): UniqueIndex => ({ type: "unique", table: "t", columns, where });

const sort = (
  columns: string[],
  orders: string[] = [],
  where: Record<string, unknown> = {},
): SortIndex => ({ type: "sort", table: "t", columns, orders, where });

const layout = (indexes: Index[]) =>
  indexes
    .map((index) =>
      index.type === "unique"
        ? `unique(${index.columns})`
        : `sort(${index.columns}${
          index.orders.length ? `|${index.orders}` : ""
        })`
    )
    .sort();

const whereKey = (where: Record<string, unknown>) =>
  JSON.stringify(Object.entries(where).sort(([a], [b]) => a.localeCompare(b)));

// a sort query is served when an index with the same where clause starts with its
// equality columns (any order) followed by its order columns
function serves(index: Index, query: SortIndex) {
  if (whereKey(index.where) !== whereKey(query.where)) return false;
  const columns = index.type === "sort"
    ? [...index.columns, ...index.orders]
    : index.columns;
  const head = columns.slice(0, query.columns.length);
  return head.length === query.columns.length &&
    query.columns.every((column) => head.includes(column)) &&
    query.orders.every((order, offset) =>
      columns[query.columns.length + offset] === order
    );
}

// deterministic pseudo random numbers, so failures are reproducible
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function shuffle<T>(values: T[], next: () => number) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randomIndexes(next: () => number): Index[] {
  const columns = ["a", "b", "c", "d"];
  const pick = (count: number, from = columns) =>
    shuffle(from, next).slice(0, count);
  const where = () => (next() < 0.15 ? { active: true } : {});
  const uniques = Array.from(
    { length: Math.floor(next() * 3) },
    () => unique(pick(1 + Math.floor(next() * 3)), where()),
  );
  const sorts = Array.from({ length: Math.floor(next() * 7) }, () => {
    const equality = pick(Math.floor(next() * 3));
    const orders = pick(
      Math.floor(next() * 3),
      columns.filter((column) => !equality.includes(column)),
    );
    return sort(
      equality.length + orders.length ? equality : ["a"],
      orders,
      where(),
    );
  });
  return [...uniques, ...sorts];
}

describe("mergeIndexes", () => {
  it("keeps the unique index order a most-recent query needs", () => {
    const queries = [
      unique(["currency", "date"]),
      sort(["currency"], ["date"]),
      sort(["date"]),
    ];
    expect(layout(mergeIndexes(queries))).toEqual([
      "sort(date)",
      "unique(currency,date)",
    ]);
    expect(layout(mergeIndexes([...queries].reverse()))).toEqual([
      "sort(date)",
      "unique(currency,date)",
    ]);
  });

  it("folds compatible queries into one index", () => {
    expect(layout(mergeIndexes([sort(["a"]), sort(["a", "b"])]))).toEqual([
      "sort(a,b)",
    ]);
    expect(
      layout(
        mergeIndexes([sort(["a"], ["b"]), sort(["a"]), unique(["a", "b"])]),
      ),
    ).toEqual(["unique(a,b)"]);
    expect(layout(mergeIndexes([sort(["a"]), sort(["b"])]))).toEqual([
      "sort(a)",
      "sort(b)",
    ]);
  });

  it("only merges indexes with the same where clause", () => {
    expect(
      layout(
        mergeIndexes([sort(["a"]), sort(["a", "b"], [], { active: true })]),
      ),
    ).toEqual(["sort(a)", "sort(a,b)"]);
  });

  it("serves every query and keeps every constraint, whatever the declaration order", () => {
    const next = random(42);
    for (let run = 0; run < 500; run += 1) {
      const indexes = randomIndexes(next);
      const merged = mergeIndexes(indexes);

      for (const index of indexes) {
        if (index.type === "sort") {
          expect(merged.some((candidate) => serves(candidate, index))).toBe(
            true,
          );
        } else {
          // a unique constraint on fewer columns implies this one
          expect(
            merged.some((candidate) =>
              candidate.type === "unique" &&
              whereKey(candidate.where) === whereKey(index.where) &&
              candidate.columns.every((column) =>
                index.columns.includes(column)
              )
            ),
          ).toBe(true);
        }
      }

      // reordering declarations and their equality columns changes nothing
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const reordered = shuffle(indexes, next).map((index) => ({
          ...index,
          columns: shuffle(index.columns, next),
        }));
        expect(mergeIndexes(reordered)).toEqual(merged);
      }
    }
  });
});
