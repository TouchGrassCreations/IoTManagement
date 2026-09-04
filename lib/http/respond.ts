/**
 * One place that turns a domain error into a status code, so every route
 * reports the same failure the same way. Errors are matched on their `code`
 * field rather than by class, which keeps this module free of imports from
 * every feature that can fail.
 */

const STATUS_BY_CODE: Record<string, number> = {
  OWNER_REQUIRED: 401,
  INVENTORY_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  STALE_QUANTITY: 409,
  DUPLICATE_PROJECT: 409,
  INVALID_REMOVAL_QUANTITY: 400,
  INVALID_PAYLOAD: 400,
  RATE_LIMITED: 429,
};

export type DomainError = Error & { code?: string; [key: string]: unknown };

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code in STATUS_BY_CODE ? code : null;
}

export function statusForError(error: unknown): number | null {
  const code = codeOf(error);
  return code ? STATUS_BY_CODE[code] : null;
}

/**
 * Maps a known domain error to its response, merging any extra payload the
 * error carries (a conflicting item, a retry hint). Returns null when the error
 * is not a domain error, so the caller can log it and return a 500 itself.
 */
export function domainErrorResponse(error: unknown, extra?: Record<string, unknown>): Response | null {
  const status = statusForError(error);
  if (status === null) return null;
  const message = error instanceof Error ? error.message : "Request failed.";
  return Response.json({ error: message, ...extra }, { status });
}

/** Wraps a handler so domain errors map automatically and the rest become 500s. */
export async function respond(context: string, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    const mapped = domainErrorResponse(error);
    if (mapped) return mapped;
    if (error instanceof SyntaxError) return Response.json({ error: "The request body was not valid JSON." }, { status: 400 });
    console.error(`${context} failed`, error);
    return Response.json({ error: "Something went wrong. Please retry." }, { status: 500 });
  }
}
