import { validatePartImage } from "../../../../../lib/identification/image.ts";
import { InventoryNotFoundError } from "../../../../../lib/inventory/persistence.ts";
import type { InventoryItem, SetInventoryImageInput } from "../../../../../lib/inventory/types.ts";

type Dependencies = { setImage: (input: SetInventoryImageInput) => Promise<InventoryItem> };

export async function handleInventoryPhoto(request: Request, id: string, deps: Dependencies): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new SyntaxError("Invalid photo payload.");
    const image = validatePartImage((body as Record<string, unknown>).image);
    return Response.json({ item: await deps.setImage({ id, image }) });
  } catch (error) {
    if (error instanceof InventoryNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof SyntaxError || (error instanceof Error && /Photo/.test(error.message))) return Response.json({ error: error instanceof Error ? error.message : "Invalid photo." }, { status: 400 });
    console.error("Inventory photo update failed", error);
    return Response.json({ error: "The photo could not be saved. Please retry." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }): Promise<Response> {
  const [{ env }, { setInventoryPartImage }] = await Promise.all([
    import("cloudflare:workers"),
    import("../../../../../lib/inventory/persistence.ts"),
  ]);
  const bindings = env as unknown as { DB: import("../../../../../lib/identification/persistence.ts").D1Like };
  const { id } = await context.params;
  return handleInventoryPhoto(request, decodeURIComponent(id), { setImage: (input) => setInventoryPartImage(input, bindings.DB) });
}
