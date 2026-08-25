import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { confirmIdentification } from "../lib/identification/persistence.ts";
import { issueConfirmationToken } from "../lib/identification/tokens.ts";
import { listInventory, setInventoryPartImage } from "../lib/inventory/persistence.ts";

const SECRET = "test-confirmation-secret";
const MIGRATIONS = ["0000_camera_identification.sql", "0001_inventory_category_taxonomy.sql", "0002_inventory_deletion.sql", "0003_inventory_part_photos.sql"];
const photo = (seed) => `data:image/webp;base64,${seed.repeat(40)}`;

/** Runs the production SQL against real SQLite instead of a hand-written double. */
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const file of MIGRATIONS) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
  }
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
  });
  return { db, prepare: (sql) => statement(sql), batch: async (statements) => statements.map((entry) => entry.run()) };
}

function reviewed(overrides) {
  return { id: "row-1", accepted: true, source: "gemini", name: "VL53L0X range finder", model: "VL53L0X", category: "Sensors", quantity: 2, location: "Unsorted", image: null, boundingBox: { top: .1, left: .1, width: .3, height: .2 }, confidence: .9, detectedName: "VL53L0X range finder", detectedModel: "VL53L0X", visibleMarkings: [], alternatives: [], description: "Time-of-flight distance sensor", tags: ["distance"], ...overrides };
}

async function confirm(database, items) {
  return confirmIdentification({ token: await issueConfirmationToken(SECRET), items }, database, { secret: SECRET, model: "gemini-3.1-flash-lite" });
}

test("a confirmed detection stores its crop and reaches the inventory list", async () => {
  const database = d1();
  const result = await confirm(database, [reviewed({ image: photo("A"), location: "Bin B2" })]);
  assert.equal(result.inventory[0].image, photo("A"));
  assert.equal(result.inventory[0].location, "Bin B2");
  assert.equal(database.db.prepare("SELECT code FROM inventory_parts WHERE name=?").get("VL53L0X range finder").code, "VL53L0X");
  const inventory = await listInventory(database);
  assert.equal(inventory.find((part) => part.name === "VL53L0X range finder").image, photo("A"));
  assert.equal(database.db.prepare("SELECT captured_image FROM identification_events").get().captured_image, 1);
});

test("re-scanning a stocked part adds quantity without losing its photo or bin", async () => {
  const database = d1();
  await confirm(database, [reviewed({ image: photo("A"), location: "Bin B2" })]);
  const second = await confirm(database, [reviewed({ id: "row-2", image: null, quantity: 3 })]);
  assert.equal(second.inventory[0].quantity, 5, "quantities accumulate");
  assert.equal(second.inventory[0].image, photo("A"), "an unphotographed rescan keeps the existing crop");
  assert.equal(second.inventory[0].location, "Bin B2", "an unspecified storage location keeps the existing bin");
  assert.equal(database.db.prepare("SELECT code FROM inventory_parts WHERE name=?").get("VL53L0X range finder").code, "VL53L0X", "the card label survives a rescan");
});

test("a fresher crop replaces the stored one", async () => {
  const database = d1();
  await confirm(database, [reviewed({ image: photo("A") })]);
  const second = await confirm(database, [reviewed({ id: "row-2", image: photo("B"), location: "Bin C1" })]);
  assert.equal(second.inventory[0].image, photo("B"));
  assert.equal(second.inventory[0].location, "Bin C1");
});

test("a seeded part accepts a photo added from its card", async () => {
  const database = d1();
  const updated = await setInventoryPartImage({ id: "seed-dht22", image: photo("C") }, database);
  assert.equal(updated.image, photo("C"));
  assert.equal((await listInventory(database)).find((part) => part.id === "seed-dht22").image, photo("C"));
  const cleared = await setInventoryPartImage({ id: "seed-dht22", image: null }, database);
  assert.equal(cleared.image, null);
});
