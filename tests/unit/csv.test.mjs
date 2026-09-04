import assert from "node:assert/strict";
import test from "node:test";
import {
  CsvImportError,
  INVENTORY_CSV_COLUMNS,
  MAX_IMPORT_ROWS,
  inventoryToCsv,
  modelKeyFor,
  parseCsv,
  parseInventoryCsv,
  toCsvRow,
} from "../../lib/inventory/csv.ts";
import { handleInventoryExport } from "../../app/api/inventory/export/route.ts";
import { applyInventoryImport, handleInventoryImport } from "../../app/api/inventory/import/route.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

const item = (overrides = {}) => ({
  id: "part-1",
  name: "PIR Motion Sensor",
  model: null,
  category: "Sensors",
  quantity: 5,
  location: "Bin B3",
  code: "SNS-PIR",
  description: "Motion sensor",
  tags: ["Motion", "5V"],
  hasImage: false,
  updatedAt: "2026-01-01 00:00:00",
  ...overrides,
});

test("commas, quotes and newlines are quoted the way RFC 4180 asks", () => {
  assert.equal(toCsvRow(["plain", "a,b", 'say "hi"', "two\nlines"]), 'plain,"a,b","say ""hi""","two\nlines"');
});

test("a part with awkward text survives a round trip through the file", () => {
  const awkward = item({ name: "Relay, 5V", description: 'Clicks "loudly"\nwhen it switches', model: "SRD-05VDC" });
  const [header, row] = parseCsv(inventoryToCsv([awkward]));
  assert.deepEqual(header, [...INVENTORY_CSV_COLUMNS]);
  assert.equal(row[1], "Relay, 5V");
  assert.equal(row[2], "SRD-05VDC");
  assert.equal(row[7], 'Clicks "loudly"\nwhen it switches');
  assert.equal(row[8], "Motion, 5V");
});

test("the export carries hasImage rather than the photo itself", () => {
  const csv = inventoryToCsv([item({ hasImage: true })]);
  const [header, row] = parseCsv(csv);
  assert.ok(!header.includes("image"));
  assert.equal(header[9], "hasImage");
  assert.equal(row[9], "true");
});

test("the reader handles CRLF, a byte order mark and a trailing newline", () => {
  const records = parseCsv("﻿name,category\r\nESP32,Sensors\r\n");
  assert.deepEqual(records, [["name", "category"], ["ESP32", "Sensors"]]);
});

test("a file that ends inside a quoted field is refused", () => {
  assert.throws(() => parseCsv('name\n"unterminated'), CsvImportError);
});

test("headers are matched loosely and unknown columns are ignored", () => {
  const { rows, errors } = parseInventoryCsv("ID,Name,Has Image,Category,Quantity\nx,BME280,true,Sensors,4\n");
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "BME280");
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[0].location, "Unsorted");
});

test("a file without the required columns is refused whole", () => {
  assert.throws(() => parseInventoryCsv("name,quantity\nESP32,2\n"), CsvImportError);
  assert.throws(() => parseInventoryCsv(""), CsvImportError);
  assert.throws(() => parseInventoryCsv("name,category\n"), CsvImportError);
});

test("every bad row is reported against the row it came from", () => {
  const { rows, errors } = parseInventoryCsv(
    [
      "name,category,quantity",
      "ESP32-CAM,Cameras & Vision,2",
      ",Sensors,1",
      "Loose Wire,Wires,1",
      "DHT22,Sensors,0",
      "DHT22,Sensors,1.5",
      "",
      "BME280,Sensors,3",
    ].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(errors.map((entry) => entry.row), [3, 4, 5, 6]);
  assert.match(errors[0].message, /Name is required/);
  assert.match(errors[1].message, /not one of the known categories/);
  assert.match(errors[2].message, /whole number/);
});

test("the same identity twice in one file is an error, not a double count", () => {
  const { rows, errors } = parseInventoryCsv("name,category\nESP32 Cam,Sensors\nesp32   cam,Sensors\n");
  assert.equal(rows.length, 1);
  assert.deepEqual(errors, [{ row: 3, message: "The same part is already on row 2." }]);
});

test("a file past the row cap is refused rather than truncated", () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `Part ${index},Sensors,1`);
  assert.throws(
    () => parseInventoryCsv(["name,category,quantity", ...rows].join("\n")),
    (error) => error instanceof CsvImportError && error.message.includes(String(MAX_IMPORT_ROWS)),
  );
});

test("a missing model uses the catalogue's unknown-model key", () => {
  const { rows } = parseInventoryCsv("name,category,model\nMystery Board,Others,\n");
  assert.equal(rows[0].model, null);
  assert.equal(rows[0].modelKey, "__unknown__");
  assert.equal(modelKeyFor("SRD-05VDC"), "srd-05vdc");
});

test("the export streams every page behind one download", async () => {
  const pages = [
    { items: [item({ id: "p1", name: "Relay, 5V" })], nextCursor: "page-2" },
    { items: [item({ id: "p2", name: "DHT22" })], nextCursor: null },
  ];
  const cursors = [];
  const response = await handleInventoryExport({
    list: async (cursor) => {
      cursors.push(cursor);
      return pages[cursors.length - 1];
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv/);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="parts-cabinet-\d{4}-\d{2}-\d{2}\.csv"/);
  const records = parseCsv(await response.text());
  assert.deepEqual(cursors, [null, "page-2"]);
  assert.deepEqual(records.map((record) => record[1]), ["name", "Relay, 5V", "DHT22"]);
});

const importRequest = (body) =>
  new Request("http://test/api/inventory/import", { method: "POST", headers: { "content-type": "text/csv" }, body });

test("one unreadable row stops the whole import", async () => {
  const response = await handleInventoryImport(importRequest("name,category\nESP32,Sensors\nBroken,Nope\n"), {
    apply: async () => {
      throw new Error("must not run");
    },
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.deepEqual(payload.rows, [{ row: 3, message: 'Category "Nope" is not one of the known categories.' }]);
});

test("a readable file is applied and summarised", async () => {
  let received;
  const response = await handleInventoryImport(importRequest("name,category,quantity\nESP32,Sensors,2\n"), {
    apply: async (rows) => {
      received = rows;
      return { imported: 1, created: 1, merged: 0 };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(received[0].normalizedName, "esp32");
  assert.deepEqual(await response.json(), { imported: 1, created: 1, merged: 0 });
});

test("an import merges into the part already holding the identity, and only for that owner", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "owner-1", { name: "PIR Motion Sensor", quantity: 2, description: "Passive infrared." });
  insertPart(db, "owner-2", { name: "PIR Motion Sensor", quantity: 9 });

  const { rows, errors } = parseInventoryCsv(
    "name,category,quantity,location,description\npir  motion sensor,Sensors,3,,\nBME280,Sensors,4,Bin B7,Pressure sensor\n",
  );
  assert.deepEqual(errors, []);
  const summary = await applyInventoryImport(rows, "owner-1", adapter);
  assert.deepEqual(summary, { imported: 2, created: 1, merged: 1 });

  const mine = db
    .prepare("SELECT name,quantity,location,description,model_key FROM inventory_parts WHERE owner_id = ? ORDER BY quantity")
    .all("owner-1");
  assert.equal(mine.length, 2);
  assert.deepEqual({ ...mine[0] }, { name: "BME280", quantity: 4, location: "Bin B7", description: "Pressure sensor", model_key: "__unknown__" });
  // Blank cells leave the stored bin and description alone.
  assert.equal(mine[1].quantity, 5);
  assert.equal(mine[1].location, "Unsorted");
  assert.equal(mine[1].description, "Passive infrared.");

  const other = db.prepare("SELECT quantity FROM inventory_parts WHERE owner_id = ?").all("owner-2");
  assert.deepEqual(other.map((row) => ({ ...row })), [{ quantity: 9 }]);
});

test("an import leaves an audit trail with the stock levels it moved", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "owner-1", { name: "DHT22", quantity: 4 });
  const { rows } = parseInventoryCsv("name,category,quantity\nDHT22,Sensors,6\nHC-SR04,Sensors,2\n");
  await applyInventoryImport(rows, "owner-1", adapter);

  const events = db
    .prepare("SELECT event_type,quantity_before,quantity_after FROM inventory_adjustment_events WHERE owner_id = ? ORDER BY quantity_after")
    .all("owner-1");
  assert.deepEqual(events.map((row) => ({ ...row })), [
    { event_type: "csv_imported", quantity_before: 0, quantity_after: 2 },
    { event_type: "csv_imported", quantity_before: 4, quantity_after: 10 },
  ]);
});

test("an upload past the cap is refused from its declared size, before the body is read", async () => {
  const request = new Request("http://test/api/inventory/import", {
    method: "POST",
    headers: { "content-length": String(50_000_000) },
    body: "name,category,quantity\nRelay,Sensors,1\n",
  });
  const response = await handleInventoryImport(request, {
    apply: async () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too large/);
});

test("a multi-byte body is measured in bytes, not characters", async () => {
  // Every character here is three bytes, so a character count would let a file
  // three times over the cap through.
  const oversized = `name,category,quantity\n${"漢".repeat(400_000)},Sensors,1\n`;
  const response = await handleInventoryImport(
    new Request("http://test/api/inventory/import", { method: "POST", body: oversized }),
    { apply: async () => { throw new Error("must not run"); } },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too large/);
});
