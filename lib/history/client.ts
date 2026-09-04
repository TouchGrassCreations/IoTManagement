import { ApiError } from "../inventory/client.ts";
import type { HistoryPage } from "./types.ts";

export function historyUrl(cursor?: string | null): string {
  return cursor ? `/api/history?cursor=${encodeURIComponent(cursor)}` : "/api/history";
}

export async function fetchHistory(cursor?: string | null): Promise<HistoryPage> {
  const response = await fetch(historyUrl(cursor), { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as (HistoryPage & { error?: string }) | null;
  if (!response.ok) throw new ApiError(payload?.error || "History could not be loaded.", response.status);
  if (!payload) throw new ApiError("The server returned an unreadable response.", response.status);
  return payload;
}
