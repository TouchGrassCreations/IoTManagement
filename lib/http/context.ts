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
 * Bindings come from the Workers runtime where there is one, and from the
 * process environment plus a local SQLite file where there is not, so the same
 * build runs on Cloudflare and in a container.
 *
 * Which runtime this is cannot be asked directly, so it is answered by trying:
 * `cloudflare:workers` resolves on Workers and nowhere else. The answer is
 * cached because the failing import is not worth repeating per request.
 */

/** Node's ESM loader refuses the scheme; a bundler that dropped it says not-found. */
const NO_SUCH_MODULE = new Set(["ERR_UNSUPPORTED_ESM_URL_SCHEME", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

function outsideWorkers(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && NO_SUCH_MODULE.has(code);
}

async function resolveBindings(): Promise<RouteEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as RouteEnv;
  } catch (error) {
    // Anything else is a real failure inside the Workers runtime, and silently
    // falling back to a local file would hide it behind an empty cabinet.
    if (!outsideWorkers(error)) throw error;
  }

  const { nodeBindings } = await import("../db/node.ts");
  return nodeBindings();
}

let bindings: Promise<RouteEnv> | undefined;

function routeBindings(): Promise<RouteEnv> {
  // A failed open must not poison the process: clear the cache so the next
  // request tries again rather than replaying the rejection forever.
  bindings ??= resolveBindings().catch((error: unknown) => {
    bindings = undefined;
    throw error;
  });
  return bindings;
}

/**
 * Resolves bindings and the request's owner in one place. Throws
 * `OwnerRequiredError` when there is no owner, which `respond` maps to a 401
 * before any query runs.
 */
export async function routeContext(request: Request): Promise<RouteContext> {
  const env = await routeBindings();
  return { db: env.DB, ownerId: resolveOwnerId(request.headers, env), env };
}

/** Bindings without an owner, for endpoints that mint tokens before any write. */
export async function routeEnv(): Promise<RouteEnv> {
  return routeBindings();
}
