import assert from "node:assert/strict";
import test from "node:test";
import { handleHistoryList } from "../../app/api/history/route.ts";
import { describeHistoryEvent, historyDate } from "../../lib/history/format.ts";
import { listHistory } from "../../lib/history/persistence.ts";
import { InvalidHistoryQueryError, buildHistoryQuery, parseHistoryQuery } from "../../lib/history/query.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

const url = (search = "") => new URL(`http://test/api/history${search}`);
const query = (overrides = {}) => ({ limit: 40, cursor: null, ...overrides });

function insertScan(db, ownerId, id, createdAt, accepted = 2) {
  db.prepare(
    `INSERT INTO identification_scans
       (id,owner_id,confirmation_token_hash,user_id,provider,provider_model,accepted_detection_count,created_at)
     VALUES (?,?,?,?,'gemini','gemini-3.1-flash-lite',?,?)`,
  ).run(id, ownerId, `hash-${id}`, ownerId, accepted, createdAt);
}

function insertIdentification(db, ownerId, id, partId, createdAt, name = "ESP32-CAM", quantity = 2) {
  db.prepare(
    `INSERT INTO identification_events
       (id,owner_id,scan_id,inventory_part_id,source,confirmed_name,confirmed_model,quantity_added,was_edited,created_at)
     VALUES (?,?,?,?,'gemini',?,NULL,?,0,?)`,
  ).run(id, ownerId, `scan-${id}`, partId, name, quantity, createdAt);
}

function insertAdjustment(db, ownerId, id, partId, type, createdAt, before, removed, after) {
  db.prepare(
    `INSERT INTO inventory_adjustment_events
       (id,owner_id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(id, ownerId, partId, type, before, removed, after, createdAt);
}

test("paging defaults cover the common request", () => {
  assert.deepEqual(parseHistoryQuery(url()), { limit: 40, cursor: null });
  assert.equal(parseHistoryQuery(url("?limit=10")).limit, 10);
});

test("an unusable limit or cursor is rejected, not clamped", () => {
  assert.throws(() => parseHistoryQuery(url("?limit=0")), InvalidHistoryQueryError);
  assert.throws(() => parseHistoryQuery(url("?limit=101")), InvalidHistoryQueryError);
  assert.throws(() => parseHistoryQuery(url("?cursor=not-a-cursor")), InvalidHistoryQueryError);
});

test("every source in the union is anchored to one owner", () => {
  const { sql, bindings } = buildHistoryQuery("owner-1", query());
  assert.equal(sql.match(/UNION ALL/g).length, 2);
  assert.deepEqual(bindings, ["owner-1", "owner-1", "owner-1"]);
  assert.doesNotMatch(sql, /OFFSET/);
});

test("a cursor filters each source before the union", () => {
  const { sql, bindings } = buildHistoryQuery("owner-1", query({ cursor: { at: "2026-02-01 10:00:00", id: "e-2" } }));
  assert.equal(sql.match(/created_at < \?/g).length, 3);
  assert.equal(bindings.length, 12);
});

test("scans, confirmations and stock changes arrive as one newest-first timeline", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "owner-1", { name: "ESP32-CAM", quantity: 4 });
  insertScan(db, "owner-1", "scan-1", "2026-02-01 09:00:00", 3);
  insertIdentification(db, "owner-1", "ident-1", part.id, "2026-02-01 09:00:01");
  insertAdjustment(db, "owner-1", "adj-1", part.id, "quantity_removed", "2026-02-01 09:30:00", 6, 2, 4);
  insertScan(db, "owner-2", "scan-2", "2026-02-02 09:00:00", 9);

  const page = await listHistory("owner-1", query(), adapter);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(page.events.map((event) => event.id), ["adj-1", "ident-1", "scan-1"]);
  assert.deepEqual(page.events.map((event) => event.kind), ["adjustment", "identification", "scan"]);
  assert.equal(page.events[0].partName, "ESP32-CAM");
  assert.equal(page.events[0].quantityAfter, 4);
  assert.equal(page.events[2].quantity, 3);
});

test("another owner's audit trail is never visible", async () => {
  const { db, adapter } = createDatabase();
  const mine = insertPart(db, "owner-1", { name: "DHT22" });
  const theirs = insertPart(db, "owner-2", { name: "BME280" });
  insertAdjustment(db, "owner-1", "adj-1", mine.id, "details_edited", "2026-02-01 09:00:00", 3, 0, 3);
  insertAdjustment(db, "owner-2", "adj-2", theirs.id, "details_edited", "2026-02-03 09:00:00", 3, 0, 3);
  insertIdentification(db, "owner-2", "ident-2", theirs.id, "2026-02-03 09:00:01");

  const page = await listHistory("owner-1", query(), adapter);
  assert.deepEqual(page.events.map((event) => event.id), ["adj-1"]);
});

test("the cursor walks the timeline without repeating or skipping an event", async () => {
  const { db, adapter } = createDatabase();
  const part = insertPart(db, "owner-1", { name: "SG90 Micro Servo" });
  // The same timestamp across all three tables, so only the id breaks the tie.
  insertScan(db, "owner-1", "a-scan", "2026-02-04 08:00:00");
  insertIdentification(db, "owner-1", "b-ident", part.id, "2026-02-04 08:00:00");
  insertAdjustment(db, "owner-1", "c-adj", part.id, "quantity_adjusted", "2026-02-04 08:00:00", 1, 0, 5);
  insertAdjustment(db, "owner-1", "d-adj", part.id, "details_edited", "2026-02-03 08:00:00", 5, 0, 5);

  const seen = [];
  let cursor = null;
  do {
    const page = await listHistory("owner-1", query({ limit: 2, cursor: cursor ? parseHistoryQuery(url(`?cursor=${cursor}`)).cursor : null }), adapter);
    seen.push(...page.events.map((event) => event.id));
    cursor = page.nextCursor;
  } while (cursor);

  assert.deepEqual(seen, ["c-adj", "b-ident", "a-scan", "d-adj"]);
});

test("an adjustment whose part is gone still reads as a sentence", async () => {
  const { db, adapter } = createDatabase();
  insertAdjustment(db, "owner-1", "adj-1", "part-gone", "quantity_removed", "2026-02-05 08:00:00", 2, 2, 0);
  const page = await listHistory("owner-1", query(), adapter);
  assert.equal(page.events[0].partName, null);
  assert.equal(describeHistoryEvent(page.events[0]), "Removed 2 of a part that has since been removed, leaving 0.");
});

const event = (overrides) => ({
  id: "e-1",
  kind: "adjustment",
  at: "2026-02-01 09:00:00",
  type: "quantity_removed",
  partId: "part-1",
  partName: "ESP32-CAM",
  partModel: null,
  quantity: 2,
  quantityBefore: 6,
  quantityAfter: 4,
  ...overrides,
});

test("every event type reads as a plain sentence", () => {
  assert.equal(
    describeHistoryEvent(event({ kind: "scan", type: "gemini", partName: null, quantity: 3 })),
    "Scanned a photo and catalogued 3 parts.",
  );
  assert.equal(
    describeHistoryEvent(event({ kind: "scan", type: "gemini", partName: null, quantity: 1 })),
    "Scanned a photo and catalogued 1 part.",
  );
  assert.equal(
    describeHistoryEvent(event({ kind: "identification", type: "gemini", quantity: 2 })),
    "Identified ESP32-CAM in a photo and filed 2 units.",
  );
  assert.equal(
    describeHistoryEvent(event({ kind: "identification", type: "manual", quantity: 1 })),
    "Added ESP32-CAM by hand — 1 unit.",
  );
  assert.equal(describeHistoryEvent(event()), "Removed 2 of ESP32-CAM, leaving 4.");
  assert.equal(
    describeHistoryEvent(event({ type: "quantity_adjusted", quantityBefore: 4, quantityAfter: 9 })),
    "Changed ESP32-CAM stock from 4 to 9.",
  );
  assert.equal(describeHistoryEvent(event({ type: "details_edited" })), "Edited the details of ESP32-CAM.");
  assert.equal(
    describeHistoryEvent(event({ type: "merged_into", quantityBefore: 3, quantityAfter: 8 })),
    "Merged a duplicate into ESP32-CAM — stock went from 3 to 8.",
  );
  assert.equal(
    describeHistoryEvent(event({ type: "csv_imported", quantityBefore: 0, quantityAfter: 4 })),
    "Imported ESP32-CAM from a CSV file — 4 units.",
  );
  assert.equal(
    describeHistoryEvent(event({ type: "csv_imported", quantityBefore: 4, quantityAfter: 10 })),
    "Imported 6 more of ESP32-CAM from a CSV file — stock went from 4 to 10.",
  );
  assert.equal(describeHistoryEvent(event({ type: "something_new" })), "Updated ESP32-CAM.");
});

test("a stored timestamp is read as UTC rather than local time", () => {
  assert.equal(historyDate("2026-02-01 09:00:00").toISOString(), "2026-02-01T09:00:00.000Z");
  assert.equal(historyDate("2026-02-01T09:00:00.000Z").toISOString(), "2026-02-01T09:00:00.000Z");
});

test("the route returns a page and refuses an unusable query", async () => {
  const page = { events: [event()], nextCursor: null };
  const response = await handleHistoryList(new Request("http://test/api/history"), { list: async () => page });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), page);

  const rejected = await handleHistoryList(new Request("http://test/api/history?limit=999"), {
    list: async () => {
      throw new Error("must not run");
    },
  });
  assert.equal(rejected.status, 400);
});
