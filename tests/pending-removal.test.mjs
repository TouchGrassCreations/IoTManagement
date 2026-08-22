import assert from "node:assert/strict";
import test from "node:test";
import { createPendingRemoval } from "../lib/inventory/pending-removal.ts";

function fakeTimer() {
  let callback;
  return {
    setTimeout(fn) { callback = fn; return 1; },
    clearTimeout() { callback = undefined; },
    async advanceAsync() { const next = callback; callback = undefined; await next?.(); },
  };
}

const item = { id: "part-1", name: "PIR Motion Sensor", model: null, category: "Sensors", quantity: 5, location: "Bin B3", code: "SNS-PIR", description: "Motion sensor", tags: ["Motion"] };

test("undo restores state and prevents the commit request", async () => {
  const timer = fakeTimer();
  let commits = 0, restores = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  controller.schedule({ item, quantity: 2, commit: async () => { commits += 1; }, onOptimistic() {}, onRestore() { restores += 1; } });
  assert.equal(controller.undo(), true);
  await timer.advanceAsync();
  assert.equal(commits, 0);
  assert.equal(restores, 1);
});

test("timer expiry commits exactly once", async () => {
  const timer = fakeTimer();
  let commits = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  controller.schedule({ item, quantity: 2, commit: async () => { commits += 1; }, onOptimistic() {}, onRestore() {} });
  await timer.advanceAsync();
  assert.equal(commits, 1);
  assert.equal(controller.hasPending(), false);
});

test("a second operation is rejected and dispose cancels without restoring", async () => {
  const timer = fakeTimer();
  let commits = 0, restores = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  const operation = { item, quantity: 1, commit: async () => { commits += 1; }, onOptimistic() {}, onRestore() { restores += 1; } };
  assert.equal(controller.schedule(operation), true);
  assert.equal(controller.schedule(operation), false);
  controller.dispose();
  await timer.advanceAsync();
  assert.equal(commits, 0);
  assert.equal(restores, 0);
});

test("commit failure restores and reports the error", async () => {
  const timer = fakeTimer();
  let restores = 0, reported;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  controller.schedule({ item, quantity: 1, commit: async () => { throw new Error("offline"); }, onOptimistic() {}, onRestore() { restores += 1; }, onError(error) { reported = error; } });
  await timer.advanceAsync();
  assert.equal(restores, 1);
  assert.equal(reported.message, "offline");
});
