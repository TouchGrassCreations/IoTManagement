import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** The ledger of applied migrations. D1's control plane keeps its own. */
const JOURNAL_TABLE = "_migrations";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function migrationFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function statementsIn(directory: string, file: string): string[] {
  return readFileSync(join(directory, file), "utf8")
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Applies every migration this database has not seen, in filename order, and
 * records each one.
 *
 * The ledger is the whole point. Cloudflare applies the packaged migrations
 * once, against a database it tracks; a container restarts against a volume
 * that survived it. The migrations are written as bare `CREATE TABLE`, so a
 * second unguarded pass would fail on the first file and take the container
 * down with it.
 *
 * Returns the files applied by this call, so a caller can log a cold start
 * differently from a restart that had nothing to do.
 */
export function applyMigrations(database: DatabaseSync, directory: string): string[] {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  const applied = new Set(
    (database.prepare(`SELECT name FROM ${JOURNAL_TABLE}`).all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  const pending = migrationFiles(directory).filter((file) => !applied.has(file));

  for (const file of pending) {
    // One transaction per file: SQLite rolls DDL back like anything else, so a
    // migration that fails halfway leaves no half-built schema behind.
    database.exec("BEGIN");
    try {
      for (const statement of statementsIn(directory, file)) database.exec(statement);
      database.prepare(`INSERT INTO ${JOURNAL_TABLE} (name) VALUES (?)`).run(file);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }

  return pending;
}
