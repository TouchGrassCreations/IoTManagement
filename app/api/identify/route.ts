import { recognizeComponents } from "../../../lib/identification/gemini.ts";
import { enforceIdentificationRateLimit } from "../../../lib/identification/rate-limit.ts";
import { issueConfirmationToken } from "../../../lib/identification/tokens.ts";
import { domainErrorResponse, respond } from "../../../lib/http/respond.ts";
import { routeContext } from "../../../lib/http/context.ts";
import type { Detection } from "../../../lib/identification/types.ts";

type Dependencies = {
  recognize: (input: { bytes: Uint8Array; mimeType: string }) => Promise<Detection[]>;
  issueToken: () => Promise<string>;
  /** Required, so the budget cannot be dropped by forgetting to wire it up. */
  enforceRateLimit: () => Promise<void>;
};
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
function hasSignature(bytes: Uint8Array, type: string) {
  if (type === "image/png") return bytes.slice(0, 8).every((b, i) => b === [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a][i]);
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  return type === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

/** Carries the window's reset time in the header a client is expected to honour. */
async function refuseIfOverBudget(deps: Dependencies): Promise<Response | null> {
  try {
    await deps.enforceRateLimit();
    return null;
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (!refusal) throw error;
    const { retryAfterSeconds } = error as { retryAfterSeconds?: number };
    if (retryAfterSeconds) refusal.headers.set("Retry-After", String(retryAfterSeconds));
    return refusal;
  }
}

export async function handleIdentifyRequest(request: Request, deps: Dependencies): Promise<Response> {
  // Charged before the upload is read, so a refused request costs neither
  // bandwidth nor a Gemini call.
  const refusal = await refuseIfOverBudget(deps);
  if (refusal) return refusal;

  try {
    const form = await request.formData(); const image = form.get("image");
    if (!(image instanceof File) || !allowed.has(image.type)) return Response.json({ error: "Choose a JPG, PNG, or WebP image." }, { status: 400 });
    if (image.size > 10 * 1024 * 1024) return Response.json({ error: "Image must be 10 MB or smaller." }, { status: 413 });
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (!hasSignature(bytes, image.type)) return Response.json({ error: "The selected file is not a valid image." }, { status: 400 });
    const detections = await deps.recognize({ bytes, mimeType: image.type });
    const token = await deps.issueToken();
    return Response.json({ detections, token });
  } catch (error) {
    console.error("Identification failed", error);
    if (error instanceof Error && /not configured/.test(error.message)) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ error: "Identification is temporarily unavailable. Please retry." }, { status: 502 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return respond("Identification", async () => {
    const [{ db, ownerId, env }, { listProjectPlans }] = await Promise.all([
      routeContext(request),
      import("../../../lib/projects/persistence.ts"),
    ]);
    return handleIdentifyRequest(request, {
      enforceRateLimit: () => enforceIdentificationRateLimit(ownerId, db, { env }),
      recognize: async (input) => recognizeComponents({
        ...input,
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
        projects: (await listProjectPlans(ownerId, db)).map((plan) => plan.name),
      }),
      issueToken: () => issueConfirmationToken(env.CONFIRMATION_TOKEN_SECRET),
    });
  });
}
