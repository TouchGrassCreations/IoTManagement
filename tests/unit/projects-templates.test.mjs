import assert from "node:assert/strict";
import test from "node:test";
import { createProject, listProjectPlans } from "../../lib/projects/persistence.ts";
import { PROJECT_TEMPLATES, seedProjectTemplates } from "../../lib/projects/templates.ts";
import { parseProjectCreate } from "../../lib/projects/validation.ts";
import { createDatabase, insertPart } from "../helpers/sqlite-d1.mjs";

const names = (plans) => plans.map((plan) => plan.name).sort();

test("every starter template is a payload the create endpoint would accept", () => {
  assert.equal(PROJECT_TEMPLATES.length, 5);
  for (const template of PROJECT_TEMPLATES) {
    const parsed = parseProjectCreate(JSON.parse(JSON.stringify(template)));
    assert.equal(parsed.name, template.name);
    assert.ok(parsed.requirements.length >= 5, `${template.name} should list what it needs`);
  }
});

test("seeding fills an empty cabinet with the five starter builds", async () => {
  const { db, adapter } = createDatabase();

  const result = await seedProjectTemplates("user-1", adapter);

  assert.equal(result.created.length, 5);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(names(result.projects), names(PROJECT_TEMPLATES));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM projects WHERE owner_id = 'user-1'").get().count, 5);
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM project_parts").get().count >= 25);
});

test("seeding twice adds nothing and reports every skip", async () => {
  const { db, adapter } = createDatabase();
  await seedProjectTemplates("user-1", adapter);
  const partsAfterFirstRun = db.prepare("SELECT COUNT(*) AS count FROM project_parts").get().count;

  const second = await seedProjectTemplates("user-1", adapter);

  assert.deepEqual(second.created, []);
  assert.equal(second.skipped.length, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM projects").get().count, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM project_parts").get().count, partsAfterFirstRun);
});

test("a template whose name the owner already used is skipped, not overwritten", async () => {
  const { db, adapter } = createDatabase();
  const mine = await createProject(
    {
      name: "Basic Arduino car",
      summary: "My own version.",
      state: "building",
      accent: "blue",
      icon: "MINE",
      nextStep: null,
      requirements: [{ name: "Arduino Uno R3", model: null, category: "Microcontrollers & Compute", quantityRequired: 1, matchMode: "identity", note: null }],
    },
    "user-1",
    adapter,
  );

  const result = await seedProjectTemplates("user-1", adapter);

  assert.deepEqual(result.skipped, ["Basic Arduino car"]);
  assert.equal(result.created.length, 4);
  const kept = db.prepare("SELECT summary, icon FROM projects WHERE id = ?").get(mine.id);
  assert.equal(kept.summary, "My own version.");
  assert.equal(kept.icon, "MINE");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM project_parts WHERE project_id = ?").get(mine.id).count, 1);
});

test("two owners can each hold the whole starter set", async () => {
  const { adapter } = createDatabase();
  await seedProjectTemplates("user-1", adapter);

  const second = await seedProjectTemplates("user-2", adapter);

  assert.equal(second.created.length, 5);
  assert.equal((await listProjectPlans("user-1", adapter)).length, 5);
  assert.equal((await listProjectPlans("user-2", adapter)).length, 5);
});

test("a seeded template matches stock catalogued the usual way", async () => {
  const { db, adapter } = createDatabase();
  insertPart(db, "user-1", { name: "Arduino Uno R3", category: "Microcontrollers & Compute", quantity: 1 });
  insertPart(db, "user-1", { name: "L298N Motor Driver", category: "Motor Drivers & Power Drivers", quantity: 1 });
  insertPart(db, "user-1", { name: "Dupont Jumper Ribbon", category: "Wiring & Connectors", quantity: 40 });

  const { projects } = await seedProjectTemplates("user-1", adapter);
  const car = projects.find((project) => project.name === "Basic Arduino car");
  const owned = new Map(car.requirements.map((match) => [match.requirement.name, match.owned]));

  assert.equal(owned.get("Arduino Uno R3"), 1);
  assert.equal(owned.get("L298N Motor Driver"), 1);
  assert.equal(owned.get("Jumper wires"), 20, "the category requirement is met by any wiring part");
  assert.equal(owned.get("TT Gear Motor"), 0);
  assert.ok(car.readiness.percent > 0 && car.readiness.percent < 100);
});
