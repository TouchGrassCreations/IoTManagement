import { respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import { inventoryCsvHeader, inventoryCsvRow } from "../../../../lib/inventory/csv.ts";
import { MAX_PAGE_SIZE, parseInventoryQuery } from "../../../../lib/inventory/query.ts";
import type { InventoryPage } from "../../../../lib/inventory/types.ts";

type Dependencies = { list: (cursor: string | null) => Promise<InventoryPage> };

function fileName(): string {
  return `parts-cabinet-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Streams the cabinet a page at a time, so exporting a large catalogue never
 * builds the whole document in memory. The first page is fetched before the
 * response starts, so an unauthorised or failing export still maps to a status
 * rather than a truncated download.
 */
export async function handleInventoryExport(deps: Dependencies): Promise<Response> {
  return respond("Inventory export", async () => {
    const encoder = new TextEncoder();
    let page: InventoryPage | null = await deps.list(null);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${inventoryCsvHeader()}\r\n`));
      },
      async pull(controller) {
        if (!page) {
          controller.close();
          return;
        }
        const chunk = page.items.map((item) => `${inventoryCsvRow(item)}\r\n`).join("");
        if (chunk) controller.enqueue(encoder.encode(chunk));
        page = page.nextCursor ? await deps.list(page.nextCursor) : null;
        if (!page) controller.close();
      },
    });

    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName()}"`,
        "cache-control": "private, no-store",
      },
    });
  });
}

export async function GET(request: Request): Promise<Response> {
  return respond("Inventory export", async () => {
    const [{ ownerId, db }, { listInventory }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/inventory/persistence.ts"),
    ]);
    // Paging through the list query keeps the export inside the same
    // owner-scoped SQL the catalogue itself is served from.
    const list = (cursor: string | null) => {
      const url = new URL("http://export/api/inventory");
      url.searchParams.set("limit", String(MAX_PAGE_SIZE));
      if (cursor) url.searchParams.set("cursor", cursor);
      return listInventory(ownerId, parseInventoryQuery(url), db);
    };
    return handleInventoryExport({ list });
  });
}
