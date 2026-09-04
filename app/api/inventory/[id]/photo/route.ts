import { validatePartImage } from "../../../../../lib/identification/image.ts";
import { respond, domainErrorResponse } from "../../../../../lib/http/respond.ts";
import { routeContext } from "../../../../../lib/http/context.ts";
import type { InventoryItem, SetInventoryImageInput } from "../../../../../lib/inventory/types.ts";

type ReadDependencies = { readImage: () => Promise<{ image: string | null; updatedAt: string }> };
type WriteDependencies = { setImage: (input: SetInventoryImageInput) => Promise<InventoryItem> };

function bytesFromDataUrl(dataUrl: string): { bytes: Uint8Array<ArrayBuffer>; contentType: string } {
  const [header, payload = ""] = dataUrl.split(",");
  const contentType = header.slice("data:".length).replace(";base64", "") || "application/octet-stream";
  const binary = atob(payload);
  // Backed by a plain ArrayBuffer so the view is usable directly as a body.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, contentType };
}

/**
 * Serves the stored crop as real bytes so the list payload does not have to
 * carry base64 for every part. A caller that passes the part's `updatedAt` as
 * `v` gets an immutable response; without it the browser revalidates by ETag.
 */
export async function handleInventoryPhotoRead(request: Request, deps: ReadDependencies): Promise<Response> {
  return respond("Inventory photo read", async () => {
    const { image, updatedAt } = await deps.readImage();
    if (!image) return Response.json({ error: "This part has no photo." }, { status: 404 });

    const etag = `"${updatedAt}"`;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });

    const versioned = new URL(request.url).searchParams.get("v") === updatedAt;
    const { bytes, contentType } = bytesFromDataUrl(image);
    return new Response(bytes, {
      headers: {
        "content-type": contentType,
        etag,
        "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
      },
    });
  });
}

export async function handleInventoryPhoto(request: Request, id: string, deps: WriteDependencies): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new SyntaxError("Invalid photo payload.");
    const image = validatePartImage((body as Record<string, unknown>).image);
    return Response.json({ item: await deps.setImage({ id, image }) });
  } catch (error) {
    const mapped = domainErrorResponse(error);
    if (mapped) return mapped;
    if (error instanceof SyntaxError || (error instanceof Error && /Photo/.test(error.message))) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid photo." }, { status: 400 });
    }
    console.error("Inventory photo update failed", error);
    return Response.json({ error: "The photo could not be saved. Please retry." }, { status: 500 });
  }
}

type RouteParams = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: RouteParams): Promise<Response> {
  return respond("Inventory photo read", async () => {
    const [{ ownerId, db }, { getInventoryPartImage }] = await Promise.all([
      routeContext(request),
      import("../../../../../lib/inventory/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleInventoryPhotoRead(request, {
      readImage: () => getInventoryPartImage(decodeURIComponent(id), ownerId, db),
    });
  });
}

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  return respond("Inventory photo update", async () => {
    const [{ ownerId, db }, { setInventoryPartImage }] = await Promise.all([
      routeContext(request),
      import("../../../../../lib/inventory/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleInventoryPhoto(request, decodeURIComponent(id), {
      setImage: (input) => setInventoryPartImage(input, ownerId, db),
    });
  });
}
