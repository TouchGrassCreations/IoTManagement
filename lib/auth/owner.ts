/**
 * Every domain row belongs to an owner. The owner is resolved once per request
 * and then carried into the persistence layer, which puts it in the SQL rather
 * than trusting each route to remember the check.
 */

/** Rows that predate multi-tenancy. No request may ever resolve to this. */
export const LEGACY_OWNER_ID = "legacy-shared-cabinet";

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const MAX_OWNER_ID_LENGTH = 200;

export type OwnerEnv = { ANONYMOUS_OWNER_ID?: string };

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
  const authenticated = acceptOwnerId(headers.get(USER_ID_HEADER), "signed-in");
  if (authenticated) return authenticated;

  const configured = acceptOwnerId(env?.ANONYMOUS_OWNER_ID, "configured anonymous");
  if (configured) return configured;

  throw new OwnerRequiredError();
}

/** Display identity for the header, when the platform supplies one. */
export function resolveOwnerLabel(headers: Headers): string | null {
  const email = headers.get(USER_EMAIL_HEADER)?.trim();
  if (email) return email;
  const userId = headers.get(USER_ID_HEADER)?.trim();
  return userId || null;
}
