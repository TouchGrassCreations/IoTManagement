import { respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import { parseProjectIds } from "../../../../lib/projects/validation.ts";
import type { ShoppingList } from "../../../../lib/projects/types.ts";

type Dependencies = { build: (ids: string[] | null) => Promise<ShoppingList> };

export async function handleShoppingList(request: Request, deps: Dependencies): Promise<Response> {
  return respond("Shopping list", async () =>
    Response.json(await deps.build(parseProjectIds(new URL(request.url)))),
  );
}

export async function GET(request: Request): Promise<Response> {
  return respond("Shopping list", async () => {
    const [{ ownerId, db }, { projectShoppingList }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/projects/persistence.ts"),
    ]);
    return handleShoppingList(request, { build: (ids) => projectShoppingList(ownerId, ids, db) });
  });
}
