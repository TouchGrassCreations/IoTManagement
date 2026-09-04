export const CABINET_VISIBILITIES = ["private", "public"] as const;
export type CabinetVisibility = (typeof CABINET_VISIBILITIES)[number];

export type Cabinet = {
  ownerId: string;
  label: string | null;
  visibility: CabinetVisibility;
};

export type CabinetAccess = { canView: boolean; canEdit: boolean };

export function isCabinetVisibility(value: unknown): value is CabinetVisibility {
  return typeof value === "string" && (CABINET_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * Only the owner ever edits. Everyone else sees a cabinet exactly while its
 * owner keeps it public, so revoking sharing closes the link immediately.
 */
export function accessFor(cabinet: Pick<Cabinet, "ownerId" | "visibility"> | null, viewerId: string | null): CabinetAccess {
  if (!cabinet) return { canView: false, canEdit: false };
  const canEdit = viewerId !== null && viewerId === cabinet.ownerId;
  return { canView: canEdit || cabinet.visibility === "public", canEdit };
}
