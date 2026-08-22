import {
  InvalidRemovalQuantityError,
  InventoryNotFoundError,
  InventoryQuantityConflictError,
} from "../../../../../lib/inventory/persistence.ts";
import type { RemoveInventoryInput, RemoveInventoryResult } from "../../../../../lib/inventory/types.ts";

type Dependencies = { remove: (input: RemoveInventoryInput) => Promise<RemoveInventoryResult> };

export async function handleInventoryRemoval(request: Request, id: string, deps: Dependencies): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new InvalidRemovalQuantityError();
    const { quantity, expectedCurrentQuantity } = body as Record<string, unknown>;
    if (!Number.isInteger(quantity) || !Number.isInteger(expectedCurrentQuantity)) throw new InvalidRemovalQuantityError();
    const result = await deps.remove({ id, quantity: quantity as number, expectedCurrentQuantity: expectedCurrentQuantity as number });
    return Response.json(result);
  } catch (error) {
    if (error instanceof InventoryQuantityConflictError) return Response.json({ error: error.message, item: error.item }, { status: 409 });
    if (error instanceof InventoryNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof InvalidRemovalQuantityError || error instanceof SyntaxError) return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
    console.error("Inventory removal failed", error);
    return Response.json({ error: "The component could not be removed. Please retry." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }): Promise<Response> {
  const [{ env }, { removeInventoryQuantity }] = await Promise.all([
    import("cloudflare:workers"),
    import("../../../../../lib/inventory/persistence.ts"),
  ]);
  const bindings = env as unknown as { DB: import("../../../../../lib/identification/persistence.ts").D1Like };
  const { id } = await context.params;
  return handleInventoryRemoval(request, decodeURIComponent(id), { remove: (input) => removeInventoryQuantity(input, bindings.DB) });
}
