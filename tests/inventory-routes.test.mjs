import assert from "node:assert/strict";
import test from "node:test";
import { handleInventoryList } from "../app/api/inventory/route.ts";
import { handleInventoryRemoval } from "../app/api/inventory/[id]/remove/route.ts";
import { InventoryNotFoundError, InventoryQuantityConflictError } from "../lib/inventory/persistence.ts";

const item = { id: "part-1", name: "PIR Motion Sensor", model: null, category: "Sensors", quantity: 5, location: "Bin B3", code: "SNS-PIR", description: "Motion sensor", tags: ["Motion"] };
const request = (body) => new Request("http://test/api/inventory/part-1/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET returns current inventory", async () => {
  const response = await handleInventoryList({ list: async () => [item] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { inventory: [item] });
});

test("remove maps stale stock to 409 with current inventory", async () => {
  const response = await handleInventoryRemoval(request({ quantity: 2, expectedCurrentQuantity: 5 }), "part-1", { remove: async () => { throw new InventoryQuantityConflictError({ ...item, quantity: 4 }); } });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Inventory quantity changed.", item: { ...item, quantity: 4 } });
});

test("remove rejects invalid payloads", async () => {
  const response = await handleInventoryRemoval(request({ quantity: "2", expectedCurrentQuantity: 5 }), "part-1", { remove: async () => { throw new Error("must not run"); } });
  assert.equal(response.status, 400);
});

test("remove maps missing inventory to 404", async () => {
  const response = await handleInventoryRemoval(request({ quantity: 1, expectedCurrentQuantity: 5 }), "missing", { remove: async () => { throw new InventoryNotFoundError("missing"); } });
  assert.equal(response.status, 404);
});

test("remove returns partial and full results", async () => {
  const partial = await handleInventoryRemoval(request({ quantity: 2, expectedCurrentQuantity: 5 }), "part-1", { remove: async () => ({ deleted: false, item: { ...item, quantity: 3 } }) });
  assert.deepEqual(await partial.json(), { deleted: false, item: { ...item, quantity: 3 } });
  const full = await handleInventoryRemoval(request({ quantity: 5, expectedCurrentQuantity: 5 }), "part-1", { remove: async () => ({ deleted: true, id: "part-1" }) });
  assert.deepEqual(await full.json(), { deleted: true, id: "part-1" });
});
