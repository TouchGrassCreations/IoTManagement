/**
 * The audit trail is three tables that only ever grow, so the timeline pages by
 * keyset the way the inventory list does: the cursor carries the timestamp and
 * id of the last row shown, and each source filters on it before the union.
 * An offset would re-read everything already scrolled past.
 */

export const DEFAULT_HISTORY_PAGE_SIZE = 40;
export const MAX_HISTORY_PAGE_SIZE = 100;

/** The sort key of the last row on the previous page. */
export type HistoryCursor = { at: string; id: string };

export type HistoryQuery = { limit: number; cursor: HistoryCursor | null };

export class InvalidHistoryQueryError extends Error {
  code = "INVALID_PAYLOAD" as const;
  constructor(message: string) {
    super(message);
  }
}

function encodeCursor(cursor: HistoryCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify([cursor.at, cursor.id]));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(raw: string): HistoryCursor {
  try {
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("shape");
    const [at, id] = parsed;
    if (typeof at !== "string" || typeof id !== "string") throw new Error("shape");
    return { at, id };
  } catch {
    throw new InvalidHistoryQueryError("The page cursor is not valid.");
  }
}

export function parseHistoryQuery(url: URL): HistoryQuery {
  const rawLimit = url.searchParams.get("limit");
  let limit = DEFAULT_HISTORY_PAGE_SIZE;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_PAGE_SIZE) {
      throw new InvalidHistoryQueryError(`limit must be a whole number from 1 to ${MAX_HISTORY_PAGE_SIZE}.`);
    }
  }

  const rawCursor = url.searchParams.get("cursor");
  return { limit, cursor: rawCursor ? decodeCursor(rawCursor) : null };
}

/** One row shape for all three sources, so the union can be ordered as a whole. */
const SOURCES = [
  `SELECT 'scan' AS kind, id AS id, created_at AS created_at, provider AS type,
          NULL AS part_id, NULL AS part_name, NULL AS part_model,
          accepted_detection_count AS quantity, NULL AS quantity_before, NULL AS quantity_after
   FROM identification_scans`,
  `SELECT 'identification' AS kind, id AS id, created_at AS created_at, source AS type,
          inventory_part_id AS part_id, confirmed_name AS part_name, confirmed_model AS part_model,
          quantity_added AS quantity, NULL AS quantity_before, NULL AS quantity_after
   FROM identification_events`,
  `SELECT 'adjustment' AS kind, e.id AS id, e.created_at AS created_at, e.event_type AS type,
          e.inventory_part_id AS part_id,
          (SELECT p.name FROM inventory_parts p WHERE p.id = e.inventory_part_id AND p.owner_id = e.owner_id) AS part_name,
          (SELECT p.model FROM inventory_parts p WHERE p.id = e.inventory_part_id AND p.owner_id = e.owner_id) AS part_model,
          e.quantity_removed AS quantity, e.quantity_before AS quantity_before, e.quantity_after AS quantity_after
   FROM inventory_adjustment_events e`,
];

const OWNER_COLUMN = ["owner_id", "owner_id", "e.owner_id"];
const CREATED_COLUMN = ["created_at", "created_at", "e.created_at"];
const ID_COLUMN = ["id", "id", "e.id"];

export type BuiltHistoryQuery = { sql: string; bindings: unknown[] };

/** Builds the merged timeline query, always anchored to one owner. */
export function buildHistoryQuery(ownerId: string, query: HistoryQuery): BuiltHistoryQuery {
  const bindings: unknown[] = [];
  const branches = SOURCES.map((select, index) => {
    const clauses = [`${OWNER_COLUMN[index]} = ?`];
    bindings.push(ownerId);
    if (query.cursor) {
      clauses.push(
        `(${CREATED_COLUMN[index]} < ? OR (${CREATED_COLUMN[index]} = ? AND ${ID_COLUMN[index]} < ?))`,
      );
      bindings.push(query.cursor.at, query.cursor.at, query.cursor.id);
    }
    return `${select} WHERE ${clauses.join(" AND ")}`;
  });

  return {
    sql: `SELECT * FROM (${branches.join(" UNION ALL ")}) ORDER BY created_at DESC, id DESC LIMIT ?`,
    bindings,
  };
}

/** Cursor pointing just past the supplied row, or null when the page is last. */
export function historyCursorAfter(row: HistoryCursor | undefined): string | null {
  return row ? encodeCursor(row) : null;
}
