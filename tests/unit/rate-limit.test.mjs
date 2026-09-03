import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitedError, enforceIdentificationRateLimit } from "../../lib/identification/rate-limit.ts";
import { handleIdentifyRequest } from "../../app/api/identify/route.ts";
import { createDatabase } from "../helpers/sqlite-d1.mjs";

/** Noon UTC, so every window starts exactly on the instant. */
const NOON = Date.UTC(2026, 0, 1, 12, 0, 0);
const TIGHT = { IDENTIFY_RATE_LIMIT_PER_MINUTE: "3", IDENTIFY_RATE_LIMIT_PER_HOUR: "5", IDENTIFY_RATE_LIMIT_PER_DAY: "7" };

function call(adapter, ownerId, now, env = TIGHT) {
  return enforceIdentificationRateLimit(ownerId, adapter, { env, now });
}

async function spend(adapter, ownerId, times, now, env = TIGHT) {
  for (let attempt = 0; attempt < times; attempt += 1) await call(adapter, ownerId, now, env);
}

const rows = (db) => db.prepare("SELECT owner_id,window_name,window_start,expires_at,count FROM identification_rate_limits ORDER BY owner_id,window_name").all();
const counts = (db, ownerId = "user-1") =>
  Object.fromEntries(rows(db).filter((row) => row.owner_id === ownerId).map((row) => [row.window_name, row.count]));

test("a request under the budget passes and is counted in every window", async () => {
  const { db, adapter } = createDatabase();

  await spend(adapter, "user-1", 3, NOON);

  assert.deepEqual(counts(db), { day: 3, hour: 3, minute: 3 });
});

test("the request over the minute budget is refused, naming the window and its reset", async () => {
  const { adapter } = createDatabase();
  await spend(adapter, "user-1", 3, NOON);

  await assert.rejects(
    () => call(adapter, "user-1", NOON + 20_000),
    (error) => {
      assert.ok(error instanceof RateLimitedError);
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.window, "minute");
      assert.equal(error.limit, 3);
      assert.equal(error.retryAfterSeconds, 40);
      assert.match(error.message, /per minute/);
      return true;
    },
  );
});

test("the hour budget refuses once the minute budget has room again", async () => {
  const { adapter } = createDatabase();
  for (let minute = 0; minute < 5; minute += 1) await call(adapter, "user-1", NOON + minute * 60_000);

  await assert.rejects(
    () => call(adapter, "user-1", NOON + 5 * 60_000),
    (error) => error.window === "hour" && error.retryAfterSeconds === 3_300 && /per hour/.test(error.message),
  );
});

test("the day budget refuses once the shorter windows have rolled over", async () => {
  const { adapter } = createDatabase();
  for (let hour = 0; hour < 7; hour += 1) await call(adapter, "user-1", NOON + hour * 3_600_000);

  await assert.rejects(
    () => call(adapter, "user-1", NOON + 7 * 3_600_000),
    (error) => error.window === "day" && error.retryAfterSeconds === 5 * 3_600 && /per day/.test(error.message),
  );
});

test("a refused request does not spend the budget of a wider window", async () => {
  const { db, adapter } = createDatabase();
  await spend(adapter, "user-1", 3, NOON);

  await assert.rejects(() => call(adapter, "user-1", NOON), (error) => error.window === "minute");

  assert.deepEqual(counts(db), { day: 3, hour: 3, minute: 4 });
});

test("windows reset independently", async () => {
  const { db, adapter } = createDatabase();
  await spend(adapter, "user-1", 3, NOON);
  await assert.rejects(() => call(adapter, "user-1", NOON), (error) => error.window === "minute");

  await call(adapter, "user-1", NOON + 60_000);

  assert.deepEqual(counts(db), { day: 4, hour: 4, minute: 1 });
});

test("two owners hold independent budgets", async () => {
  const { db, adapter } = createDatabase();
  await spend(adapter, "user-1", 3, NOON);
  await assert.rejects(() => call(adapter, "user-1", NOON), (error) => error.window === "minute");

  await call(adapter, "user-2", NOON);

  assert.deepEqual(counts(db, "user-2"), { day: 1, hour: 1, minute: 1 });
});

test("interleaved calls each claim their own slot", async () => {
  const { db, adapter } = createDatabase();
  const env = { IDENTIFY_RATE_LIMIT_PER_MINUTE: "10", IDENTIFY_RATE_LIMIT_PER_HOUR: "100", IDENTIFY_RATE_LIMIT_PER_DAY: "100" };

  const settled = await Promise.allSettled(Array.from({ length: 12 }, () => call(adapter, "user-1", NOON, env)));

  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 10);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 2);
  assert.deepEqual(counts(db), { day: 10, hour: 10, minute: 12 });
});

test("expired windows are pruned by the next request", async () => {
  const { db, adapter } = createDatabase();
  await call(adapter, "user-1", NOON);
  assert.equal(rows(db).length, 3);

  await call(adapter, "user-2", NOON + 25 * 3_600_000);

  assert.deepEqual(rows(db).map((row) => `${row.owner_id}/${row.window_name}`), ["user-2/day", "user-2/hour", "user-2/minute"]);
});

test("unset bindings fall back to the built-in hobbyist budget", async () => {
  const { adapter } = createDatabase();
  await spend(adapter, "user-1", 10, NOON, {});

  await assert.rejects(() => call(adapter, "user-1", NOON, {}), (error) => error.window === "minute" && error.limit === 10);
});

test("an unreadable binding is ignored rather than opening the endpoint", async () => {
  const { adapter } = createDatabase();
  const env = { IDENTIFY_RATE_LIMIT_PER_MINUTE: "unlimited" };
  await spend(adapter, "user-1", 10, NOON, env);

  await assert.rejects(() => call(adapter, "user-1", NOON, env), (error) => error.limit === 10);
});

test("the endpoint refuses with a 429 and a Retry-After before reading the upload", async () => {
  const { adapter } = createDatabase();
  await spend(adapter, "user-1", 3, NOON);
  const body = new FormData();
  body.set("image", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "parts.png", { type: "image/png" }));

  const response = await handleIdentifyRequest(new Request("http://test/api/identify", { method: "POST", body }), {
    enforceRateLimit: () => call(adapter, "user-1", NOON + 20_000),
    recognize: async () => assert.fail("a refused request must not reach the provider"),
    issueToken: async () => assert.fail("a refused request must not mint a token"),
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "40");
  assert.match((await response.json()).error, /per minute/);
});
