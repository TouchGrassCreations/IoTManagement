import { respond } from "../../../lib/http/respond.ts";
import { routeContext } from "../../../lib/http/context.ts";
import { resolveOwnerLabel } from "../../../lib/auth/owner.ts";
import { isCabinetVisibility, type Cabinet } from "../../../lib/cabinet/types.ts";

type Dependencies = { load: () => Promise<Cabinet>; save: (visibility: Cabinet["visibility"]) => Promise<Cabinet> };

export async function handleCabinetRead(deps: Pick<Dependencies, "load">): Promise<Response> {
  return respond("Cabinet read", async () => Response.json({ cabinet: await deps.load() }));
}

export async function handleCabinetUpdate(request: Request, deps: Pick<Dependencies, "save">): Promise<Response> {
  return respond("Cabinet update", async () => {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isCabinetVisibility(body.visibility)) {
      return Response.json({ error: "Choose whether the cabinet is private or shared." }, { status: 400 });
    }
    return Response.json({ cabinet: await deps.save(body.visibility) });
  });
}

export async function GET(request: Request): Promise<Response> {
  return respond("Cabinet read", async () => {
    const [{ ownerId, db }, { ensureCabinet }] = await Promise.all([
      routeContext(request),
      import("../../../lib/cabinet/persistence.ts"),
    ]);
    return handleCabinetRead({ load: () => ensureCabinet(ownerId, resolveOwnerLabel(request.headers), db) });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return respond("Cabinet update", async () => {
    const [{ ownerId, db }, { setCabinetVisibility }] = await Promise.all([
      routeContext(request),
      import("../../../lib/cabinet/persistence.ts"),
    ]);
    return handleCabinetUpdate(request, {
      save: (visibility) => setCabinetVisibility(ownerId, visibility, resolveOwnerLabel(request.headers), db),
    });
  });
}
