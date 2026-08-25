import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("inventory migrations apply statement-by-statement and seed nine parts", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0000_camera_identification.sql", "0001_inventory_category_taxonomy.sql", "0002_inventory_deletion.sql", "0003_inventory_part_photos.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    if (file === "0002_inventory_deletion.sql") assert.equal(statements.length, 5);
    for (const statement of statements) db.exec(statement);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts").get().count, 9);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name=?").get("inventory_adjustment_events").count, 1);
  assert.ok(db.prepare("PRAGMA table_info(inventory_parts)").all().some((column) => column.name === "image"));
  assert.ok(db.prepare("PRAGMA table_info(identification_events)").all().some((column) => column.name === "captured_image"));
  db.prepare("UPDATE inventory_parts SET image=? WHERE id=?").run("data:image/webp;base64,AAAA", "seed-dht22");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts WHERE image IS NOT NULL").get().count, 1);
});
