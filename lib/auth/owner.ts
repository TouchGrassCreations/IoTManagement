/**
 * Every domain row belongs to an owner. The owner is resolved once per request
 * and then carried into the persistence layer, which puts it in the SQL rather
 * than trusting each route to remember the check.
 */

/** Rows that predate multi-tenancy. No request may ever resolve to this. */
export const LEGACY_OWNER_ID = "legacy-shared-cabinet";

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const PROXY_SECRET_HEADER = "x-cabinet-proxy-secret";
const MAX_OWNER_ID_LENGTH = 200;

export type OwnerEnv = { ANONYMOUS_OWNER_ID?: string; TRUSTED_PROXY_SECRET?: string };

/** Compared without short-circuiting, so a wrong secret leaks no position. */
function secretMatches(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * An identity header is worth exactly as much as whatever set it.
 *
 * On the Sites platform the dispatcher is the only thing that can reach the
 * app, so the header is authoritative on arrival. Behind a proxy of your own
 * it is not: the container listens on a port, and anything that can open a
 * socket to it — another container, a laptop on the same LAN, a forwarded port
 * someone forgot — can claim to be anyone. Setting `TRUSTED_PROXY_SECRET` says
 * "only my proxy may assert identity", and the proxy proves it on every
 * request. Left unset, nothing changes.
 */
function identityIsTrusted(headers: Headers, env?: OwnerEnv): boolean {
  const expected = env?.TRUSTED_PROXY_SECRET?.trim();
  if (!expected) return true;
  const supplied = headers.get(PROXY_SECRET_HEADER);
  return !!supplied && secretMatches(supplied, expected);
}

export class OwnerRequiredError extends Error {
  code = "OWNER_REQUIRED" as const;
  constructor(message = "Sign in to open your cabinet.") {
    super(message);
  }
}

function acceptOwnerId(value: string | null | undefined, source: string): string | null {
  const owner = value?.trim();
  if (!owner) return null;
  if (owner.length > MAX_OWNER_ID_LENGTH) throw new OwnerRequiredError(`The ${source} identity is not usable.`);
  // The legacy constant marks unclaimed rows. Resolving to it would hand a
  // visitor the pre-migration cabinet, so it is refused on both paths.
  if (owner === LEGACY_OWNER_ID) throw new OwnerRequiredError(`The ${source} identity is not usable.`);
  return owner;
}

/**
 * Resolution order: the platform's signed-in user, then a configured anonymous
 * owner for local development and deliberately single-user private Sites, then
 * refusal.
 */
export function resolveOwnerId(headers: Headers, env?: OwnerEnv): string {
  // An untrusted identity is not a wrong identity, it is no identity: the
  // request falls through to the anonymous owner or to a refusal, exactly as
  // if the header had never been sent.
  const claimed = identityIsTrusted(headers, env) ? headers.get(USER_ID_HEADER) : null;
  const authenticated = acceptOwnerId(claimed, "signed-in");
  if (authenticated) return authenticated;

  const configured = acceptOwnerId(env?.ANONYMOUS_OWNER_ID, "configured anonymous");
  if (configured) return configured;

  throw new OwnerRequiredError();
}

/** Display identity for the header, when the platform supplies one. */
export function resolveOwnerLabel(headers: Headers, env?: OwnerEnv): string | null {
  // Shown in the page, so an untrusted claim must not be rendered as a name.
  if (!identityIsTrusted(headers, env)) return null;
  const email = headers.get(USER_EMAIL_HEADER)?.trim();
  if (email) return email;
  const userId = headers.get(USER_ID_HEADER)?.trim();
  return userId || null;
}
