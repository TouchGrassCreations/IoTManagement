import { LEGACY_OWNER_ID, OwnerRequiredError } from "../auth/owner.ts";
import { CabinetNotVisibleError } from "./persistence.ts";
import type { Cabinet } from "./types.ts";

export type ReadScope = { ownerId: string; canEdit: boolean };

export type ReadScopeInput = {
  /** The `?owner=` parameter, when the request named a cabinet. */
  target: string | null;
  /** The signed-in visitor, or null when nobody is. */
  viewerId: string | null;
  loadCabinet: (ownerId: string) => Promise<Cabinet | null>;
};

/**
 * Decides which cabinet a read may see: your own always, someone else's only
 * while they keep it public, and nothing at all without either. Kept free of
 * bindings so the rule is testable on its own.
 */
export async function resolveReadScope({ target, viewerId, loadCabinet }: ReadScopeInput): Promise<ReadScope> {
  const named = target?.trim() || null;

  if (!named || named === viewerId) {
    if (!viewerId) throw new OwnerRequiredError();
    return { ownerId: viewerId, canEdit: true };
  }

  // Unclaimed pre-multi-tenancy rows have no owner to share them.
  if (named === LEGACY_OWNER_ID) throw new CabinetNotVisibleError();
  const cabinet = await loadCabinet(named);
  if (!cabinet || cabinet.visibility !== "public") throw new CabinetNotVisibleError();
  return { ownerId: named, canEdit: false };
}
