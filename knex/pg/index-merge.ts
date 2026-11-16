import { assert, equal } from "jsr:@std/assert";
import { hashIndex } from "./index-utils.ts";
import type { Index, SortIndex, UniqueIndex } from "./types.ts";

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

// sort queries per table and where clause above which the exact search falls back
// to the greedy merge (the search is exponential in this number)
const MAX_EXACT_QUERIES = 12;

type Prefix = Set<string>;

type Group = {
  // prefixes the index has to provide, see sortPrefixes
  chain: Prefix[];
  sorts: SortIndex[];
  // set when the group is a unique index, which can't grow past its columns
  unique: UniqueIndex | null;
};

function isSubset(a: Prefix, b: Prefix) {
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * A sort query needs an index whose first columns are its equality columns in any
 * order, followed by its order columns. That is a set of required prefixes: the
 * equality columns, then each order column added in turn.
 */
function sortPrefixes(index: SortIndex): Prefix[] {
  const prefixes: Prefix[] = [];
  const current = new Set(index.columns);
  if (current.size > 0) prefixes.push(new Set(current));
  for (const order of index.orders) {
    current.add(order);
    prefixes.push(new Set(current));
  }
  return prefixes;
}

/**
 * One index can serve several queries exactly when all their prefixes nest
 * (every pair is contained in one another). A unique index can't take prefixes
 * beyond its own columns.
 */
function fitsGroup(group: Group, prefixes: Prefix[]) {
  const bound = group.unique ? new Set(group.unique.columns) : null;
  return prefixes.every((prefix) =>
    (!bound || isSubset(prefix, bound)) &&
    group.chain.every((link) =>
      prefix.size <= link.size ? isSubset(prefix, link) : isSubset(link, prefix)
    )
  );
}

/**
 * Orders an index's columns so every prefix of the group is a leading set of
 * columns; columns that are free to move are sorted so the result is canonical.
 */
function chainColumns(chain: Prefix[]) {
  const columns: string[] = [];
  for (const link of [...chain].sort((a, b) => a.size - b.size)) {
    columns.push(
      ...[...link].filter((column) => !columns.includes(column)).sort(),
    );
  }
  return columns;
}

function buildIndexes(groups: Group[]): Index[] {
  return groups.map((group): Index => {
    const columns = chainColumns(group.chain);
    if (group.unique) {
      return { ...group.unique, columns };
    }
    // describe the index like the widest query in it, index names are hashes of
    // columns and orders, so this keeps the names the greedy merge produced
    const [widest] = [...group.sorts].sort((a, b) =>
      (b.columns.length + b.orders.length - a.columns.length -
        a.orders.length) ||
      (a.orders.length - b.orders.length) ||
      hashIndex(b).localeCompare(hashIndex(a))
    );
    assert(
      equal(
        columns.slice(columns.length - widest.orders.length),
        widest.orders,
      ),
    );
    return {
      ...widest,
      columns: columns.slice(0, columns.length - widest.orders.length),
      orders: [...widest.orders],
    };
  });
}

function indexKey(index: Index) {
  const columns = index.type === "sort"
    ? [...index.columns, "|", ...index.orders]
    : index.columns;
  return `${index.type}(${columns.join(",")})`;
}

/**
 * Ranks layouts: fewest indexes, then fewest indexed columns. Equal layouts are
 * decided in mergeWhereGroup.
 */
function layoutScore(indexes: Index[]) {
  return [
    indexes.length,
    indexes.reduce((sum, index) =>
      sum + index.columns.length +
      (index.type === "sort" ? index.orders.length : 0), 0),
  ];
}

function compareScores(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Finds the best layout for indexes sharing a where clause by trying every way of
 * assigning sort queries to unique indexes or to shared sort indexes. The greedy
 * result seeds the search and wins ties, so layouts that are already optimal keep
 * their indexes (and index names). Other ties prefer unique indexes in their sorted
 * column order, then a canonical key.
 */
function mergeWhereGroup(uniques: UniqueIndex[], sorts: SortIndex[]): Index[] {
  const greedy = mergeAllIndexes([...sorts, ...uniques].map(cloneIndex));
  if (sorts.length > MAX_EXACT_QUERIES) {
    return greedy;
  }

  let best = { indexes: greedy, score: layoutScore(greedy), seeded: true };
  const queries = sorts
    .map((index) => ({ index, prefixes: sortPrefixes(index) }))
    // most constrained first, so the search prunes early
    .sort((a, b) =>
      (b.prefixes.length - a.prefixes.length) ||
      hashIndex(a.index).localeCompare(hashIndex(b.index))
    );

  function visit(position: number, groups: Group[]) {
    if (groups.length > best.indexes.length) return;
    if (position === queries.length) {
      const indexes = buildIndexes(groups);
      const score = layoutScore(indexes);
      const order = compareScores(score, best.score);
      if (
        order < 0 ||
        (order === 0 && !best.seeded &&
          ((reorderedUniques(indexes) - reorderedUniques(best.indexes)) ||
              indexes.map(indexKey).sort().join(";").localeCompare(
                best.indexes.map(indexKey).sort().join(";"),
              )) < 0)
      ) {
        best = { indexes, score, seeded: false };
      }
      return;
    }
    const { index, prefixes } = queries[position];
    groups.forEach((group, groupIndex) => {
      if (!fitsGroup(group, prefixes)) return;
      const next = [...groups];
      next[groupIndex] = {
        ...group,
        chain: [...group.chain, ...prefixes],
        sorts: [...group.sorts, index],
      };
      visit(position + 1, next);
    });
    visit(position + 1, [...groups, {
      chain: prefixes,
      sorts: [index],
      unique: null,
    }]);
  }

  visit(
    0,
    uniques.map((unique) => ({
      chain: [new Set(unique.columns)],
      sorts: [],
      unique,
    })),
  );
  return best.indexes;
}

/**
 * Merges indexes into the fewest physical indexes that still serve every query.
 * The result only depends on the set of indexes, not on the order they were declared.
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

  const uniqueIndexes = mergeUniqueIndexes(
    nextIndexes
      .filter((index) => index.type === "unique")
      .sort((a, b) =>
        (b.columns.length - a.columns.length) ||
        hashIndex(a).localeCompare(hashIndex(b))
      ),
  ).sort((a, b) =>
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

  // indexes only merge with indexes that have the same where clause
  const whereKeys = [
    ...new Set(nextIndexes.map((index) => whereKey(index.where))),
  ].sort();

  return whereKeys
    .flatMap((key) =>
      mergeWhereGroup(
        uniqueIndexes.filter((index) => whereKey(index.where) === key),
        sortIndexes.filter((index) => whereKey(index.where) === key),
      )
    )
    .sort((a, b) =>
      (a.columns.length - b.columns.length) ||
      hashIndex(a).localeCompare(hashIndex(b))
    );
}

function whereKey(where: Record<string, unknown>) {
  return JSON.stringify(
    Object.entries(where).sort(([a], [b]) => a.localeCompare(b)),
  );
}

// merging mutates column arrays, so the greedy merge works on copies
function cloneIndex(index: Index): Index {
  if (index.type === "sort") {
    return { ...index, columns: [...index.columns], orders: [...index.orders] };
  }
  return { ...index, columns: [...index.columns] };
}

// unique indexes start out with sorted columns; a merge that reorders one rebuilds it
function reorderedUniques(indexes: Index[]) {
  return indexes.filter((index) =>
    index.type === "unique" &&
    !equal(index.columns, [...index.columns].sort())
  ).length;
}
