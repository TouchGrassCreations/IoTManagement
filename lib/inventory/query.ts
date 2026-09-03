/**
 * Search, filter, sort and paging for the inventory list. The client used to
 * hold every part in memory and filter locally; this moves the work into SQL
 * behind the covering indexes so a large cabinet pages instead of downloading
 * itself.
 */

export const DEFAULT_PAGE_SIZE = 48;
export const MAX_PAGE_SIZE = 100;
export const ALL_CATEGORIES = "All parts";

export type InventorySort = "name" | "recent" | "quantity";

export type InventoryQuery = {
  search: string;
  category: string | null;
  location: string | null;
  sort: InventorySort;
  limit: number;
  cursor: InventoryCursor | null;
};

/** The sort key of the last row on the previous page. */
export type InventoryCursor = { value: string; id: string };

const SORTS: InventorySort[] = ["name", "recent", "quantity"];

export class InvalidQueryError extends Error {
  code = "INVALID_PAYLOAD" as const;
  constructor(message: string) {
    super(message);
  }
}

function encodeCursor(cursor: InventoryCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify([cursor.value, cursor.id]));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(raw: string): InventoryCursor {
  try {
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("shape");
    const [value, id] = parsed;
    if (typeof value !== "string" || typeof id !== "string") throw new Error("shape");
    return { value, id };
  } catch {
    throw new InvalidQueryError("The page cursor is not valid.");
  }
}

export function parseInventoryQuery(url: URL): InventoryQuery {
  const params = url.searchParams;

  const rawLimit = params.get("limit");
  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new InvalidQueryError(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
    }
  }

  const rawSort = params.get("sort") ?? "name";
  if (!SORTS.includes(rawSort as InventorySort)) throw new InvalidQueryError("sort is not recognised.");

  const category = params.get("category");
  const location = params.get("location");
  const rawCursor = params.get("cursor");

  return {
    search: (params.get("search") ?? "").trim().slice(0, 120),
    category: !category || category === ALL_CATEGORIES ? null : category,
    location: location || null,
    sort: rawSort as InventorySort,
    limit,
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

type SortPlan = {
  /** SQL expression producing the cursor's `value` half. */
  keyExpression: string;
  orderBy: string;
  /** `>` for ascending sorts, `<` for descending ones. */
  comparison: ">" | "<";
  cursorValue: (row: { name: string; createdAt: string; quantity: number }) => string;
};

const SORT_PLANS: Record<InventorySort, SortPlan> = {
  name: {
    keyExpression: "name COLLATE NOCASE",
    orderBy: "name COLLATE NOCASE ASC, id ASC",
    comparison: ">",
    cursorValue: (row) => row.name,
  },
  recent: {
    keyExpression: "created_at",
    orderBy: "created_at DESC, id DESC",
    comparison: "<",
    cursorValue: (row) => row.createdAt,
  },
  quantity: {
    // Zero-padded so the textual cursor comparison agrees with the numeric sort.
    keyExpression: "printf('%012d', quantity)",
    orderBy: "quantity DESC, id DESC",
    comparison: "<",
    cursorValue: (row) => String(row.quantity).padStart(12, "0"),
  },
};

export type BuiltQuery = { where: string; order: string; bindings: unknown[] };

/** Builds the WHERE/ORDER BY for a page, always anchored to one owner. */
export function buildInventoryQuery(ownerId: string, query: InventoryQuery): BuiltQuery {
  const plan = SORT_PLANS[query.sort];
  const clauses = ["owner_id = ?"];
  const bindings: unknown[] = [ownerId];

  if (query.category) {
    clauses.push("category = ?");
    bindings.push(query.category);
  }
  if (query.location) {
    clauses.push("location = ?");
    bindings.push(query.location);
  }
  if (query.search) {
    const columns = ["name", "code", "category", "tags", "description", "IFNULL(model,'')"];
    clauses.push(`(${columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    const pattern = `%${escapeLike(query.search)}%`;
    bindings.push(...columns.map(() => pattern));
  }
  if (query.cursor) {
    const { comparison, keyExpression } = plan;
    clauses.push(`(${keyExpression} ${comparison} ? OR (${keyExpression} = ? AND id ${comparison} ?))`);
    bindings.push(query.cursor.value, query.cursor.value, query.cursor.id);
  }

  return { where: clauses.join(" AND "), order: plan.orderBy, bindings };
}

/** Cursor pointing just past the supplied row, or null when the page is last. */
export function cursorAfter(
  sort: InventorySort,
  row: { id: string; name: string; createdAt: string; quantity: number } | undefined,
): string | null {
  if (!row) return null;
  return encodeCursor({ value: SORT_PLANS[sort].cursorValue(row), id: row.id });
}
