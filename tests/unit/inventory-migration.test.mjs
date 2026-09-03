import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LEGACY_OWNER_ID } from "../../lib/auth/owner.ts";
import { migrate, migrationFiles, statementsIn } from "../helpers/sqlite-d1.mjs";

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
const indexes = (db, table) => db.prepare(`PRAGMA index_list(${table})`).all().map((index) => index.name);

test("every migration applies statement-by-statement in order", () => {
  const db = new DatabaseSync(":memory:");
  const files = migrationFiles();
  assert.ok(files.length >= 5, "the migration set should include the multi-tenancy change");
  assert.equal(statementsIn("0002_inventory_deletion.sql").length, 5);

  migrate(db, files);

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts").get().count, 9);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ?").get("inventory_adjustment_events").count, 1);
  assert.ok(columns(db, "inventory_parts").includes("image"));
  assert.ok(columns(db, "identification_events").includes("captured_image"));
});

test("multi-tenancy adds an owner to every domain table", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  for (const table of ["inventory_parts", "identification_scans", "identification_events", "inventory_adjustment_events"]) {
    assert.ok(columns(db, table).includes("owner_id"), `${table} should carry owner_id`);
  }
});

test("rows that predate multi-tenancy are parked on the legacy owner", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const unclaimed = db.prepare("SELECT COUNT(*) AS count FROM inventory_parts WHERE owner_id = ?").get(LEGACY_OWNER_ID);
  assert.equal(unclaimed.count, 9, "the seeded demo parts wait to be claimed rather than showing up in a new cabinet");
});

test("a scan that recorded a user keeps that user as its owner", () => {
  const db = new DatabaseSync(":memory:");
  const beforeOwnership = migrationFiles().filter((file) => file < "0004");
  migrate(db, beforeOwnership);
  db.prepare(
    `INSERT INTO identification_scans (id,confirmation_token_hash,user_id,provider,provider_model,accepted_detection_count)
     VALUES ('scan-1','hash-1','user-7','gemini','gemini-3.1-flash-lite',1)`,
  ).run();
  db.prepare(
    `INSERT INTO identification_scans (id,confirmation_token_hash,user_id,provider,provider_model,accepted_detection_count)
     VALUES ('scan-2','hash-2',NULL,'gemini','gemini-3.1-flash-lite',1)`,
  ).run();

  migrate(db, migrationFiles().filter((file) => file >= "0004"));

  assert.equal(db.prepare("SELECT owner_id FROM identification_scans WHERE id = 'scan-1'").get().owner_id, "user-7");
  assert.equal(db.prepare("SELECT owner_id FROM identification_scans WHERE id = 'scan-2'").get().owner_id, LEGACY_OWNER_ID);
});

test("the identity index is re-keyed so two owners can hold the same part", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  assert.ok(indexes(db, "inventory_parts").includes("idx_inventory_identity"));

  const insert = (id, owner) =>
    db.prepare(
      `INSERT INTO inventory_parts (id,owner_id,name,normalized_name,model_key,category,quantity)
       VALUES (?,?,'ESP32-CAM','esp32-cam','__unknown__','Cameras & Vision',1)`,
    ).run(id, owner);

  insert("a", "user-1");
  insert("b", "user-2");
  assert.throws(() => insert("c", "user-1"), /UNIQUE/);
});
