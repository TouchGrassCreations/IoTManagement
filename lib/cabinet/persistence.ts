import type { D1Like } from "../identification/persistence.ts";
import { LEGACY_OWNER_ID } from "../auth/owner.ts";
import type { Cabinet, CabinetVisibility } from "./types.ts";

type CabinetRow = { owner_id: string; label: string | null; visibility: string };

const SELECT = "SELECT owner_id,label,visibility FROM cabinets WHERE owner_id = ?";

export class CabinetNotVisibleError extends Error {
  code = "CABINET_NOT_VISIBLE" as const;
  constructor() {
    super("That cabinet is not available.");
  }
}

function cabinetFromRow(row: CabinetRow): Cabinet {
  return { ownerId: row.owner_id, label: row.label, visibility: row.visibility === "public" ? "public" : "private" };
}

export async function getCabinet(ownerId: string, db: D1Like): Promise<Cabinet | null> {
  // The pre-multi-tenancy rows belong to nobody, so they are never shareable.
  if (ownerId === LEGACY_OWNER_ID) return null;
  const row = await db.prepare(SELECT).bind(ownerId).first<CabinetRow>();
  return row ? cabinetFromRow(row) : null;
}

/** A cabinet row appears the first time its owner asks about sharing. */
export async function ensureCabinet(ownerId: string, label: string | null, db: D1Like): Promise<Cabinet> {
  const existing = await getCabinet(ownerId, db);
  if (existing) return existing;
  await db.batch([
    db
      .prepare("INSERT INTO cabinets (owner_id,label,visibility) VALUES (?,?,'private') ON CONFLICT(owner_id) DO NOTHING")
      .bind(ownerId, label),
  ]);
  return (await getCabinet(ownerId, db)) ?? { ownerId, label, visibility: "private" };
}

export async function setCabinetVisibility(
  ownerId: string,
  visibility: CabinetVisibility,
  label: string | null,
  db: D1Like,
): Promise<Cabinet> {
  await ensureCabinet(ownerId, label, db);
  await db
    .batch([
      db
        .prepare("UPDATE cabinets SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?")
        .bind(visibility, ownerId),
    ]);
  return (await getCabinet(ownerId, db)) ?? { ownerId, label, visibility };
}
