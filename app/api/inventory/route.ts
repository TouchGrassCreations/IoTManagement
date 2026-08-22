import { INVENTORY_CATEGORIES } from "../../../lib/identification/validation.ts";
import type { CreateInventoryInput, InventoryItem } from "../../../lib/inventory/types.ts";

type Dependencies = { list: () => Promise<InventoryItem[]> };
type CreateDependencies = { create: (input: CreateInventoryInput) => Promise<InventoryItem> };

export async function handleInventoryList(deps: Dependencies): Promise<Response> {
  try {
    return Response.json({ inventory: await deps.list() });
  } catch (error) {
    console.error("Inventory list failed", error);
    return Response.json({ error: "Inventory is temporarily unavailable." }, { status: 500 });
  }
}

export async function handleInventoryCreate(request: Request, deps: CreateDependencies): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new Error("Invalid inventory item.");
    const { name, category, quantity, location } = body as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) throw new Error("Component name must be between 2 and 120 characters.");
    if (typeof category !== "string" || !INVENTORY_CATEGORIES.includes(category as typeof INVENTORY_CATEGORIES[number])) throw new Error("Choose a valid component category.");
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 9999) throw new Error("Quantity must be a whole number between 1 and 9999.");
    if (typeof location !== "string" || location.trim().length > 120) throw new Error("Location must be 120 characters or fewer.");
    return Response.json({ item: await deps.create({ name: name.trim(), category, quantity: quantity as number, location: location.trim() || "Unsorted" }) }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && /must|valid|Choose/.test(error.message))) return Response.json({ error: error instanceof Error ? error.message : "Invalid inventory item." }, { status: 400 });
    console.error("Inventory creation failed", error);
    return Response.json({ error: "The component could not be added. Please retry." }, { status: 500 });
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

export async function POST(request: Request): Promise<Response> {
  const [{ env }, { createInventoryItem }] = await Promise.all([
    import("cloudflare:workers"),
    import("../../../lib/inventory/persistence.ts"),
  ]);
  const bindings = env as unknown as { DB: import("../../../lib/identification/persistence.ts").D1Like };
  return handleInventoryCreate(request, { create: (input) => createInventoryItem(input, bindings.DB) });
}
