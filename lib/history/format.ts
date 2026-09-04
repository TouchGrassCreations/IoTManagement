import type { HistoryEvent } from "./types.ts";

/** Adjustment rows point at a part that a full removal may have taken away. */
const REMOVED_PART = "a part that has since been removed";

function partOf(event: HistoryEvent): string {
  return event.partName ?? REMOVED_PART;
}

function units(count: number): string {
  return `${count} ${count === 1 ? "unit" : "units"}`;
}

function describeScan(event: HistoryEvent): string {
  const count = event.quantity ?? 0;
  return `Scanned a photo and catalogued ${count} ${count === 1 ? "part" : "parts"}.`;
}

function describeIdentification(event: HistoryEvent): string {
  const quantity = units(event.quantity ?? 0);
  return event.type === "manual"
    ? `Added ${partOf(event)} by hand — ${quantity}.`
    : `Identified ${partOf(event)} in a photo and filed ${quantity}.`;
}

function describeAdjustment(event: HistoryEvent): string {
  const part = partOf(event);
  const before = event.quantityBefore ?? 0;
  const after = event.quantityAfter ?? 0;
  switch (event.type) {
    case "quantity_removed":
      return `Removed ${event.quantity ?? 0} of ${part}, leaving ${after}.`;
    case "quantity_adjusted":
      return `Changed ${part} stock from ${before} to ${after}.`;
    case "details_edited":
      return `Edited the details of ${part}.`;
    case "merged_into":
      return `Merged a duplicate into ${part} — stock went from ${before} to ${after}.`;
    case "csv_imported":
      return before === 0
        ? `Imported ${part} from a CSV file — ${units(after)}.`
        : `Imported ${after - before} more of ${part} from a CSV file — stock went from ${before} to ${after}.`;
    default:
      return `Updated ${part}.`;
  }
}

/** One plain sentence per event, in the words someone would use at the bench. */
export function describeHistoryEvent(event: HistoryEvent): string {
  if (event.kind === "scan") return describeScan(event);
  if (event.kind === "identification") return describeIdentification(event);
  return describeAdjustment(event);
}

/**
 * Stored timestamps are SQLite's `CURRENT_TIMESTAMP`, which is UTC without a
 * zone marker; parsing one as-is would read it as local time.
 */
export function historyDate(at: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at) ? `${at.replace(" ", "T")}Z` : at);
}
