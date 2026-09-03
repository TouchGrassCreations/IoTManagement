import assert from "node:assert/strict";
import test from "node:test";
import { InvalidInventoryPayloadError, parseInventoryEdit } from "../../lib/inventory/edit.ts";
import {
  InvalidInventoryEditError,
  InventoryNotFoundError,
  InventoryQuantityConflictError,
  updateInventoryItem,
} from "../../lib/inventory/persistence.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

test("an edit payload leaves absent fields untouched", () => {
  const input = parseInventoryEdit("part-1", { expectedCurrentQuantity: 3, name: "  Relay module " });
  assert.deepEqual(input, { id: "part-1", expectedCurrentQuantity: 3, name: "Relay module" });
});

test("an edit payload is validated field by field", () => {
  const reject = (body) => assert.throws(() => parseInventoryEdit("part-1", body), InvalidInventoryPayloadError);
  reject(null);
  reject({});
  reject({ expectedCurrentQuantity: 0 });
  reject({ expectedCurrentQuantity: 1, name: "   " });
  reject({ expectedCurrentQuantity: 1, name: "x".repeat(121) });
  reject({ expectedCurrentQuantity: 1, category: "Not a category" });
  reject({ expectedCurrentQuantity: 1, tags: ["ok", 4] });
  reject({ expectedCurrentQuantity: 1, tags: Array.from({ length: 11 }, () => "tag") });
  reject({ expectedCurrentQuantity: 1, quantityDelta: 1.5 });
  reject({ expectedCurrentQuantity: 1, description: "x".repeat(501) });
});

test("an empty model clears the model rather than storing a blank string", () => {
  assert.equal(parseInventoryEdit("part-1", { expectedCurrentQuantity: 1, model: "" }).model, null);
  assert.equal(parseInventoryEdit("part-1", { expectedCurrentQuantity: 1, model: null }).model, null);
});

test("editing details rewrites the row and records an audit event", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { name: "Unknown module", quantity: 2 });

  const result = await updateInventoryItem(
    { id: part.id, expectedCurrentQuantity: 2, name: "BMP280", model: "BMP280", category: "Sensors", location: "Bin B7", tags: ["Pressure"] },
    "user-1",
    adapter,
  );

  assert.equal(result.mergedFromId, null);
  assert.equal(result.item.name, "BMP280");
  assert.equal(result.item.code, "BMP280");
  assert.deepEqual(result.item.tags, ["Pressure"]);
  const row = db.prepare("SELECT normalized_name, model_key, location FROM inventory_parts WHERE id = ?").get(part.id);
  assert.equal(row.normalized_name, "bmp280");
  assert.equal(row.model_key, "bmp280");
  assert.equal(row.location, "Bin B7");
  assert.equal(db.prepare("SELECT event_type FROM inventory_adjustment_events").get().event_type, "details_edited");
});

test("a stock delta adjusts quantity and is audited as an adjustment", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 4 });

  const result = await updateInventoryItem({ id: part.id, expectedCurrentQuantity: 4, quantityDelta: 6 }, "user-1", adapter);

  assert.equal(result.item.quantity, 10);
  const audit = db.prepare("SELECT * FROM inventory_adjustment_events").get();
  assert.equal(audit.event_type, "quantity_adjusted");
  assert.equal(audit.quantity_before, 4);
  assert.equal(audit.quantity_after, 10);
});

test("stock cannot be edited below one — removal is the way out", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 2 });
  await assert.rejects(
    updateInventoryItem({ id: part.id, expectedCurrentQuantity: 2, quantityDelta: -2 }, "user-1", adapter),
    InvalidInventoryEditError,
  );
  assert.equal(db.prepare("SELECT quantity FROM inventory_parts WHERE id = ?").get(part.id).quantity, 2);
});

test("renaming onto an existing identity merges the two rows", async () => {
  const { db, adapter } = createDatabase();
  const target = insertPart(db, "user-1", { name: "ESP32-CAM", quantity: 2, image: "data:image/webp;base64,AAAA" });
  const duplicate = insertPart(db, "user-1", { name: "esp 32 cam", quantity: 3 });
  db.prepare(
    `INSERT INTO identification_events
       (id,owner_id,scan_id,inventory_part_id,source,confirmed_name,quantity_added,was_edited)
     VALUES ('event-1','user-1','scan-1',?,'gemini','esp 32 cam',3,0)`,
  ).run(duplicate.id);

  const result = await updateInventoryItem(
    { id: duplicate.id, expectedCurrentQuantity: 3, name: "ESP32-CAM" },
    "user-1",
    adapter,
  );

  assert.equal(result.mergedFromId, duplicate.id);
  assert.equal(result.item.id, target.id);
  assert.equal(result.item.quantity, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts WHERE id = ?").get(duplicate.id).count, 0);
  // History follows the surviving row rather than pointing at a deleted part.
  assert.equal(db.prepare("SELECT inventory_part_id FROM identification_events WHERE id = 'event-1'").get().inventory_part_id, target.id);
  assert.equal(db.prepare("SELECT event_type FROM inventory_adjustment_events").get().event_type, "merged_into");
});

test("a merge keeps the surviving photo and adopts one when it has none", async () => {
  const { db, adapter } = createDatabase();
  const target = insertPart(db, "user-1", { name: "Relay", quantity: 1 });
  const duplicate = insertPart(db, "user-1", { name: "relay module", quantity: 1, image: "data:image/webp;base64,BBBB" });

  await updateInventoryItem({ id: duplicate.id, expectedCurrentQuantity: 1, name: "Relay" }, "user-1", adapter);

  assert.equal(db.prepare("SELECT image FROM inventory_parts WHERE id = ?").get(target.id).image, "data:image/webp;base64,BBBB");
});

test("a stale edit is refused with the current row", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { quantity: 4 });
  await assert.rejects(
    updateInventoryItem({ id: part.id, expectedCurrentQuantity: 9, name: "Renamed" }, "user-1", adapter),
    (error) => error instanceof InventoryQuantityConflictError && error.item.quantity === 4,
  );
});

test("one owner cannot edit another owner's part", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "user-1", { name: "Private", quantity: 1 });
  await assert.rejects(
    updateInventoryItem({ id: part.id, expectedCurrentQuantity: 1, name: "Stolen" }, "intruder", adapter),
    InventoryNotFoundError,
  );
  assert.equal(db.prepare("SELECT name FROM inventory_parts WHERE id = ?").get(part.id).name, "Private");
});

test("a rename never merges across an owner boundary", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-2", { name: "ESP32-CAM", quantity: 7 });
  const mine = insertPart(db, "user-1", { name: "esp 32 cam", quantity: 1 });

  const result = await updateInventoryItem({ id: mine.id, expectedCurrentQuantity: 1, name: "ESP32-CAM" }, "user-1", adapter);

  assert.equal(result.mergedFromId, null);
  assert.equal(result.item.quantity, 1);
  assert.equal(db.prepare("SELECT quantity FROM inventory_parts WHERE owner_id = 'user-2'").get().quantity, 7);
});
