import { respond } from "../../../../lib/http/respond.ts";
import { readContext } from "../../../../lib/http/context.ts";
import type { InventorySummary } from "../../../../lib/inventory/types.ts";

type Dependencies = { summarize: () => Promise<InventorySummary> };

/**
 * Totals and per-category counts the paginated list cannot produce, so the
 * sidebar and hero stay accurate without loading every part.
 */
export async function handleInventorySummary(deps: Dependencies): Promise<Response> {
  return respond("Inventory summary", async () => Response.json(await deps.summarize()));
}

export async function GET(request: Request): Promise<Response> {
  return respond("Inventory summary", async () => {
    const [{ ownerId, db }, { summarizeInventory }] = await Promise.all([
      readContext(request),
      import("../../../../lib/inventory/persistence.ts"),
    ]);
    return handleInventorySummary({ summarize: () => summarizeInventory(ownerId, db) });
  });
}
