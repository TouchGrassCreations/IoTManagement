import { issueConfirmationToken } from "../../../../lib/identification/tokens.ts";

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

export async function POST(): Promise<Response> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as Record<string, string>;
  return handleIdentifyTokenRequest({ issueToken: () => issueConfirmationToken(bindings.CONFIRMATION_TOKEN_SECRET) });
}
