import { respond } from "../../../../../lib/http/respond.ts";
import { routeContext } from "../../../../../lib/http/context.ts";
import { parseRequirementPayload } from "../../../../../lib/projects/validation.ts";
import type { ProjectPlan, RequirementInput } from "../../../../../lib/projects/types.ts";

type Dependencies = { replace: (requirements: RequirementInput[]) => Promise<ProjectPlan> };

/** The requirement list is replaced wholesale; the editor always sends the whole list. */
export async function handleProjectPartsReplace(request: Request, deps: Dependencies): Promise<Response> {
  return respond("Project requirements", async () => {
    const project = await deps.replace(parseRequirementPayload(await request.json()));
    return Response.json({ project });
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> | { id: string } }): Promise<Response> {
  return respond("Project requirements", async () => {
    const [{ ownerId, db }, { replaceProjectRequirements }] = await Promise.all([
      routeContext(request),
      import("../../../../../lib/projects/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleProjectPartsReplace(request, {
      replace: (requirements) => replaceProjectRequirements(decodeURIComponent(id), requirements, ownerId, db),
    });
  });
}
