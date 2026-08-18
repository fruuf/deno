import { equal } from "jsr:@std/assert";
import { hashIndex } from "./index-utils.ts";
import type { Index, UniqueIndex } from "./types.ts";

function mergeUniqueIndexes(
  [index, ...candidates]: UniqueIndex[],
): UniqueIndex[] {
  function checkUniqueCandidate(candidate: UniqueIndex) {
    return mergeUniqueIndexes([
      candidate,
      ...candidates.filter((nextCandidate) => nextCandidate !== candidate),
    ]);
  }

  if (!index) {
    return [];
  }

  for (const candidate of candidates) {
    if (!equal(index.where, candidate.where)) {
      continue;
    }
    if (
      !candidate.columns.every((column) => index.columns.includes(column))
    ) {
      continue;
    }
    return checkUniqueCandidate(candidate);
  }
  return [index, ...mergeUniqueIndexes(candidates)];
}

function mergeAllIndexes(
  [index, ...candidates]: Index[],
): Index[] {
  function checkCandidate(candidate: Index) {
    return mergeAllIndexes([
      candidate,
      ...candidates.filter((nextCandidate) => nextCandidate !== candidate),
    ]);
  }
  if (!index) {
    return [];
  }
  const indexColumns = index.type === "unique"
    ? index.columns
    : [...index.columns, ...index.orders];

  for (const candidate of candidates) {
    if (index.type === "unique" && candidate.type === "sort") {
      continue;
    }
    if (!equal(index.where, candidate.where)) {
      continue;
    }
    if (
      !index.columns.every((column) => {
        if (candidate.type === "unique") {
          return candidate.columns.includes(column);
        }
        return candidate.columns.includes(column) ||
          candidate.orders.includes(column);
      })
    ) {
      continue;
    }
    if (
      index.type === "sort" &&
      !index.orders.every((order) => {
        if (candidate.type === "unique") {
          return candidate.columns.includes(order);
        }
        return candidate.columns.includes(order) ||
          candidate.orders.includes(order);
      })
    ) {
      continue;
    }

    if (candidate.type === "unique") {
      const nextColumns = indexColumns
        .concat(
          candidate.columns.filter((column) => !indexColumns.includes(column)),
        );

      if (nextColumns.length !== candidate.columns.length) {
        continue;
      }
      candidate.columns = nextColumns;
      return checkCandidate(candidate);
    }

    const nextColumns = indexColumns.slice(0, candidate.columns.length)
      .concat(
        candidate.columns.filter((column) => !indexColumns.includes(column)),
      );

    if (!candidate.columns.every((column) => nextColumns.includes(column))) {
      continue;
    }

    const nextOrders = indexColumns.slice(candidate.columns.length).concat(
      candidate.orders.filter((order) => !indexColumns.includes(order)),
    );

    if (
      candidate.columns.length !== nextColumns.length
    ) {
      continue;
    }

    if (!equal(nextOrders, candidate.orders)) {
      continue;
    }

    candidate.columns = nextColumns;
    return checkCandidate(candidate);
  }
  return [index, ...mergeAllIndexes(candidates)];
}

/**
 * Merges and optimizes multiple indexes by removing redundant ones.
 */
export function mergeIndexes(indexes: Index[]): Index[] {
  const nextIndexes = indexes
    .map((index) => {
      const columns = [...index.columns].sort();
      const where = Object.fromEntries(
        Object.entries(index.where).map(([key, value]) =>
          value instanceof Array ? [key, [...value].sort()] : [key, value]
        ),
      );
      if (index.type === "sort") {
        return { ...index, columns, where, orders: [...index.orders] };
      }
      return { ...index, columns, where };
    });

  let uniqueIndexes = nextIndexes
    .filter((index) => index.type === "unique")
    .sort((a, b) =>
      (b.columns.length - a.columns.length) ||
      hashIndex(a).localeCompare(hashIndex(b))
    );

  uniqueIndexes = mergeUniqueIndexes(uniqueIndexes)
    .sort((a, b) =>
      (a.columns.length - b.columns.length) ||
      hashIndex(a).localeCompare(hashIndex(b))
    );

  const sortIndexes = nextIndexes
    .filter((index) => index.type === "sort")
    .sort((a, b) =>
      (a.columns.length + a.orders.length - b.columns.length -
        b.orders.length) ||
      (b.orders.length - a.orders.length) ||
      hashIndex(a).localeCompare(hashIndex(b))
    );

  return mergeAllIndexes([...sortIndexes, ...uniqueIndexes])
    .sort((a, b) =>
      (a.columns.length - b.columns.length) ||
      hashIndex(a).localeCompare(hashIndex(b))
    );
}
