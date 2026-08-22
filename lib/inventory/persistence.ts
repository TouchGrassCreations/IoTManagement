import type { D1Like } from "../identification/persistence.ts";
import { normalizeIdentity } from "../identification/validation.ts";
import type { CreateInventoryInput, InventoryItem, RemoveInventoryInput, RemoveInventoryResult } from "./types.ts";

type InventoryRow = Omit<InventoryItem, "tags"> & { tags: string };

export class InventoryNotFoundError extends Error {
  code = "INVENTORY_NOT_FOUND" as const;
  id: string;
  constructor(id: string) { super("Inventory item was not found."); this.id = id; }
}

export class InventoryQuantityConflictError extends Error {
  code = "STALE_QUANTITY" as const;
  item: InventoryItem;
  constructor(item: InventoryItem) { super("Inventory quantity changed."); this.item = item; }
}

export class InvalidRemovalQuantityError extends Error {
  code = "INVALID_REMOVAL_QUANTITY" as const;
  constructor() { super("Quantity to remove must be a positive whole number no greater than current stock."); }
}

function itemFromRow(row: InventoryRow): InventoryItem {
  let tags: string[] = [];
  try { const parsed: unknown = JSON.parse(row.tags); if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string"); } catch { /* Preserve usable inventory rows with malformed legacy tags. */ }
  return { ...row, tags };
}

const selectColumns = "id,name,model,category,quantity,location,code,description,tags";

export async function listInventory(db: D1Like): Promise<InventoryItem[]> {
  const rows = await db.prepare(`SELECT ${selectColumns} FROM inventory_parts ORDER BY name COLLATE NOCASE`).bind().all<InventoryRow>();
  return rows.results.map(itemFromRow);
}

export async function createInventoryItem(input: CreateInventoryInput, db: D1Like): Promise<InventoryItem> {
  const normalizedName = normalizeIdentity(input.name);
  const id = crypto.randomUUID();
  await db.batch([db.prepare("INSERT INTO inventory_parts(id,name,normalized_name,model,model_key,category,quantity,location,code,description,tags) VALUES(?,?,?,NULL,'__unknown__',?,?,?,'MODEL-UNKNOWN','','[]') ON CONFLICT(normalized_name,model_key) DO UPDATE SET quantity=quantity+excluded.quantity,category=excluded.category,location=excluded.location,updated_at=CURRENT_TIMESTAMP").bind(id, input.name, normalizedName, input.category, input.quantity, input.location)]);
  const row = await db.prepare(`SELECT ${selectColumns} FROM inventory_parts WHERE normalized_name=? AND model_key='__unknown__'`).bind(normalizedName).first<InventoryRow>();
  if (!row) throw new Error("Created inventory item could not be loaded.");
  return itemFromRow(row);
}

function changed(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("meta" in result)) return true;
  const meta = (result as { meta?: { changes?: number } }).meta;
  return typeof meta?.changes !== "number" || meta.changes > 0;
}

async function throwLatestConflict(id: string, db: D1Like): Promise<never> {
  const latest = await db.prepare(`SELECT ${selectColumns} FROM inventory_parts WHERE id=?`).bind(id).first<InventoryRow>();
  if (!latest) throw new InventoryNotFoundError(id);
  throw new InventoryQuantityConflictError(itemFromRow(latest));
}

export async function removeInventoryQuantity(input: RemoveInventoryInput, db: D1Like): Promise<RemoveInventoryResult> {
  const row = await db.prepare(`SELECT ${selectColumns} FROM inventory_parts WHERE id=?`).bind(input.id).first<InventoryRow>();
  if (!row) throw new InventoryNotFoundError(input.id);
  const current = itemFromRow(row);
  if (current.quantity !== input.expectedCurrentQuantity) throw new InventoryQuantityConflictError(current);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > current.quantity || !Number.isInteger(input.expectedCurrentQuantity) || input.expectedCurrentQuantity < 1) throw new InvalidRemovalQuantityError();

  if (input.quantity === current.quantity) {
    const results = await db.batch([
      db.prepare("DELETE FROM identification_events WHERE inventory_part_id=? AND EXISTS(SELECT 1 FROM inventory_parts WHERE id=? AND quantity=?)").bind(input.id, input.id, current.quantity),
      db.prepare("DELETE FROM inventory_adjustment_events WHERE inventory_part_id=? AND EXISTS(SELECT 1 FROM inventory_parts WHERE id=? AND quantity=?)").bind(input.id, input.id, current.quantity),
      db.prepare("DELETE FROM inventory_parts WHERE id=? AND quantity=?").bind(input.id, current.quantity),
    ]);
    if (!changed(results[2])) return throwLatestConflict(input.id, db);
    return { deleted: true, id: input.id };
  }

  const quantity = current.quantity - input.quantity;
  const results = await db.batch([
    db.prepare("INSERT INTO inventory_adjustment_events(id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after) SELECT ?,?,'quantity_removed',?,?,? WHERE EXISTS(SELECT 1 FROM inventory_parts WHERE id=? AND quantity=?)").bind(crypto.randomUUID(), input.id, current.quantity, input.quantity, quantity, input.id, current.quantity),
    db.prepare("UPDATE inventory_parts SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND quantity=?").bind(quantity, input.id, current.quantity),
  ]);
  if (!changed(results[1])) return throwLatestConflict(input.id, db);
  return { deleted: false, item: { ...current, quantity } };
}
