import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryResponseGuard } from "../../lib/inventory/response-guard.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a list response started before a mutation cannot overwrite the mutation", async () => {
  const guard = createInventoryResponseGuard();
  const request = guard.beginLoad();
  const response = deferred();
  let visibleQuantity = 5;
  const loading = response.promise.then((quantity) => request.apply(() => { visibleQuantity = quantity; }));

  guard.recordMutation();
  visibleQuantity = 3;
  response.resolve(5);

  assert.equal(await loading, false);
  assert.equal(visibleQuantity, 3);
});

test("a list response applies when no newer mutation occurred", () => {
  const guard = createInventoryResponseGuard();
  const request = guard.beginLoad();
  let applied = false;
  assert.equal(request.apply(() => { applied = true; }), true);
  assert.equal(applied, true);
});

test("a newer list request supersedes an older list request", () => {
  const guard = createInventoryResponseGuard();
  const older = guard.beginLoad();
  const newer = guard.beginLoad();
  let value = "initial";
  assert.equal(newer.apply(() => { value = "newer"; }), true);
  assert.equal(older.apply(() => { value = "older"; }), false);
  assert.equal(value, "newer");
});
