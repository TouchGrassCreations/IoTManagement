import { respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import { parseProjectUpdate } from "../../../../lib/projects/validation.ts";
import type { ProjectPlan, UpdateProjectInput } from "../../../../lib/projects/types.ts";

type Dependencies = {
  get: () => Promise<ProjectPlan>;
  update: (changes: UpdateProjectInput) => Promise<ProjectPlan>;
  remove: () => Promise<{ deleted: true; id: string }>;
};

export async function handleProjectRead(deps: Pick<Dependencies, "get">): Promise<Response> {
  return respond("Project read", async () => Response.json({ project: await deps.get() }));
}

export async function handleProjectUpdate(request: Request, deps: Pick<Dependencies, "update">): Promise<Response> {
  return respond("Project update", async () => {
    const project = await deps.update(parseProjectUpdate(await request.json()));
    return Response.json({ project });
  });
}

export async function handleProjectDelete(deps: Pick<Dependencies, "remove">): Promise<Response> {
  return respond("Project delete", async () => Response.json(await deps.remove()));
}

type RouteParams = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: RouteParams): Promise<Response> {
  return respond("Project read", async () => {
    const [{ ownerId, db }, { getProjectPlan }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/projects/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleProjectRead({ get: () => getProjectPlan(decodeURIComponent(id), ownerId, db) });
  });
}

export async function PATCH(request: Request, context: RouteParams): Promise<Response> {
  return respond("Project update", async () => {
    const [{ ownerId, db }, { updateProject }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/projects/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleProjectUpdate(request, { update: (changes) => updateProject(decodeURIComponent(id), changes, ownerId, db) });
  });
}

export async function DELETE(request: Request, context: RouteParams): Promise<Response> {
  return respond("Project delete", async () => {
    const [{ ownerId, db }, { deleteProject }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/projects/persistence.ts"),
    ]);
    const { id } = await context.params;
    return handleProjectDelete({ remove: () => deleteProject(decodeURIComponent(id), ownerId, db) });
  });
}
