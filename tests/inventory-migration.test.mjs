import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("inventory migrations apply statement-by-statement and seed nine parts", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0000_camera_identification.sql", "0001_inventory_category_taxonomy.sql", "0002_inventory_deletion.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    if (file === "0002_inventory_deletion.sql") assert.equal(statements.length, 5);
    for (const statement of statements) db.exec(statement);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts").get().count, 9);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name=?").get("inventory_adjustment_events").count, 1);
});
