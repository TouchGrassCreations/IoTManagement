import assert from "node:assert/strict";
import test from "node:test";
import { InventoryQuantityConflictError, removeInventoryQuantity } from "../lib/inventory/persistence.ts";

function database(part) {
  const sql = [];
  return {
    sql,
    prepare(statement) {
      return {
        bind(...values) {
          return {
            first: async () => statement.startsWith("SELECT") ? part : null,
            all: async () => ({ results: part ? [part] : [] }),
            statement,
            values,
          };
        },
      };
    },
    async batch(statements) {
      sql.push(...statements.map((entry) => entry.statement));
      return [];
    },
  };
}

const part = { id: "part-1", name: "PIR Motion Sensor", model: null, category: "Sensors", quantity: 5, location: "Bin B3", code: "SNS-PIR", description: "Motion sensor", tags: "[\"Motion\"]" };

test("partial removal updates quantity and writes one audit event", async () => {
  const db = database(part);
  const result = await removeInventoryQuantity({ id: "part-1", quantity: 2, expectedCurrentQuantity: 5 }, db);
  assert.equal(result.deleted, false);
  assert.equal(result.item.quantity, 3);
  assert.match(db.sql.join("\n"), /UPDATE inventory_parts/);
  assert.match(db.sql.join("\n"), /INSERT INTO inventory_adjustment_events/);
});

test("full removal deletes both audit types before the part", async () => {
  const db = database(part);
  await removeInventoryQuantity({ id: "part-1", quantity: 5, expectedCurrentQuantity: 5 }, db);
  assert.deepEqual(db.sql.map((sql) => sql.match(/(?:FROM|DELETE FROM) (\w+)/)?.[1]).filter(Boolean), ["identification_events", "inventory_adjustment_events", "inventory_parts"]);
});

test("stale quantity throws a typed conflict containing current inventory", async () => {
  const db = database({ ...part, quantity: 4 });
  await assert.rejects(
    removeInventoryQuantity({ id: "part-1", quantity: 2, expectedCurrentQuantity: 5 }, db),
    (error) => error instanceof InventoryQuantityConflictError && error.item.quantity === 4,
  );
});
