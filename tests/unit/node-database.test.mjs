import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyMigrations, migrationFiles } from "../../lib/db/migrations.ts";
import { nodeBindings } from "../../lib/db/node.ts";
import { createDatabaseAdapter } from "../../lib/db/sqlite.ts";

const DRIZZLE = fileURLToPath(new URL("../../drizzle/", import.meta.url));

const tables = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);

test("the journal applies every migration once and records it", () => {
  const db = new DatabaseSync(":memory:");

  const applied = applyMigrations(db, DRIZZLE);

  assert.deepEqual(applied, migrationFiles(DRIZZLE));
  assert.ok(tables(db).includes("inventory_parts"));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM _migrations").get().count, applied.length);
});

test("a second pass over the same database does nothing", () => {
  // The migrations are bare CREATE TABLE, so an unjournalled second pass would
  // throw — which is exactly what a restarting container would do to a volume.
  const db = new DatabaseSync(":memory:");
  applyMigrations(db, DRIZZLE);

  const parts = db.prepare("SELECT COUNT(*) AS count FROM inventory_parts").get().count;
  assert.deepEqual(applyMigrations(db, DRIZZLE), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_parts").get().count, parts);
});

test("a migration that fails halfway leaves no half-built schema and is not recorded", () => {
  const directory = mkdtempSync(join(tmpdir(), "migrations-"));
  writeFileSync(
    join(directory, "0000_broken.sql"),
    "CREATE TABLE good (id TEXT);\n--> statement-breakpoint\nCREATE TABLE bad (this is not sql);",
  );
  const db = new DatabaseSync(":memory:");

  assert.throws(() => applyMigrations(db, directory), /0000_broken\.sql failed/);
  assert.ok(!tables(db).includes("good"), "the first statement should roll back with the second");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM _migrations").get().count, 0);
});

test("first() answers null rather than undefined when nothing matches", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, flag INTEGER)");

  const row = await createDatabaseAdapter(db).prepare("SELECT id FROM t WHERE id = ?").bind("absent").first();

  assert.equal(row, null);
});

test("a boolean binds as an integer instead of being refused", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, flag INTEGER)");
  const adapter = createDatabaseAdapter(db);

  await adapter.batch([adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("a", true)]);

  assert.equal((await adapter.prepare("SELECT flag FROM t WHERE id = ?").bind("a").first()).flag, 1);
});

test("a batch lands whole or not at all, and reports what changed", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, flag INTEGER)");
  const adapter = createDatabaseAdapter(db);

  const results = await adapter.batch([
    adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("a", 1),
    adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("b", 1),
  ]);
  assert.deepEqual(results.map((result) => result.meta.changes), [1, 1]);

  await assert.rejects(
    adapter.batch([
      adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("c", 1),
      adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("a", 1),
    ]),
    /UNIQUE constraint failed/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM t").get().count, 2, "the row before the failure should be gone");
});

test("a batch inside an open transaction still rolls back on its own", async () => {
  // A savepoint rather than BEGIN is what makes this work; a bare BEGIN would
  // throw here instead of nesting.
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, flag INTEGER)");
  const adapter = createDatabaseAdapter(db);

  db.exec("BEGIN");
  await adapter.batch([adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("keep", 1)]);
  await assert.rejects(
    adapter.batch([
      adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("drop", 1),
      adapter.prepare("INSERT INTO t (id,flag) VALUES (?,?)").bind("keep", 1),
    ]),
    /UNIQUE constraint failed/,
  );
  db.exec("COMMIT");

  assert.deepEqual(db.prepare("SELECT id FROM t").all().map((row) => row.id), ["keep"]);
});

test("the node bindings open a migrated database and treat a blank variable as unset", async () => {
  process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "cabinet-")), "cabinet.db");
  process.env.MIGRATIONS_DIR = DRIZZLE;
  process.env.ANONYMOUS_OWNER_ID = "someone";
  // Compose sets a declared-but-unset variable to "", which would otherwise beat
  // the default model name that the caller reaches for with `??`.
  process.env.GEMINI_MODEL = "";

  const env = nodeBindings();

  assert.equal(env.ANONYMOUS_OWNER_ID, "someone");
  assert.equal(env.GEMINI_MODEL, undefined);
  const seeded = await env.DB.prepare("SELECT COUNT(*) AS count FROM inventory_parts").first();
  assert.equal(seeded.count, 9, "the migrations should have run before the first query");
});
