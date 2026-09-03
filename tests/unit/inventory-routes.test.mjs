import assert from "node:assert/strict";
import test from "node:test";
import { handleInventoryList } from "../../app/api/inventory/route.ts";
import { handleInventorySummary } from "../../app/api/inventory/summary/route.ts";
import { handleInventoryPhotoRead } from "../../app/api/inventory/[id]/photo/route.ts";
import { handleInventoryUpdate } from "../../app/api/inventory/[id]/route.ts";
import { handleInventoryPhoto } from "../../app/api/inventory/[id]/photo/route.ts";
import { handleInventoryRemoval } from "../../app/api/inventory/[id]/remove/route.ts";
import { InventoryNotFoundError, InventoryQuantityConflictError } from "../../lib/inventory/persistence.ts";

const item = { id: "part-1", name: "PIR Motion Sensor", model: null, category: "Sensors", quantity: 5, location: "Bin B3", code: "SNS-PIR", description: "Motion sensor", tags: ["Motion"], hasImage: false, updatedAt: "2026-01-01 00:00:00" };
const listRequest = (search = "") => new Request(`http://test/api/inventory${search}`);
const request = (body) => new Request("http://test/api/inventory/part-1/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET returns a page of inventory", async () => {
  const response = await handleInventoryList(listRequest(), { list: async () => ({ items: [item], nextCursor: null }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [item], nextCursor: null });
});

test("GET passes search, filter and paging through to the query", async () => {
  let received;
  await handleInventoryList(listRequest("?search=relay&category=Sensors&sort=recent&limit=10"), {
    list: async (query) => { received = query; return { items: [], nextCursor: null }; },
  });
  assert.equal(received.search, "relay");
  assert.equal(received.category, "Sensors");
  assert.equal(received.sort, "recent");
  assert.equal(received.limit, 10);
});

test("GET rejects an unusable query before touching the database", async () => {
  const response = await handleInventoryList(listRequest("?limit=9999"), {
    list: async () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 400);
});

test("the summary endpoint returns totals for the sidebar", async () => {
  const summary = { totalTypes: 2, totalUnits: 9, photographed: 1, categories: [], locations: [] };
  const response = await handleInventorySummary({ summarize: async () => summary });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), summary);
});

const photoRequest = (body) => new Request("http://test/api/inventory/part-1/photo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const photo = `data:image/webp;base64,${"A".repeat(120)}`;

test("photo route stores a validated crop", async () => {
  let received;
  const response = await handleInventoryPhoto(photoRequest({ image: photo }), "part-1", { setImage: async (input) => { received = input; return { ...item, image: photo }; } });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { id: "part-1", image: photo });
  assert.equal((await response.json()).item.image, photo);
});

test("photo route clears a photo and rejects foreign sources", async () => {
  const cleared = await handleInventoryPhoto(photoRequest({ image: null }), "part-1", { setImage: async (input) => { assert.equal(input.image, null); return item; } });
  assert.equal(cleared.status, 200);
  const remote = await handleInventoryPhoto(photoRequest({ image: "https://example.com/part.png" }), "part-1", { setImage: async () => { throw new Error("must not run"); } });
  assert.equal(remote.status, 400);
  const oversized = await handleInventoryPhoto(photoRequest({ image: `data:image/webp;base64,${"A".repeat(200_000)}` }), "part-1", { setImage: async () => { throw new Error("must not run"); } });
  assert.equal(oversized.status, 400);
});

test("photo route maps a missing part to 404", async () => {
  const response = await handleInventoryPhoto(photoRequest({ image: photo }), "missing", { setImage: async () => { throw new InventoryNotFoundError("missing"); } });
  assert.equal(response.status, 404);
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

const photoUrl = (search = "") => new Request(`http://test/api/inventory/part-1/photo${search}`, { headers: search.includes("etag") ? { "if-none-match": '"2026-01-01 00:00:00"' } : {} });

test("the photo endpoint serves bytes rather than a data URL", async () => {
  const response = await handleInventoryPhotoRead(photoUrl(), {
    readImage: async () => ({ image: `data:image/webp;base64,${btoa("hello!!")}`, updatedAt: "2026-01-01 00:00:00" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("etag"), '"2026-01-01 00:00:00"');
  assert.equal(new TextDecoder().decode(await response.arrayBuffer()), "hello!!");
});

test("a versioned photo request may be cached forever; an unversioned one revalidates", async () => {
  const readImage = async () => ({ image: `data:image/webp;base64,${btoa("hello!!")}`, updatedAt: "2026-01-01 00:00:00" });
  const versioned = await handleInventoryPhotoRead(photoUrl("?v=2026-01-01%2000%3A00%3A00"), { readImage });
  assert.match(versioned.headers.get("cache-control"), /immutable/);
  const plain = await handleInventoryPhotoRead(photoUrl(), { readImage });
  assert.equal(plain.headers.get("cache-control"), "private, no-cache");
});

test("a matching ETag short-circuits to 304", async () => {
  const response = await handleInventoryPhotoRead(photoUrl("?etag"), {
    readImage: async () => ({ image: "data:image/webp;base64,AAAA", updatedAt: "2026-01-01 00:00:00" }),
  });
  assert.equal(response.status, 304);
});

test("a part without a photo reports 404 rather than an empty image", async () => {
  const response = await handleInventoryPhotoRead(photoUrl(), { readImage: async () => ({ image: null, updatedAt: "x" }) });
  assert.equal(response.status, 404);
});

const patchRequest = (body) => new Request("http://test/api/inventory/part-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("PATCH forwards a validated edit and returns the updated part", async () => {
  let received;
  const response = await handleInventoryUpdate(patchRequest({ expectedCurrentQuantity: 5, name: "BMP280", quantityDelta: 2 }), "part-1", {
    update: async (input) => { received = input; return { item: { ...item, name: "BMP280", quantity: 7 }, mergedFromId: null }; },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { id: "part-1", expectedCurrentQuantity: 5, name: "BMP280", quantityDelta: 2 });
  assert.equal((await response.json()).item.quantity, 7);
});

test("PATCH reports a merge so the client can drop the folded row", async () => {
  const response = await handleInventoryUpdate(patchRequest({ expectedCurrentQuantity: 5, name: "ESP32-CAM" }), "part-1", {
    update: async () => ({ item: { ...item, id: "part-9" }, mergedFromId: "part-1" }),
  });
  assert.equal((await response.json()).mergedFromId, "part-1");
});

test("PATCH maps an invalid payload to 400 and a stale edit to 409", async () => {
  const invalid = await handleInventoryUpdate(patchRequest({ name: "No expected quantity" }), "part-1", {
    update: async () => { throw new Error("must not run"); },
  });
  assert.equal(invalid.status, 400);

  const stale = await handleInventoryUpdate(patchRequest({ expectedCurrentQuantity: 5 }), "part-1", {
    update: async () => { throw new InventoryQuantityConflictError({ ...item, quantity: 4 }); },
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).item.quantity, 4);
});
