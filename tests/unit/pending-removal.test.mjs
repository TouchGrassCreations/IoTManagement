import assert from "node:assert/strict";
import test from "node:test";
import { createPendingRemoval } from "../../lib/inventory/pending-removal.ts";

function fakeTimer() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimeout(fn) { const id = nextId++; callbacks.set(id, fn); return id; },
    clearTimeout(id) { callbacks.delete(id); },
    async advanceAsync() { const queued = [...callbacks.values()]; callbacks.clear(); for (const callback of queued) await callback(); },
    size() { return callbacks.size; },
  };
}

const item = { id: "part-1", name: "PIR Motion Sensor", model: null, category: "Sensors", quantity: 5, location: "Bin B3", code: "SNS-PIR", description: "Motion sensor", tags: ["Motion"] };
const otherItem = { ...item, id: "part-2", name: "DHT22" };

test("undo restores state and prevents the commit request", async () => {
  const timer = fakeTimer();
  let commits = 0, restores = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  controller.schedule({ item, quantity: 2, commit: async () => { commits += 1; }, onOptimistic() {}, onRestore() { restores += 1; } });
  assert.equal(controller.undo(item.id), true);
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
  assert.equal(controller.hasPending(item.id), false);
});

test("different components can be pending while duplicate component scheduling is rejected", () => {
  const timer = fakeTimer();
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  const operation = (target) => ({ item: target, quantity: 1, commit: async () => {}, onOptimistic() {}, onRestore() {} });
  assert.equal(controller.schedule(operation(item)), true);
  assert.equal(controller.schedule(operation(item)), false);
  assert.equal(controller.schedule(operation(otherItem)), true);
  assert.deepEqual(controller.pendingIds().sort(), ["part-1", "part-2"]);
});

test("undo restores only its component and other pending removal still commits", async () => {
  const timer = fakeTimer();
  const commits = [], restores = [];
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  for (const target of [item, otherItem]) controller.schedule({ item: target, quantity: 1, commit: async () => commits.push(target.id), onOptimistic() {}, onRestore() { restores.push(target.id); } });
  assert.equal(controller.undo(item.id), true);
  assert.equal(controller.hasPending(item.id), false);
  assert.equal(controller.hasPending(otherItem.id), true);
  await timer.advanceAsync();
  assert.deepEqual(restores, ["part-1"]);
  assert.deepEqual(commits, ["part-2"]);
});

test("dispose cancels every operation without restoring", async () => {
  const timer = fakeTimer();
  let commits = 0, restores = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  for (const target of [item, otherItem]) controller.schedule({ item: target, quantity: 1, commit: async () => { commits += 1; }, onOptimistic() {}, onRestore() { restores += 1; } });
  controller.dispose();
  assert.equal(timer.size(), 0);
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
