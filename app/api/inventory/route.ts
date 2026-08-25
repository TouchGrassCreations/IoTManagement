import type { InventoryItem } from "../../../lib/inventory/types.ts";

type Dependencies = { list: () => Promise<InventoryItem[]> };

export async function handleInventoryList(deps: Dependencies): Promise<Response> {
  try {
    return Response.json({ inventory: await deps.list() });
  } catch (error) {
    console.error("Inventory list failed", error);
    return Response.json({ error: "Inventory is temporarily unavailable." }, { status: 500 });
  }
}

export async function GET(): Promise<Response> {
  const [{ env }, { listInventory }] = await Promise.all([
    import("cloudflare:workers"),
    import("../../../lib/inventory/persistence.ts"),
  ]);
  const bindings = env as unknown as { DB: import("../../../lib/identification/persistence.ts").D1Like };
  return handleInventoryList({ list: () => listInventory(bindings.DB) });
}
