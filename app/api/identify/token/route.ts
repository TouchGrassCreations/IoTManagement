import { issueConfirmationToken } from "../../../../lib/identification/tokens.ts";
import { respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";

type Dependencies = { issueToken: () => Promise<string> };

/**
 * Manual entries live in the same review batch as detections, so a workspace
 * opened without a photo still needs a confirmation token to save through.
 */
export async function handleIdentifyTokenRequest(deps: Dependencies): Promise<Response> {
  try {
    return Response.json({ token: await deps.issueToken() });
  } catch (error) {
    console.error("Confirmation token could not be issued", error);
    if (error instanceof Error && /not configured/.test(error.message)) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ error: "Cataloguing is temporarily unavailable. Please retry." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return respond("Confirmation token", async () => {
    const { env } = await routeContext(request);
    return handleIdentifyTokenRequest({ issueToken: () => issueConfirmationToken(env.CONFIRMATION_TOKEN_SECRET) });
  });
}
