import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * A D1-shaped adapter over node:sqlite, so persistence tests exercise the real
 * SQL — indexes, ON CONFLICT clauses and conditional guards included — instead
 * of asserting against a hand-written stub.
 */

const MIGRATION_DIRECTORY = new URL("../../drizzle/", import.meta.url);

export function migrationFiles() {
  return readdirSync(MIGRATION_DIRECTORY)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function statementsIn(file) {
  return readFileSync(new URL(file, MIGRATION_DIRECTORY), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function migrate(db, files = migrationFiles()) {
  for (const file of files) {
    for (const statement of statementsIn(file)) db.exec(statement);
  }
}

function normalize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export function d1(db) {
  return {
    prepare(sql) {
      const statement = (values) => ({
        statement: sql,
        values,
        bind: (...next) => statement(next.map(normalize)),
        first: async () => db.prepare(sql).get(...values) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...values) }),
        run: () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }),
      });
      return statement([]);
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((entry) => entry.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

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
