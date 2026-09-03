import assert from "node:assert/strict";
import test from "node:test";
import { confirmIdentification } from "../../lib/identification/persistence.ts";
import { issueConfirmationToken } from "../../lib/identification/tokens.ts";
import { getInventoryPartImage, listInventory, setInventoryPartImage } from "../../lib/inventory/persistence.ts";
import { parseInventoryQuery } from "../../lib/inventory/query.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

const SECRET = "test-confirmation-secret";
const OWNER = "user-1";
const photo = (seed) => `data:image/webp;base64,${seed.repeat(40)}`;
const listQuery = () => parseInventoryQuery(new URL("http://test/api/inventory"));

function reviewed(overrides) {
  return {
    id: "row-1",
    accepted: true,
    source: "gemini",
    name: "VL53L0X range finder",
    model: "VL53L0X",
    category: "Sensors",
    quantity: 2,
    location: "Unsorted",
    image: null,
    boundingBox: { top: 0.1, left: 0.1, width: 0.3, height: 0.2 },
    confidence: 0.9,
    detectedName: "VL53L0X range finder",
    detectedModel: "VL53L0X",
    visibleMarkings: [],
    alternatives: [],
    description: "Time-of-flight distance sensor",
    tags: ["distance"],
    ...overrides,
  };
}

async function confirm(adapter, items, ownerId = OWNER) {
  return confirmIdentification({ token: await issueConfirmationToken(SECRET), items }, adapter, {
    ownerId,
    secret: SECRET,
    model: "gemini-3.1-flash-lite",
  });
}

test("a confirmed detection stores its crop and reaches the inventory list", async () => {
  const { db, adapter } = createDatabase();
  const result = await confirm(adapter, [reviewed({ image: photo("A"), location: "Bin B2" })]);

  assert.equal(result.inventory[0].image, photo("A"));
  assert.equal(result.inventory[0].location, "Bin B2");
  assert.equal(db.prepare("SELECT code FROM inventory_parts WHERE name = ?").get("VL53L0X range finder").code, "VL53L0X");
  assert.equal(db.prepare("SELECT owner_id FROM inventory_parts WHERE name = ?").get("VL53L0X range finder").owner_id, OWNER);

  const page = await listInventory(OWNER, listQuery(), adapter);
  const listed = page.items.find((part) => part.name === "VL53L0X range finder");
  assert.equal(listed.hasImage, true);
  assert.equal((await getInventoryPartImage(listed.id, OWNER, adapter)).image, photo("A"));
  assert.equal(db.prepare("SELECT captured_image FROM identification_events").get().captured_image, 1);
});

test("re-scanning a stocked part adds quantity without losing its photo or bin", async () => {
  const { db, adapter } = createDatabase();
  await confirm(adapter, [reviewed({ image: photo("A"), location: "Bin B2" })]);
  const second = await confirm(adapter, [reviewed({ id: "row-2", image: null, quantity: 3 })]);

  assert.equal(second.inventory[0].quantity, 5, "quantities accumulate");
  assert.equal(second.inventory[0].image, photo("A"), "an unphotographed rescan keeps the existing crop");
  assert.equal(second.inventory[0].location, "Bin B2", "an unspecified storage location keeps the existing bin");
  assert.equal(
    db.prepare("SELECT code FROM inventory_parts WHERE name = ?").get("VL53L0X range finder").code,
    "VL53L0X",
    "the card label survives a rescan",
  );
});

test("a fresher crop replaces the stored one", async () => {
  const { adapter } = createDatabase();
  await confirm(adapter, [reviewed({ image: photo("A") })]);
  const second = await confirm(adapter, [reviewed({ id: "row-2", image: photo("B"), location: "Bin C1" })]);

  assert.equal(second.inventory[0].image, photo("B"));
  assert.equal(second.inventory[0].location, "Bin C1");
});

test("two owners scanning the same part keep separate rows", async () => {
  const { db, adapter } = createDatabase();
  await confirm(adapter, [reviewed({ quantity: 2 })], "user-1");
  await confirm(adapter, [reviewed({ id: "row-2", quantity: 4 })], "user-2");

  const rows = db
    .prepare("SELECT owner_id, quantity FROM inventory_parts WHERE name = ? ORDER BY owner_id")
    .all("VL53L0X range finder");
  assert.deepEqual(
    rows.map((row) => ({ owner: row.owner_id, quantity: row.quantity })),
    [
      { owner: "user-1", quantity: 2 },
      { owner: "user-2", quantity: 4 },
    ],
  );
});

test("replaying another owner's confirmation token is refused", async () => {
  const { adapter } = createDatabase();
  const token = await issueConfirmationToken(SECRET);
  const items = [reviewed({})];
  const options = { secret: SECRET, model: "gemini-3.1-flash-lite" };

  await confirmIdentification({ token, items }, adapter, { ...options, ownerId: "user-1" });
  await assert.rejects(
    confirmIdentification({ token, items }, adapter, { ...options, ownerId: "user-2" }),
    /Invalid confirmation token/,
  );
});

test("a stocked part accepts a photo added from its card", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, OWNER, { name: "DHT22" });

  const updated = await setInventoryPartImage({ id: part.id, image: photo("C") }, OWNER, adapter);
  assert.equal(updated.hasImage, true);
  assert.equal((await getInventoryPartImage(part.id, OWNER, adapter)).image, photo("C"));

  const cleared = await setInventoryPartImage({ id: part.id, image: null }, OWNER, adapter);
  assert.equal(cleared.hasImage, false);
  assert.equal((await getInventoryPartImage(part.id, OWNER, adapter)).image, null);
});
