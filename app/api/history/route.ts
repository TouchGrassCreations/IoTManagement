import { respond } from "../../../lib/http/respond.ts";
import { routeContext } from "../../../lib/http/context.ts";
import { parseHistoryQuery, type HistoryQuery } from "../../../lib/history/query.ts";
import type { HistoryPage } from "../../../lib/history/types.ts";

type Dependencies = { list: (query: HistoryQuery) => Promise<HistoryPage> };

/** Scans, confirmations and stock adjustments as one reverse-chronological page. */
export async function handleHistoryList(request: Request, deps: Dependencies): Promise<Response> {
  return respond("History list", async () => {
    const page = await deps.list(parseHistoryQuery(new URL(request.url)));
    return Response.json(page);
  });
}

export async function GET(request: Request): Promise<Response> {
  return respond("History list", async () => {
    const [{ ownerId, db }, { listHistory }] = await Promise.all([
      routeContext(request),
      import("../../../lib/history/persistence.ts"),
    ]);
    return handleHistoryList(request, { list: (query) => listHistory(ownerId, query, db) });
  });
}
