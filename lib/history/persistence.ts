import type { D1Like } from "../identification/persistence.ts";
import { buildHistoryQuery, historyCursorAfter, type HistoryQuery } from "./query.ts";
import type { HistoryEvent, HistoryEventKind, HistoryPage } from "./types.ts";

type HistoryRow = {
  kind: HistoryEventKind;
  id: string;
  created_at: string;
  type: string;
  part_id: string | null;
  part_name: string | null;
  part_model: string | null;
  quantity: number | null;
  quantity_before: number | null;
  quantity_after: number | null;
};

function eventFromRow(row: HistoryRow): HistoryEvent {
  return {
    id: row.id,
    kind: row.kind,
    at: row.created_at,
    type: row.type,
    partId: row.part_id,
    partName: row.part_name,
    partModel: row.part_model,
    quantity: row.quantity,
    quantityBefore: row.quantity_before,
    quantityAfter: row.quantity_after,
  };
}

export async function listHistory(ownerId: string, query: HistoryQuery, db: D1Like): Promise<HistoryPage> {
  const { sql, bindings } = buildHistoryQuery(ownerId, query);
  // One extra row tells us whether another page exists without a second count.
  const rows = await db.prepare(sql).bind(...bindings, query.limit + 1).all<HistoryRow>();

  const hasMore = rows.results.length > query.limit;
  const page = hasMore ? rows.results.slice(0, query.limit) : rows.results;
  const last = page[page.length - 1];

  return {
    events: page.map(eventFromRow),
    nextCursor: hasMore && last ? historyCursorAfter({ at: last.created_at, id: last.id }) : null,
  };
}
