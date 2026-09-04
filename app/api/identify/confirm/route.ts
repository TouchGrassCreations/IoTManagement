import { validateConfirmationPayload } from "../../../../lib/identification/validation.ts";
import { domainErrorResponse, respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import type { ConfirmRequest, InventoryResult } from "../../../../lib/identification/types.ts";

type Result = { scanId: string; inventory: InventoryResult[] };
type Dependencies = { confirm: (input: ConfirmRequest) => Promise<Result> };

export async function handleConfirmRequest(request: Request, deps: Dependencies): Promise<Response> {
  try {
    return Response.json(await deps.confirm(validateConfirmationPayload(await request.json())));
  } catch (error) {
    const mapped = domainErrorResponse(error);
    if (mapped) return mapped;
    return Response.json({ error: error instanceof Error ? error.message : "Confirmation failed" }, { status: 400 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return respond("Confirmation", async () => {
    const [{ ownerId, db, env }, { confirmIdentification }] = await Promise.all([
      routeContext(request),
      import("../../../../lib/identification/persistence.ts"),
    ]);
    return handleConfirmRequest(request, {
      confirm: (input) =>
        confirmIdentification(input, db, {
          ownerId,
          secret: env.CONFIRMATION_TOKEN_SECRET,
          model: env.GEMINI_MODEL,
        }),
    });
  });
}
