import type { D1Like } from "../identification/persistence.ts";
import { normalizeIdentity, partCode } from "../identification/validation.ts";
import { buildInventoryQuery, cursorAfter, type InventoryQuery } from "./query.ts";
import type {
  InventoryItem,
  InventoryPage,
  InventorySummary,
  RemoveInventoryInput,
  RemoveInventoryResult,
  SetInventoryImageInput,
  UpdateInventoryInput,
  UpdateInventoryResult,
} from "./types.ts";

type InventoryRow = {
  id: string;
  name: string;
  model: string | null;
  category: string;
  quantity: number;
  location: string;
  code: string;
  description: string;
  tags: string;
  has_image: number;
  created_at: string;
  updated_at: string;
};

const UNKNOWN_MODEL_KEY = "__unknown__";

/** Never selects `image`; thumbnails are served by their own endpoint. */
const SELECT_COLUMNS =
  "id,name,model,category,quantity,location,code,description,tags,(image IS NOT NULL) AS has_image,created_at,updated_at";

export class InventoryNotFoundError extends Error {
  code = "INVENTORY_NOT_FOUND" as const;
  id: string;
  constructor(id: string) {
    super("Inventory item was not found.");
    this.id = id;
  }
}

export class InventoryQuantityConflictError extends Error {
  code = "STALE_QUANTITY" as const;
  item: InventoryItem;
  constructor(item: InventoryItem) {
    super("Inventory quantity changed.");
    this.item = item;
  }
}

export class InvalidRemovalQuantityError extends Error {
  code = "INVALID_REMOVAL_QUANTITY" as const;
  constructor() {
    super("Quantity to remove must be a positive whole number no greater than current stock.");
  }
}

export class InvalidInventoryEditError extends Error {
  code = "INVALID_PAYLOAD" as const;
  constructor(message: string) {
    super(message);
  }
}

function itemFromRow(row: InventoryRow): InventoryItem {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    /* Preserve usable inventory rows with malformed legacy tags. */
  }
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    category: row.category,
    quantity: row.quantity,
    location: row.location,
    code: row.code,
    description: row.description,
    tags,
    hasImage: Boolean(row.has_image),
    updatedAt: row.updated_at,
  };
}

function changed(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("meta" in result)) return true;
  const meta = (result as { meta?: { changes?: number } }).meta;
  return typeof meta?.changes !== "number" || meta.changes > 0;
}

async function readRow(id: string, ownerId: string, db: D1Like): Promise<InventoryRow | null> {
  return db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM inventory_parts WHERE id = ? AND owner_id = ?`)
    .bind(id, ownerId)
    .first<InventoryRow>();
}

async function requireRow(id: string, ownerId: string, db: D1Like): Promise<InventoryRow> {
  const row = await readRow(id, ownerId, db);
  if (!row) throw new InventoryNotFoundError(id);
  return row;
}

export async function getInventoryItem(id: string, ownerId: string, db: D1Like): Promise<InventoryItem> {
  return itemFromRow(await requireRow(id, ownerId, db));
}

export async function listInventory(ownerId: string, query: InventoryQuery, db: D1Like): Promise<InventoryPage> {
  const { where, order, bindings } = buildInventoryQuery(ownerId, query);
  // One extra row tells us whether another page exists without a second count.
  const rows = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM inventory_parts WHERE ${where} ORDER BY ${order} LIMIT ?`)
    .bind(...bindings, query.limit + 1)
    .all<InventoryRow>();

  const hasMore = rows.results.length > query.limit;
  const page = hasMore ? rows.results.slice(0, query.limit) : rows.results;
  const last = page[page.length - 1];

  return {
    items: page.map(itemFromRow),
    nextCursor: hasMore && last
      ? cursorAfter(query.sort, { id: last.id, name: last.name, createdAt: last.created_at, quantity: last.quantity })
      : null,
  };
}

export async function summarizeInventory(ownerId: string, db: D1Like): Promise<InventorySummary> {
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS types, IFNULL(SUM(quantity),0) AS units,
              IFNULL(SUM(image IS NOT NULL),0) AS photographed
       FROM inventory_parts WHERE owner_id = ?`,
    )
    .bind(ownerId)
    .first<{ types: number; units: number; photographed: number }>();

  const categories = await db
    .prepare("SELECT category, COUNT(*) AS count FROM inventory_parts WHERE owner_id = ? GROUP BY category ORDER BY category")
    .bind(ownerId)
    .all<{ category: string; count: number }>();

  const locations = await db
    .prepare("SELECT location, COUNT(*) AS count FROM inventory_parts WHERE owner_id = ? GROUP BY location ORDER BY location")
    .bind(ownerId)
    .all<{ location: string; count: number }>();

  return {
    totalTypes: totals?.types ?? 0,
    totalUnits: totals?.units ?? 0,
    photographed: totals?.photographed ?? 0,
    categories: categories.results,
    locations: locations.results,
  };
}

/** Returns the stored data URL, or null when the part has no photo. */
export async function getInventoryPartImage(id: string, ownerId: string, db: D1Like): Promise<{ image: string | null; updatedAt: string }> {
  const row = await db
    .prepare("SELECT image, updated_at FROM inventory_parts WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<{ image: string | null; updated_at: string }>();
  if (!row) throw new InventoryNotFoundError(id);
  return { image: row.image, updatedAt: row.updated_at };
}

export async function setInventoryPartImage(
  input: SetInventoryImageInput,
  ownerId: string,
  db: D1Like,
): Promise<InventoryItem> {
  const results = await db.batch([
    db
      .prepare("UPDATE inventory_parts SET image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?")
      .bind(input.image, input.id, ownerId),
  ]);
  if (!changed(results[0])) throw new InventoryNotFoundError(input.id);
  return itemFromRow(await requireRow(input.id, ownerId, db));
}

async function throwLatestConflict(id: string, ownerId: string, db: D1Like): Promise<never> {
  const latest = await readRow(id, ownerId, db);
  if (!latest) throw new InventoryNotFoundError(id);
  throw new InventoryQuantityConflictError(itemFromRow(latest));
}

export async function removeInventoryQuantity(
  input: RemoveInventoryInput,
  ownerId: string,
  db: D1Like,
): Promise<RemoveInventoryResult> {
  const current = itemFromRow(await requireRow(input.id, ownerId, db));
  if (current.quantity !== input.expectedCurrentQuantity) throw new InventoryQuantityConflictError(current);
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > current.quantity ||
    !Number.isInteger(input.expectedCurrentQuantity) ||
    input.expectedCurrentQuantity < 1
  ) {
    throw new InvalidRemovalQuantityError();
  }

  const guard = "EXISTS(SELECT 1 FROM inventory_parts WHERE id = ? AND owner_id = ? AND quantity = ?)";

  if (input.quantity === current.quantity) {
    const results = await db.batch([
      db
        .prepare(`DELETE FROM identification_events WHERE inventory_part_id = ? AND owner_id = ? AND ${guard}`)
        .bind(input.id, ownerId, input.id, ownerId, current.quantity),
      db
        .prepare(`DELETE FROM inventory_adjustment_events WHERE inventory_part_id = ? AND owner_id = ? AND ${guard}`)
        .bind(input.id, ownerId, input.id, ownerId, current.quantity),
      db
        .prepare("DELETE FROM inventory_parts WHERE id = ? AND owner_id = ? AND quantity = ?")
        .bind(input.id, ownerId, current.quantity),
    ]);
    if (!changed(results[2])) return throwLatestConflict(input.id, ownerId, db);
    return { deleted: true, id: input.id };
  }

  const quantity = current.quantity - input.quantity;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_adjustment_events
           (id,owner_id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after)
         SELECT ?,?,?,'quantity_removed',?,?,? WHERE ${guard}`,
      )
      .bind(crypto.randomUUID(), ownerId, input.id, current.quantity, input.quantity, quantity, input.id, ownerId, current.quantity),
    db
      .prepare("UPDATE inventory_parts SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ? AND quantity = ?")
      .bind(quantity, input.id, ownerId, current.quantity),
  ]);
  if (!changed(results[1])) return throwLatestConflict(input.id, ownerId, db);
  return { deleted: false, item: { ...current, quantity } };
}

function modelKeyFor(model: string | null): string {
  return model ? normalizeIdentity(model) : UNKNOWN_MODEL_KEY;
}

/**
 * Applies an edit, folding the row into an existing part when the new name and
 * model land on an identity the owner already holds. Refusing the edit instead
 * would leave a user unable to correct a duplicate that identification created.
 */
export async function updateInventoryItem(
  input: UpdateInventoryInput,
  ownerId: string,
  db: D1Like,
): Promise<UpdateInventoryResult> {
  const row = await requireRow(input.id, ownerId, db);
  const current = itemFromRow(row);
  if (current.quantity !== input.expectedCurrentQuantity) throw new InventoryQuantityConflictError(current);

  const delta = input.quantityDelta ?? 0;
  if (!Number.isInteger(delta)) throw new InvalidInventoryEditError("Stock change must be a whole number.");
  const quantity = current.quantity + delta;
  if (quantity < 1) throw new InvalidInventoryEditError("Stock cannot drop below one — remove the part instead.");
  if (quantity > 999_999) throw new InvalidInventoryEditError("Stock is unrealistically large.");

  const next = {
    name: input.name ?? current.name,
    model: input.model === undefined ? current.model : input.model,
    category: input.category ?? current.category,
    location: input.location ?? current.location,
    description: input.description ?? current.description,
    tags: input.tags ?? current.tags,
  };
  const normalizedName = normalizeIdentity(next.name);
  const modelKey = modelKeyFor(next.model);
  const identityChanged = normalizedName !== normalizeIdentity(current.name) || modelKey !== modelKeyFor(current.model);

  const guard = "id = ? AND owner_id = ? AND quantity = ?";
  const guardBindings = [input.id, ownerId, current.quantity];
  const eventType = delta === 0 ? "details_edited" : "quantity_adjusted";

  if (identityChanged) {
    const conflict = await db
      .prepare("SELECT id, quantity FROM inventory_parts WHERE owner_id = ? AND normalized_name = ? AND model_key = ? AND id <> ?")
      .bind(ownerId, normalizedName, modelKey, input.id)
      .first<{ id: string; quantity: number }>();

    if (conflict) {
      const merged = conflict.quantity + quantity;
      // A merge moves stock between two rows, so it must be all-or-nothing. The
      // first statement only fires while BOTH rows still hold what was read; the
      // rest only fire once it has, so a losing race leaves both rows untouched
      // rather than deleting the source without crediting the target.
      const sourceIntact = "EXISTS(SELECT 1 FROM inventory_parts WHERE id = ? AND owner_id = ? AND quantity = ?)";
      const sourceBindings = [input.id, ownerId, current.quantity];
      const targetMerged = "EXISTS(SELECT 1 FROM inventory_parts WHERE id = ? AND owner_id = ? AND quantity = ?)";
      const targetBindings = [conflict.id, ownerId, merged];

      const results = await db.batch([
        db
          .prepare(
            `UPDATE inventory_parts SET
               quantity = ?, name = ?, model = ?, category = ?, location = ?, code = ?, description = ?, tags = ?,
               image = COALESCE(image,(SELECT image FROM inventory_parts WHERE id = ? AND owner_id = ?)),
               updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND owner_id = ? AND quantity = ? AND ${sourceIntact}`,
          )
          .bind(
            merged, next.name, next.model, next.category, next.location, partCode(next.model), next.description,
            JSON.stringify(next.tags), input.id, ownerId, conflict.id, ownerId, conflict.quantity, ...sourceBindings,
          ),
        db
          .prepare(
            `UPDATE identification_events SET inventory_part_id = ?
             WHERE inventory_part_id = ? AND owner_id = ? AND ${targetMerged}`,
          )
          .bind(conflict.id, input.id, ownerId, ...targetBindings),
        db
          .prepare(
            `UPDATE inventory_adjustment_events SET inventory_part_id = ?
             WHERE inventory_part_id = ? AND owner_id = ? AND ${targetMerged}`,
          )
          .bind(conflict.id, input.id, ownerId, ...targetBindings),
        db
          .prepare(
            `INSERT INTO inventory_adjustment_events
               (id,owner_id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after)
             SELECT ?,?,?,'merged_into',?,0,? WHERE ${targetMerged}`,
          )
          .bind(crypto.randomUUID(), ownerId, conflict.id, conflict.quantity, merged, ...targetBindings),
        db
          .prepare(`DELETE FROM inventory_parts WHERE ${guard} AND ${targetMerged}`)
          .bind(...guardBindings, ...targetBindings),
      ]);
      if (!changed(results[0]) || !changed(results[4])) return throwLatestConflict(input.id, ownerId, db);
      return { item: itemFromRow(await requireRow(conflict.id, ownerId, db)), mergedFromId: input.id };
    }
  }

  const results = await db.batch([
    db
      .prepare(
        `UPDATE inventory_parts SET
           name = ?, normalized_name = ?, model = ?, model_key = ?, category = ?, quantity = ?, location = ?,
           code = ?, description = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
         WHERE ${guard}`,
      )
      .bind(
        next.name, normalizedName, next.model, modelKey, next.category, quantity, next.location,
        partCode(next.model), next.description, JSON.stringify(next.tags), ...guardBindings,
      ),
    db
      .prepare(
        `INSERT INTO inventory_adjustment_events
           (id,owner_id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(), ownerId, input.id, eventType, current.quantity,
        Math.max(0, current.quantity - quantity), quantity,
      ),
  ]);
  if (!changed(results[0])) return throwLatestConflict(input.id, ownerId, db);
  return { item: itemFromRow(await requireRow(input.id, ownerId, db)), mergedFromId: null };
}
