import assert from "node:assert/strict";
import test from "node:test";
import {
  InventoryNotFoundError,
  InventoryQuantityConflictError,
  getInventoryItem,
  removeInventoryQuantity,
  setInventoryPartImage,
} from "../../lib/inventory/persistence.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

function events(db, table = "inventory_adjustment_events") {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

test("partial removal updates quantity and writes one audit event", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 5 });

  const result = await removeInventoryQuantity({ id: part.id, quantity: 2, expectedCurrentQuantity: 5 }, "user-1", adapter);

  assert.equal(result.deleted, false);
  assert.equal(result.item.quantity, 3);
  assert.equal(db.prepare("SELECT quantity FROM inventory_parts WHERE id = ?").get(part.id).quantity, 3);
  const audit = events(db);
  assert.equal(audit.length, 1);
  assert.deepEqual(
    { type: audit[0].event_type, before: audit[0].quantity_before, after: audit[0].quantity_after, owner: audit[0].owner_id },
    { type: "quantity_removed", before: 5, after: 3, owner: "user-1" },
  );
});

test("removing the last unit deletes the part and its audit trail", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 2 });

  const result = await removeInventoryQuantity({ id: part.id, quantity: 2, expectedCurrentQuantity: 2 }, "user-1", adapter);

  assert.deepEqual(result, { deleted: true, id: part.id });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts WHERE id = ?").get(part.id).count, 0);
  assert.equal(events(db).length, 0);
  assert.equal(events(db, "identification_events").length, 0);
});

test("stale quantity throws a typed conflict containing current inventory", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 4 });

  await assert.rejects(
    removeInventoryQuantity({ id: part.id, quantity: 5, expectedCurrentQuantity: 5 }, "user-1", adapter),
    (error) => error instanceof InventoryQuantityConflictError && error.item.quantity === 4,
  );
  assert.equal(db.prepare("SELECT quantity FROM inventory_parts WHERE id = ?").get(part.id).quantity, 4);
});

test("one owner cannot remove, read, or photograph another owner's part", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 4 });

  await assert.rejects(
    removeInventoryQuantity({ id: part.id, quantity: 1, expectedCurrentQuantity: 4 }, "intruder", adapter),
    InventoryNotFoundError,
  );
  await assert.rejects(getInventoryItem(part.id, "intruder", adapter), InventoryNotFoundError);
  await assert.rejects(
    setInventoryPartImage({ id: part.id, image: "data:image/webp;base64,AAAA" }, "intruder", adapter),
    InventoryNotFoundError,
  );
  assert.equal(db.prepare("SELECT quantity FROM inventory_parts WHERE id = ?").get(part.id).quantity, 4);
  assert.equal(db.prepare("SELECT image FROM inventory_parts WHERE id = ?").get(part.id).image, null);
});

test("a conditional mutation race reports the latest stock instead of a false success", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 5 });

  // Slip a competing removal in between the read and the guarded write.
  const racing = {
    ...adapter,
    batch: async (statements) => {
      db.prepare("UPDATE inventory_parts SET quantity = 4 WHERE id = ?").run(part.id);
      return adapter.batch(statements);
    },
  };

  await assert.rejects(
    removeInventoryQuantity({ id: part.id, quantity: 2, expectedCurrentQuantity: 5 }, "user-1", racing),
    (error) => error instanceof InventoryQuantityConflictError && error.item.quantity === 4,
  );
});
