import { respond } from "../../../lib/http/respond.ts";
import { routeContext } from "../../../lib/http/context.ts";
import { parseInventoryQuery, type InventoryQuery } from "../../../lib/inventory/query.ts";
import type { InventoryPage } from "../../../lib/inventory/types.ts";

type Dependencies = { list: (query: InventoryQuery) => Promise<InventoryPage> };

export async function handleInventoryList(request: Request, deps: Dependencies): Promise<Response> {
  return respond("Inventory list", async () => {
    const page = await deps.list(parseInventoryQuery(new URL(request.url)));
    return Response.json(page);
  });
}

export async function GET(request: Request): Promise<Response> {
  return respond("Inventory list", async () => {
    const [{ ownerId, db }, { listInventory }] = await Promise.all([
      routeContext(request),
      import("../../../lib/inventory/persistence.ts"),
    ]);
    return handleInventoryList(request, { list: (query) => listInventory(ownerId, query, db) });
  });
}
