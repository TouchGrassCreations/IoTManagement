import type { D1Like } from "../identification/persistence.ts";
import type { InventoryItem, RemoveInventoryInput, RemoveInventoryResult } from "./types.ts";

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

export async function removeInventoryQuantity(input: RemoveInventoryInput, db: D1Like): Promise<RemoveInventoryResult> {
  const row = await db.prepare(`SELECT ${selectColumns} FROM inventory_parts WHERE id=?`).bind(input.id).first<InventoryRow>();
  if (!row) throw new InventoryNotFoundError(input.id);
  const current = itemFromRow(row);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > current.quantity || !Number.isInteger(input.expectedCurrentQuantity) || input.expectedCurrentQuantity < 1) throw new InvalidRemovalQuantityError();
  if (current.quantity !== input.expectedCurrentQuantity) throw new InventoryQuantityConflictError(current);

  if (input.quantity === current.quantity) {
    await db.batch([
      db.prepare("DELETE FROM identification_events WHERE inventory_part_id=?").bind(input.id),
      db.prepare("DELETE FROM inventory_adjustment_events WHERE inventory_part_id=?").bind(input.id),
      db.prepare("DELETE FROM inventory_parts WHERE id=? AND quantity=?").bind(input.id, current.quantity),
    ]);
    return { deleted: true, id: input.id };
  }

  const quantity = current.quantity - input.quantity;
  await db.batch([
    db.prepare("UPDATE inventory_parts SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND quantity=?").bind(quantity, input.id, current.quantity),
    db.prepare("INSERT INTO inventory_adjustment_events(id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after) VALUES(?,?,'remove',?,?,?)").bind(crypto.randomUUID(), input.id, current.quantity, input.quantity, quantity),
  ]);
  return { deleted: false, item: { ...current, quantity } };
}
