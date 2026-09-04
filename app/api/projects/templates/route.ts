import { respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import type { TemplateSeedResult } from "../../../../lib/projects/types.ts";

type Dependencies = { seed: () => Promise<TemplateSeedResult> };

export async function handleTemplateSeed(deps: Dependencies): Promise<Response> {
  return respond("Template seeding", async () => Response.json(await deps.seed()));
}

export async function POST(request: Request): Promise<Response> {
  return respond("Template seeding", async () => {
    const [{ ownerId, db }, { seedProjectTemplates }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/projects/templates.ts"),
    ]);
    return handleTemplateSeed({ seed: () => seedProjectTemplates(ownerId, db) });
  });
}
