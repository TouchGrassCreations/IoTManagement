import type { D1Like } from "./persistence.ts";

/**
 * Identification spends money on every call, so the budget is counted in D1
 * rather than in memory: a Worker isolate is recycled between requests and
 * spread across colos, so an in-process counter would reset under load — which
 * is exactly when the limit has to hold.
 */

export type RateLimitEnv = { [binding: string]: unknown };
export type RateLimitOptions = { env?: RateLimitEnv; now?: number };

type RateLimitWindow = { name: string; seconds: number; binding: string; fallback: number };

/** Shortest first; the order is what the enforcement loop depends on. */
const WINDOWS: RateLimitWindow[] = [
  { name: "minute", seconds: 60, binding: "IDENTIFY_RATE_LIMIT_PER_MINUTE", fallback: 10 },
  { name: "hour", seconds: 3_600, binding: "IDENTIFY_RATE_LIMIT_PER_HOUR", fallback: 60 },
  { name: "day", seconds: 86_400, binding: "IDENTIFY_RATE_LIMIT_PER_DAY", fallback: 200 },
];

export class RateLimitedError extends Error {
  code = "RATE_LIMITED" as const;
  window: string;
  limit: number;
  retryAfterSeconds: number;
  constructor(window: string, limit: number, retryAfterSeconds: number) {
    super(`Identification is limited to ${limit} images per ${window}. Try again in ${retryAfterSeconds} seconds.`);
    this.window = window;
    this.limit = limit;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function limitFor(window: RateLimitWindow, env?: RateLimitEnv): number {
  const configured = Number(env?.[window.binding] ?? process.env[window.binding]);
  return Number.isInteger(configured) && configured > 0 ? configured : window.fallback;
}

/**
 * One statement claims the slot and reports the resulting count, so two
 * requests racing on the same window can never read the same number.
 */
async function claimSlot(ownerId: string, window: RateLimitWindow, start: number, db: D1Like): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO identification_rate_limits (owner_id,window_name,window_start,expires_at,count)
       VALUES (?,?,?,?,1)
       ON CONFLICT(owner_id,window_name,window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(ownerId, window.name, start, start + window.seconds)
    .first<{ count: number }>();
  // An upsert always returns its row. Reading a missing one as "over budget"
  // would refuse every request, so an unreadable count is treated as unused.
  return row?.count ?? 0;
}

/** Keeps the table proportional to live traffic without a scheduled job. */
async function pruneExpired(nowSeconds: number, db: D1Like): Promise<void> {
  await db.prepare("DELETE FROM identification_rate_limits WHERE expires_at <= ?").bind(nowSeconds).all();
}

/**
 * Windows are charged shortest first and a refusal stops the loop, so a request
 * turned away by the minute budget never spends from the hour or the day.
 * Throws `RateLimitedError`, which `respond` maps to 429.
 */
export async function enforceIdentificationRateLimit(ownerId: string, db: D1Like, options: RateLimitOptions = {}): Promise<void> {
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  await pruneExpired(nowSeconds, db);

  for (const window of WINDOWS) {
    const start = Math.floor(nowSeconds / window.seconds) * window.seconds;
    const count = await claimSlot(ownerId, window, start, db);
    const limit = limitFor(window, options.env);
    if (count > limit) throw new RateLimitedError(window.name, limit, Math.max(1, start + window.seconds - nowSeconds));
  }
}
