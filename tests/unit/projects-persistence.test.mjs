import assert from "node:assert/strict";
import test from "node:test";
import {
  DuplicateProjectError,
  ProjectNotFoundError,
  createProject,
  deleteProject,
  getProjectPlan,
  listProjectPlans,
  projectShoppingList,
  replaceProjectRequirements,
  updateProject,
} from "../../lib/projects/persistence.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

const need = (name, overrides = {}) => ({
  name,
  model: null,
  category: "Sensors",
  quantityRequired: 1,
  matchMode: "identity",
  note: null,
  ...overrides,
});

const draft = (name, requirements = [], overrides = {}) => ({
  name,
  summary: "",
  state: "planned",
  accent: "green",
  icon: "PRJ",
  nextStep: null,
  requirements,
  ...overrides,
});

test("a created project reads back with its requirements in order and readiness from stock", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "DHT22", category: "Sensors", quantity: 2 });
  insertPart(db, "user-1", { name: "Arduino Uno R3", category: "Microcontrollers & Compute", quantity: 1 });

  const created = await createProject(
    draft("Weather station", [
      need("DHT22", { quantityRequired: 2 }),
      need("Arduino Uno R3", { category: "Microcontrollers & Compute" }),
      need("OLED Display", { category: "Displays & Indicators", quantityRequired: 1 }),
    ]),
    "user-1",
    adapter,
  );

  assert.deepEqual(created.requirements.map((match) => match.requirement.name), ["DHT22", "Arduino Uno R3", "OLED Display"]);
  assert.deepEqual(created.requirements.map((match) => match.owned), [2, 1, 0]);
  assert.deepEqual(created.readiness, { requiredUnits: 4, ownedUnits: 3, percent: 75, ready: false });

  const reread = await getProjectPlan(created.id, "user-1", adapter);
  assert.deepEqual(reread.readiness, created.readiness);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM project_parts WHERE project_id = ?").get(created.id).count, 3);
});

test("readiness is never stored, only recomputed", async () => {
  const { db, adapter } = createDatabase();
  const created = await createProject(draft("Doorbell", [need("PIR Motion Sensor", { quantityRequired: 2 })]), "user-1", adapter);
  assert.equal(created.readiness.percent, 0);

  insertPart(db, "user-1", { name: "PIR Motion Sensor", category: "Sensors", quantity: 2 });

  assert.equal((await getProjectPlan(created.id, "user-1", adapter)).readiness.percent, 100);
  const columns = db.prepare("PRAGMA table_info(projects)").all().map((column) => column.name);
  assert.ok(!columns.some((column) => /ready|percent|owned/.test(column)), "readiness has no column to go stale in");
});

test("one owner's stock never satisfies another owner's project", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-2", { name: "DHT22", category: "Sensors", quantity: 9 });

  const created = await createProject(draft("Weather station", [need("DHT22")]), "user-1", adapter);

  assert.equal(created.requirements[0].owned, 0);
  assert.equal(created.readiness.percent, 0);
});

test("a duplicate project name is refused for the same owner but allowed across owners", async () => {
  const { adapter } = createDatabase();
  await createProject(draft("Indoor farm"), "user-1", adapter);

  await assert.rejects(
    createProject(draft("indoor  Farm"), "user-1", adapter),
    (error) => error instanceof DuplicateProjectError && error.code === "DUPLICATE_PROJECT",
  );
  const other = await createProject(draft("Indoor farm"), "user-2", adapter);
  assert.equal(other.name, "Indoor farm");
});

test("renaming onto a name the owner already holds is refused", async () => {
  const { adapter } = createDatabase();
  await createProject(draft("Indoor farm"), "user-1", adapter);
  const second = await createProject(draft("Robot arm"), "user-1", adapter);

  await assert.rejects(
    updateProject(second.id, { name: "Indoor farm" }, "user-1", adapter),
    (error) => error instanceof DuplicateProjectError,
  );
  assert.equal((await getProjectPlan(second.id, "user-1", adapter)).name, "Robot arm");
});

test("one owner cannot read, update, replace parts on, or delete another's project", async () => {
  const { db, adapter } = createDatabase();
  const mine = await createProject(draft("Mecanum car", [need("TT Gear Motor", { category: "Motors & Actuators", quantityRequired: 4 })]), "user-1", adapter);

  for (const attempt of [
    getProjectPlan(mine.id, "user-2", adapter),
    updateProject(mine.id, { name: "Stolen" }, "user-2", adapter),
    replaceProjectRequirements(mine.id, [need("Nothing")], "user-2", adapter),
    deleteProject(mine.id, "user-2", adapter),
  ]) {
    await assert.rejects(attempt, (error) => error instanceof ProjectNotFoundError && error.code === "PROJECT_NOT_FOUND");
  }

  const row = db.prepare("SELECT name FROM projects WHERE id = ?").get(mine.id);
  assert.equal(row.name, "Mecanum car", "the foreign owner changed nothing");
  const parts = db.prepare("SELECT name FROM project_parts WHERE project_id = ?").all(mine.id);
  assert.deepEqual(parts.map((part) => part.name), ["TT Gear Motor"]);
});

test("the list holds only the caller's projects, ranked by readiness", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "DHT22", category: "Sensors", quantity: 2 });
  await createProject(draft("Ready build", [need("DHT22", { quantityRequired: 2 })]), "user-1", adapter);
  await createProject(draft("Distant build", [need("Grow light", { category: "Displays & Indicators", quantityRequired: 6 })]), "user-1", adapter);
  await createProject(draft("Someone else's", [need("DHT22")]), "user-2", adapter);

  const plans = await listProjectPlans("user-1", adapter);

  assert.deepEqual(plans.map((plan) => plan.name), ["Ready build", "Distant build"]);
  assert.equal(plans[0].readiness.ready, true);
});

test("deleting a project takes its requirements and leaves inventory alone", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "DHT22", category: "Sensors", quantity: 2 });
  const created = await createProject(draft("Weather station", [need("DHT22", { quantityRequired: 2 })]), "user-1", adapter);

  assert.deepEqual(await deleteProject(created.id, "user-1", adapter), { deleted: true, id: created.id });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM project_parts").get().count, 0);
  assert.equal(db.prepare("SELECT quantity FROM inventory_parts WHERE owner_id = 'user-1'").get().quantity, 2);

  await assert.rejects(deleteProject(created.id, "user-1", adapter), (error) => error instanceof ProjectNotFoundError);
});

test("replacing the requirement list swaps it wholesale and renumbers positions", async () => {
  const { db, adapter } = createDatabase();
  const created = await createProject(draft("Robot arm", [need("SG90 Micro Servo", { category: "Motors & Actuators", quantityRequired: 4 })]), "user-1", adapter);

  const updated = await replaceProjectRequirements(
    created.id,
    [need("MG996R Servo", { category: "Motors & Actuators", quantityRequired: 4 }), need("PCA9685", { category: "Motor Drivers & Power Drivers" })],
    "user-1",
    adapter,
  );

  assert.deepEqual(updated.requirements.map((match) => match.requirement.name), ["MG996R Servo", "PCA9685"]);
  assert.deepEqual(
    db.prepare("SELECT position FROM project_parts WHERE project_id = ? ORDER BY position").all(created.id).map((row) => row.position),
    [0, 1],
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM project_parts WHERE name = 'SG90 Micro Servo'").get().count, 0);
});

test("a model on a requirement is stored as the catalogue's identity key", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "ESP32-CAM", model: "OV5640", category: "Cameras & Vision", quantity: 1 });
  const created = await createProject(
    draft("Monitor", [
      need("ESP32-CAM", { category: "Cameras & Vision", model: "OV5640" }),
      need("ESP32-CAM", { category: "Cameras & Vision", model: null }),
    ]),
    "user-1",
    adapter,
  );

  const keys = db.prepare("SELECT model_key FROM project_parts WHERE project_id = ? ORDER BY position").all(created.id);
  assert.deepEqual(keys.map((row) => row.model_key), ["ov5640", "__unknown__"]);
  assert.deepEqual(created.requirements.map((match) => match.owned), [1, 0]);
});

test("the shopping list aggregates the owner's shortfalls and can be narrowed to a selection", async () => {
  const { adapter } = createDatabase();
  const arm = await createProject(draft("Robot arm", [need("MG996R Servo", { category: "Motors & Actuators", quantityRequired: 4 })]), "user-1", adapter);
  await createProject(draft("Car", [need("MG996R Servo", { category: "Motors & Actuators", quantityRequired: 2 })]), "user-1", adapter);
  await createProject(draft("Theirs", [need("MG996R Servo", { category: "Motors & Actuators", quantityRequired: 99 })]), "user-2", adapter);

  const everything = await projectShoppingList("user-1", null, adapter);
  assert.equal(everything.entries.length, 1);
  assert.equal(everything.entries[0].missing, 6, "another owner's shortfall is not on my list");

  const narrowed = await projectShoppingList("user-1", [arm.id], adapter);
  assert.equal(narrowed.entries[0].missing, 4);
});
