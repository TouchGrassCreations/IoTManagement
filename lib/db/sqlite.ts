import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { D1Like } from "../identification/persistence.ts";

/**
 * A D1-shaped adapter over node:sqlite, so every query the persistence layer
 * already writes runs unchanged off Cloudflare.
 *
 * D1's contract is what the callers expect, not node:sqlite's: `first` yields
 * null rather than undefined, `all` wraps its rows in `{ results }`, and a
 * batch either lands whole or not at all.
 */

/** What `batch` hands back, shaped like D1's so `changed()` reads it the same. */
type RunResult = { meta: { changes: number; last_row_id: number } };

type Runnable = { run(): RunResult };

/** SQLite binds null, numbers, strings, bigints and buffers — booleans it will not. */
function normalize(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as SQLInputValue;
}

let savepoints = 0;

function prepared(database: DatabaseSync, sql: string, values: SQLInputValue[]) {
  return {
    // D1 statements are immutable: binding returns a new statement rather than
    // mutating the one the caller may still be holding.
    bind: (...next: unknown[]) => prepared(database, sql, next.map(normalize)),
    first: async <T = unknown>(): Promise<T | null> =>
      (database.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T = unknown>(): Promise<{ results: T[] }> => ({
      results: database.prepare(sql).all(...values) as T[],
    }),
    run: (): RunResult => {
      const { changes, lastInsertRowid } = database.prepare(sql).run(...values);
      return { meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) } };
    },
  };
}

export function createDatabaseAdapter(database: DatabaseSync): D1Like {
  return {
    prepare: (sql: string) => prepared(database, sql, []),

    /**
     * A savepoint rather than BEGIN, so a batch is atomic whether or not it is
     * already inside a transaction — a migration running one is enough to make
     * a bare BEGIN throw.
     */
    async batch(statements) {
      const name = `d1_batch_${(savepoints += 1)}`;
      database.exec(`SAVEPOINT ${name}`);
      try {
        const results = statements.map((statement) => (statement as unknown as Runnable).run());
        database.exec(`RELEASE ${name}`);
        return results;
      } catch (error) {
        database.exec(`ROLLBACK TO ${name}`);
        database.exec(`RELEASE ${name}`);
        throw error;
      }
    },
  };
}
