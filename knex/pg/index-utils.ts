import type { Index } from "./types.ts";
import { hash } from "./utils.ts";

function hashWhere(where: Record<string, unknown>) {
  return hash(
    Object.entries(where)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

/**
 * Generates a hash for an index definition.
 */
export function hashIndex(index: Index) {
  return hash({
    type: index.type,
    table: index.table,
    columns: index.columns,
    where: hashWhere(index.where),
    orders: index.type === "sort" ? index.orders : [],
  });
}
