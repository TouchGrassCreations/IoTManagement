import { domainErrorResponse, respond } from "../../../../../lib/http/respond.ts";
import { routeContext } from "../../../../../lib/http/context.ts";
import { InvalidRemovalQuantityError, InventoryQuantityConflictError } from "../../../../../lib/inventory/persistence.ts";
import type { RemoveInventoryInput, RemoveInventoryResult } from "../../../../../lib/inventory/types.ts";

type Dependencies = { remove: (input: RemoveInventoryInput) => Promise<RemoveInventoryResult> };

export async function handleInventoryRemoval(request: Request, id: string, deps: Dependencies): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new InvalidRemovalQuantityError();
    const { quantity, expectedCurrentQuantity } = body as Record<string, unknown>;
    if (!Number.isInteger(quantity) || !Number.isInteger(expectedCurrentQuantity)) throw new InvalidRemovalQuantityError();
    return Response.json(
      await deps.remove({ id, quantity: quantity as number, expectedCurrentQuantity: expectedCurrentQuantity as number }),
    );
  } catch (error) {
    const conflict = error instanceof InventoryQuantityConflictError ? { item: error.item } : undefined;
    const mapped = domainErrorResponse(error, conflict);
    if (mapped) return mapped;
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400 });
    console.error("Inventory removal failed", error);
    return Response.json({ error: "The component could not be removed. Please retry." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }): Promise<Response> {
  return respond("Inventory removal", async () => {
    const [{ ownerId, db }, { removeInventoryQuantity }] = await Promise.all([
      routeContext(request),
      import("../../../../../lib/inventory/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleInventoryRemoval(request, decodeURIComponent(id), {
      remove: (input) => removeInventoryQuantity(input, ownerId, db),
    });
  });
}
