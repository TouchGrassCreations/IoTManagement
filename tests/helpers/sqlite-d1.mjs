import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { migrationFiles as filesIn, statementsIn as statementsFrom } from "../../lib/db/migrations.ts";
import { createDatabaseAdapter } from "../../lib/db/sqlite.ts";

/**
 * Test fixtures over the production SQLite adapter, so persistence tests
 * exercise the real SQL — indexes, ON CONFLICT clauses and conditional guards
 * included — through the same adapter a container runs.
 */

const MIGRATION_DIRECTORY = fileURLToPath(new URL("../../drizzle/", import.meta.url));

export function migrationFiles() {
  return filesIn(MIGRATION_DIRECTORY);
}

export function statementsIn(file) {
  return statementsFrom(MIGRATION_DIRECTORY, file);
}

/** Unjournalled, so a test can apply an arbitrary subset in order. */
export function migrate(db, files = migrationFiles()) {
  for (const file of files) {
    for (const statement of statementsIn(file)) db.exec(statement);
  }
}

export const d1 = createDatabaseAdapter;

/** A migrated in-memory database plus its D1 adapter. */
export function createDatabase() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return { db, adapter: d1(db) };
}

let sequence = 0;

/** Inserts a part directly, bypassing confirmation, for query-shape tests. */
export function insertPart(db, ownerId, overrides = {}) {
  sequence += 1;
  const part = {
    id: `part-${sequence}`,
    name: `Part ${sequence}`,
    model: null,
    category: "Sensors",
    quantity: 1,
    location: "Unsorted",
    code: "MODEL-UNKNOWN",
    description: "",
    tags: "[]",
    image: null,
    created_at: `2026-01-01 00:00:${String(sequence).padStart(2, "0")}`,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO inventory_parts
       (id,owner_id,name,normalized_name,model,model_key,category,quantity,location,code,description,tags,image,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    part.id,
    ownerId,
    part.name,
    part.name.trim().toLowerCase(),
    part.model,
    part.model ? part.model.trim().toLowerCase() : "__unknown__",
    part.category,
    part.quantity,
    part.location,
    part.code,
    part.description,
    part.tags,
    part.image,
    part.created_at,
    part.created_at,
  );
  return part;
}
