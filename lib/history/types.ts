/** Where a timeline entry came from. */
export type HistoryEventKind = "scan" | "identification" | "adjustment";

export type HistoryEvent = {
  id: string;
  kind: HistoryEventKind;
  /** SQL timestamp, `YYYY-MM-DD HH:MM:SS` in UTC. */
  at: string;
  /** The adjustment's event type, or the source that produced the row. */
  type: string;
  partId: string | null;
  /** Null once the part has been removed from the cabinet. */
  partName: string | null;
  partModel: string | null;
  quantity: number | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
};

export type HistoryPage = {
  events: HistoryEvent[];
  nextCursor: string | null;
};
