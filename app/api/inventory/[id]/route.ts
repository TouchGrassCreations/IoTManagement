import { domainErrorResponse, respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import { parseInventoryEdit } from "../../../../lib/inventory/edit.ts";
import { InventoryQuantityConflictError } from "../../../../lib/inventory/persistence.ts";
import type { InventoryItem, UpdateInventoryInput, UpdateInventoryResult } from "../../../../lib/inventory/types.ts";

type Dependencies = {
  get: () => Promise<InventoryItem>;
  update: (input: UpdateInventoryInput) => Promise<UpdateInventoryResult>;
};

export async function handleInventoryRead(deps: Pick<Dependencies, "get">): Promise<Response> {
  return respond("Inventory read", async () => Response.json({ item: await deps.get() }));
}

export async function handleInventoryUpdate(
  request: Request,
  id: string,
  deps: Pick<Dependencies, "update">,
): Promise<Response> {
  try {
    return Response.json(await deps.update(parseInventoryEdit(id, await request.json())));
  } catch (error) {
    const conflict = error instanceof InventoryQuantityConflictError ? { item: error.item } : undefined;
    const mapped = domainErrorResponse(error, conflict);
    if (mapped) return mapped;
    if (error instanceof SyntaxError) return Response.json({ error: "The request body was not valid JSON." }, { status: 400 });
    console.error("Inventory update failed", error);
    return Response.json({ error: "The part could not be updated. Please retry." }, { status: 500 });
  }
}

type RouteParams = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: RouteParams): Promise<Response> {
  return respond("Inventory read", async () => {
    const [{ ownerId, db }, { getInventoryItem }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/inventory/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleInventoryRead({ get: () => getInventoryItem(decodeURIComponent(id), ownerId, db) });
  });
}

export async function PATCH(request: Request, context: RouteParams): Promise<Response> {
  return respond("Inventory update", async () => {
    const [{ ownerId, db }, { updateInventoryItem }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/inventory/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleInventoryUpdate(request, decodeURIComponent(id), {
      update: (input) => updateInventoryItem(input, ownerId, db),
    });
  });
}
