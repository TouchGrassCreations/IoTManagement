import type { ConfirmRequest, InventoryResult, ReviewItem } from "./types.ts";
import { normalizeIdentity, partCode } from "./validation.ts";
import { verifyConfirmationToken } from "./tokens.ts";

type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
};

export type D1Like = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
};

export type ConfirmResult = { scanId: string; inventory: InventoryResult[] };
export type ConfirmOptions = { ownerId: string; secret?: string; model?: string };

const DEFAULT_PROVIDER_MODEL = "gemini-3.1-flash-lite";
const UNKNOWN_MODEL_KEY = "__unknown__";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadScan(scanId: string, ownerId: string, db: D1Like): Promise<ConfirmResult> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT p.id,p.name,p.model,p.category,p.quantity,p.location,p.description,p.tags,p.image
       FROM inventory_parts p
       JOIN identification_events e ON e.inventory_part_id = p.id
       WHERE e.scan_id = ? AND e.owner_id = ? AND p.owner_id = ?`,
    )
    .bind(scanId, ownerId, ownerId)
    .all<Omit<InventoryResult, "tags"> & { tags: string }>();

  return {
    scanId,
    inventory: rows.results.map((row) => ({ ...row, tags: JSON.parse(row.tags) as string[] })),
  };
}

function modelKeyFor(model: string | null): string {
  return model ? normalizeIdentity(model) : UNKNOWN_MODEL_KEY;
}

function wasEdited(item: ReviewItem, normalizedName: string): boolean {
  if (item.source !== "gemini") return false;
  const nameChanged = normalizeIdentity(item.detectedName || "") !== normalizedName;
  const modelChanged = normalizeIdentity(item.detectedModel || "") !== normalizeIdentity(item.model || "");
  return nameChanged || modelChanged;
}

/**
 * Adds each confirmed part to the project its review row chose, creating a
 * project the model proposed only once the part that inspired it is saved. A
 * project deleted mid-review must not fail the whole confirmation, so a failure
 * here is swallowed after the inventory is already written.
 */
async function fileIntoProjects(items: ReviewItem[], ownerId: string, db: D1Like): Promise<void> {
  const chosen = items.filter((item) => item.projectId || item.newProjectName);
  if (chosen.length === 0) return;

  const { appendProjectRequirements, ensureProjectNamed } = await import("../projects/persistence.ts");
  for (const item of chosen) {
    try {
      const projectId = item.newProjectName
        ? await ensureProjectNamed(item.newProjectName, item.projectReason ?? "", ownerId, db)
        : item.projectId!;
      await appendProjectRequirements(
        projectId,
        [{
          name: item.name,
          model: item.model,
          category: item.category,
          quantityRequired: item.quantity,
          matchMode: "identity",
          note: null,
        }],
        ownerId,
        db,
      );
    } catch (error) {
      console.error("Filing a confirmed part into its project failed", error);
    }
  }
}

/**
 * The confirmation token is owner-agnostic, so a replay by a second owner is
 * refused here rather than colliding on the globally unique token hash.
 */
export async function confirmIdentification(
  input: ConfirmRequest,
  db: D1Like,
  options: ConfirmOptions,
): Promise<ConfirmResult> {
  await verifyConfirmationToken(input.token, options.secret);
  const tokenHash = await sha256Hex(input.token);

  const prior = await db
    .prepare("SELECT id,owner_id FROM identification_scans WHERE confirmation_token_hash = ?")
    .bind(tokenHash)
    .first<{ id: string; owner_id: string }>();
  if (prior) {
    if (prior.owner_id !== options.ownerId) throw new Error("Invalid confirmation token");
    return loadScan(prior.id, options.ownerId, db);
  }

  const accepted = input.items.filter((item) => item.accepted);
  const scanId = crypto.randomUUID();
  const providerModel = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_PROVIDER_MODEL;

  const statements: Statement[] = [
    db
      .prepare(
        `INSERT INTO identification_scans
           (id,owner_id,confirmation_token_hash,user_id,provider,provider_model,accepted_detection_count)
         VALUES (?,?,?,?,'gemini',?,?)`,
      )
      .bind(scanId, options.ownerId, tokenHash, options.ownerId, providerModel, accepted.length),
  ];

  for (const item of accepted) {
    const normalizedName = normalizeIdentity(item.name);
    const modelKey = modelKeyFor(item.model);

    statements.push(
      db
        .prepare(
          `INSERT INTO inventory_parts
             (id,owner_id,name,normalized_name,model,model_key,category,quantity,location,code,description,tags,image)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(owner_id,normalized_name,model_key) DO UPDATE SET
             quantity = quantity + excluded.quantity,
             name = excluded.name,
             category = excluded.category,
             location = COALESCE(NULLIF(excluded.location,'Unsorted'),inventory_parts.location),
             code = COALESCE(NULLIF(excluded.code,'MODEL-UNKNOWN'),inventory_parts.code),
             description = excluded.description,
             tags = excluded.tags,
             image = COALESCE(excluded.image,inventory_parts.image),
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          crypto.randomUUID(),
          options.ownerId,
          item.name,
          normalizedName,
          item.model,
          modelKey,
          item.category,
          item.quantity,
          item.location,
          partCode(item.model),
          item.description,
          JSON.stringify(item.tags),
          item.image,
        ),
    );

    statements.push(
      db
        .prepare(
          `INSERT INTO identification_events
             (id,owner_id,scan_id,inventory_part_id,source,detected_name,detected_model,confirmed_name,
              confirmed_model,quantity_added,confidence,visible_markings,bounding_box,alternatives,
              was_edited,captured_image)
           VALUES (?,?,?,
             (SELECT id FROM inventory_parts WHERE owner_id = ? AND normalized_name = ? AND model_key = ?),
             ?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          options.ownerId,
          scanId,
          options.ownerId,
          normalizedName,
          modelKey,
          item.source,
          item.detectedName,
          item.detectedModel,
          item.name,
          item.model,
          item.quantity,
          item.confidence === null ? null : Math.round(item.confidence * 1000),
          JSON.stringify(item.visibleMarkings),
          item.boundingBox ? JSON.stringify(item.boundingBox) : null,
          JSON.stringify(item.alternatives),
          wasEdited(item, normalizedName) ? 1 : 0,
          item.image ? 1 : 0,
        ),
    );
  }

  await db.batch(statements);
  await fileIntoProjects(accepted, options.ownerId, db);
  return loadScan(scanId, options.ownerId, db);
}
