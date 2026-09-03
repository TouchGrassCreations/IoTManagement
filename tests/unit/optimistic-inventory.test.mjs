import assert from "node:assert/strict";
import test from "node:test";
import { projectInventoryWithPending } from "../../lib/inventory/optimistic-inventory.ts";

const item = { id: "part-1", name: "PIR Motion Sensor", model: null, category: "Sensors", quantity: 5, location: "Bin B3", code: "SNS-PIR", description: "Motion sensor", tags: ["Motion"] };

test("projects a pending removal from the latest authoritative quantity", () => {
  const projected = projectInventoryWithPending([{ ...item, quantity: 4 }], [{ item, quantity: 2 }]);
  assert.equal(projected[0].quantity, 2);
});

test("never renders negative stock when refreshed stock is below the pending amount", () => {
  const projected = projectInventoryWithPending([{ ...item, quantity: 2 }], [{ item, quantity: 3 }]);
  assert.deepEqual(projected, []);
});

test("removing pending state reveals the latest authoritative item rather than its old snapshot", () => {
  const authoritative = [{ ...item, quantity: 4 }];
  assert.equal(projectInventoryWithPending(authoritative, [{ item, quantity: 2 }])[0].quantity, 2);
  assert.equal(projectInventoryWithPending(authoritative, [])[0].quantity, 4);
});
