import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryQuery, cursorAfter, InvalidQueryError, MAX_PAGE_SIZE, parseInventoryQuery } from "../../lib/inventory/query.ts";
import { listInventory, summarizeInventory } from "../../lib/inventory/persistence.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

const url = (search = "") => new URL(`http://test/api/inventory${search}`);

test("defaults cover the common list request", () => {
  const query = parseInventoryQuery(url());
  assert.equal(query.sort, "name");
  assert.equal(query.category, null);
  assert.equal(query.cursor, null);
  assert.equal(query.search, "");
});

test("the all-parts sentinel is treated as no category filter", () => {
  assert.equal(parseInventoryQuery(url("?category=All%20parts")).category, null);
  assert.equal(parseInventoryQuery(url("?category=Sensors")).category, "Sensors");
});

test("invalid paging and sorting are rejected, not clamped", () => {
  assert.throws(() => parseInventoryQuery(url("?limit=0")), InvalidQueryError);
  assert.throws(() => parseInventoryQuery(url(`?limit=${MAX_PAGE_SIZE + 1}`)), InvalidQueryError);
  assert.throws(() => parseInventoryQuery(url("?limit=ten")), InvalidQueryError);
  assert.throws(() => parseInventoryQuery(url("?sort=colour")), InvalidQueryError);
  assert.throws(() => parseInventoryQuery(url("?cursor=not-a-cursor")), InvalidQueryError);
});

test("every query is anchored to one owner", () => {
  const { where, bindings } = buildInventoryQuery("user-1", parseInventoryQuery(url()));
  assert.match(where, /^owner_id = \?/);
  assert.equal(bindings[0], "user-1");
});

test("search wildcards in user input are escaped rather than executed", () => {
  const { bindings } = buildInventoryQuery("user-1", parseInventoryQuery(url("?search=100%25%20_x")));
  assert.ok(bindings.slice(1).every((binding) => binding === "%100\\% \\_x%"));
});

test("a cursor round-trips through the sort it was issued for", () => {
  const cursor = cursorAfter("name", { id: "part-3", name: "Relay", createdAt: "2026-01-01", quantity: 4 });
  const query = parseInventoryQuery(url(`?cursor=${encodeURIComponent(cursor)}`));
  assert.deepEqual(query.cursor, { value: "Relay", id: "part-3" });
});

test("pagination walks the whole cabinet without repeating or dropping a part", async () => {
  const { db, adapter } = createDatabase();
  for (let index = 0; index < 7; index += 1) {
    insertPart(db, "user-1", { name: `Part ${String.fromCharCode(97 + index)}` });
  }
  insertPart(db, "user-2", { name: "Someone else's board" });

  const seen = [];
  let cursor = null;
  do {
    const page = await listInventory(
      "user-1",
      parseInventoryQuery(url(`?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)),
      adapter,
    );
    seen.push(...page.items.map((item) => item.name));
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
  assert.ok(!seen.includes("Someone else's board"));
});

test("the list payload never carries thumbnail bytes", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "Photographed", image: "data:image/webp;base64,AAAA" });
  const page = await listInventory("user-1", parseInventoryQuery(url()), adapter);
  assert.equal(page.items[0].hasImage, true);
  assert.equal("image" in page.items[0], false);
  assert.ok(!JSON.stringify(page).includes("base64"));
});

test("search matches across the fields the card shows", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "Relay module", tags: '["Switching"]' });
  insertPart(db, "user-1", { name: "Servo", description: "Positional relay of motion" });
  insertPart(db, "user-1", { name: "Capacitor" });

  const page = await listInventory("user-1", parseInventoryQuery(url("?search=relay")), adapter);
  assert.deepEqual(page.items.map((item) => item.name).sort(), ["Relay module", "Servo"]);
});

test("the summary counts only the requesting owner", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { quantity: 3, category: "Sensors", image: "data:image/webp;base64,AAAA" });
  insertPart(db, "user-1", { quantity: 2, category: "Sensors" });
  insertPart(db, "user-1", { quantity: 5, category: "Power Sources", location: "Bin A1" });
  insertPart(db, "user-2", { quantity: 99 });

  const summary = await summarizeInventory("user-1", adapter);
  assert.equal(summary.totalTypes, 3);
  assert.equal(summary.totalUnits, 10);
  assert.equal(summary.photographed, 1);
  assert.deepEqual(
    summary.categories.map((entry) => ({ category: entry.category, count: entry.count })),
    [
      { category: "Power Sources", count: 1 },
      { category: "Sensors", count: 2 },
    ],
  );
  assert.ok(summary.locations.some((entry) => entry.location === "Bin A1" && entry.count === 1));
});
