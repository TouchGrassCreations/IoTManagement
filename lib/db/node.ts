import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RouteEnv } from "../http/context.ts";
import type { D1Like } from "../identification/persistence.ts";
import { applyMigrations } from "./migrations.ts";
import { createDatabaseAdapter } from "./sqlite.ts";

/**
 * The database for a plain Node process — a container, or `npm start` on a
 * laptop. Cloudflare hands the worker a `DB` binding that is already migrated
 * and pooled for it; here the file has to be opened, caught up and kept.
 */

const DEFAULT_DATABASE_PATH = "./data/cabinet.db";
const DEFAULT_MIGRATIONS_DIRECTORY = "./drizzle";

let database: D1Like | undefined;

export function databasePath(): string {
  return resolve(process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH);
}

/** Opened once per process, on the first query rather than at import time. */
export function nodeDatabase(): D1Like {
  if (database) return database;

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);

  // WAL keeps a reader from blocking the writer, and the busy timeout absorbs
  // the contention that is left instead of surfacing SQLITE_BUSY to a request.
  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA busy_timeout = 5000");

  const applied = applyMigrations(connection, resolve(process.env.MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIRECTORY));
  if (applied.length > 0) console.log(`[db] applied ${applied.length} migration(s): ${applied.join(", ")}`);

  database = createDatabaseAdapter(connection);
  return database;
}

/**
 * A blank variable is an unset one. Compose, systemd and Kubernetes all set a
 * declared-but-empty variable to `""`, and the callers reach for their defaults
 * with `??` — so an empty `GEMINI_MODEL` passed through would win against the
 * default model name instead of yielding to it.
 */
function setting(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

/**
 * The bindings a route sees. Configuration comes from the process environment,
 * which is what `docker run -e` and a compose file set, under the same names
 * the Worker would have been given.
 */
export function nodeBindings(): RouteEnv {
  return {
    DB: nodeDatabase(),
    ANONYMOUS_OWNER_ID: setting(process.env.ANONYMOUS_OWNER_ID),
    TRUSTED_PROXY_SECRET: setting(process.env.TRUSTED_PROXY_SECRET),
    CONFIRMATION_TOKEN_SECRET: setting(process.env.CONFIRMATION_TOKEN_SECRET),
    GEMINI_API_KEY: setting(process.env.GEMINI_API_KEY),
    GEMINI_MODEL: setting(process.env.GEMINI_MODEL),
  };
}
