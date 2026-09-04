import { respond } from "../../../lib/http/respond.ts";
import { readContext, routeContext } from "../../../lib/http/context.ts";
import { parseProjectCreate } from "../../../lib/projects/validation.ts";
import type { CreateProjectInput, ProjectPlan } from "../../../lib/projects/types.ts";

type Dependencies = {
  list: () => Promise<ProjectPlan[]>;
  create: (input: CreateProjectInput) => Promise<ProjectPlan>;
};

export async function handleProjectList(deps: Pick<Dependencies, "list">): Promise<Response> {
  return respond("Project list", async () => Response.json({ projects: await deps.list() }));
}

export async function handleProjectCreate(request: Request, deps: Pick<Dependencies, "create">): Promise<Response> {
  return respond("Project create", async () => {
    const project = await deps.create(parseProjectCreate(await request.json()));
    return Response.json({ project }, { status: 201 });
  });
}

export async function GET(request: Request): Promise<Response> {
  return respond("Project list", async () => {
    const [{ ownerId, db }, { listProjectPlans }] = await Promise.all([
      readContext(request),
      import("../../../lib/projects/persistence.ts"),
    ]);
    return handleProjectList({ list: () => listProjectPlans(ownerId, db) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return respond("Project create", async () => {
    const [{ ownerId, db }, { createProject }] = await Promise.all([
      routeContext(request),
      import("../../../lib/projects/persistence.ts"),
    ]);
    return handleProjectCreate(request, { create: (input) => createProject(input, ownerId, db) });
  });
}
