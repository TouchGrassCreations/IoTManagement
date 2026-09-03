import type { D1Like } from "../identification/persistence.ts";
import { resolveOwnerId } from "../auth/owner.ts";

export type RouteEnv = {
  DB: D1Like;
  ANONYMOUS_OWNER_ID?: string;
  CONFIRMATION_TOKEN_SECRET?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

export type RouteContext = { db: D1Like; ownerId: string; env: RouteEnv };

/**
 * Resolves bindings and the request's owner in one place. Throws
 * `OwnerRequiredError` when there is no owner, which `respond` maps to a 401
 * before any query runs.
 */
export async function routeContext(request: Request): Promise<RouteContext> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as RouteEnv;
  return { db: bindings.DB, ownerId: resolveOwnerId(request.headers, bindings), env: bindings };
}

/** Bindings without an owner, for endpoints that mint tokens before any write. */
export async function routeEnv(): Promise<RouteEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as RouteEnv;
}
