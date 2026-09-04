import assert from "node:assert/strict";
import test from "node:test";
import { promptFor } from "../../lib/identification/gemini.ts";
import { confirmIdentification } from "../../lib/identification/persistence.ts";
import { issueConfirmationToken } from "../../lib/identification/tokens.ts";
import { validateConfirmationPayload, validateGeminiPayload } from "../../lib/identification/validation.ts";
import { listProjectPlans } from "../../lib/projects/persistence.ts";
import { createDatabase } from "../helpers/sqlite-d1.mjs";

const SECRET = "test-confirmation-secret";
const OWNER = "owner-1";

const detection = (overrides = {}) => ({
  name: "SG90 micro servo",
  model: "SG90",
  category: "Motors & Actuators",
  quantity: 2,
  boundingBox: { top: 0.1, left: 0.1, width: 0.3, height: 0.2 },
  confidence: 0.9,
  visibleMarkings: [],
  alternatives: [],
  description: "Micro servo",
  tags: [],
  ...overrides,
});

const reviewed = (overrides = {}) => ({
  ...detection(),
  id: "row-1",
  accepted: true,
  source: "gemini",
  location: "Unsorted",
  image: null,
  detectedName: "SG90 micro servo",
  detectedModel: "SG90",
  ...overrides,
});

async function confirm(adapter, items) {
  return confirmIdentification({ token: await issueConfirmationToken(SECRET), items }, adapter, {
    ownerId: OWNER,
    secret: SECRET,
  });
}

test("the prompt names the cabinet's projects, or says there are none", () => {
  const withProjects = promptFor(["Mecanum wheel car", "Indoor farm"]);
  assert.match(withProjects, /"Mecanum wheel car", "Indoor farm"/);
  assert.match(withProjects, /Never put a name outside that list/);
  assert.match(withProjects, /projectIdeas/);
  assert.match(promptFor([]), /no projects yet/);
  assert.doesNotMatch(promptFor([]), /already contains these projects/);
});

test("the project list handed to the model is capped", () => {
  const many = Array.from({ length: 60 }, (_, index) => `Project ${index}`);
  const prompt = promptFor(many);
  assert.match(prompt, /"Project 39"/);
  assert.doesNotMatch(prompt, /"Project 40"/);
});

test("a detection without project fields is still valid", () => {
  const [parsed] = validateGeminiPayload({ detections: [detection()] });
  assert.equal(parsed.projectMatch, null);
  assert.deepEqual(parsed.projectIdeas, []);
});

test("project suggestions survive validation, and rubbish does not", () => {
  const [parsed] = validateGeminiPayload({
    detections: [detection({ projectMatch: "Indoor farm", projectIdeas: [{ name: "Pan-tilt mount", reason: "Two servos aim a camera." }] })],
  });
  assert.equal(parsed.projectMatch, "Indoor farm");
  assert.deepEqual(parsed.projectIdeas, [{ name: "Pan-tilt mount", reason: "Two servos aim a camera." }]);

  const ideas = (value) => () => validateGeminiPayload({ detections: [detection({ projectIdeas: value })] });
  assert.throws(ideas("Pan-tilt mount"), /projectIdeas/);
  assert.throws(ideas([{ name: "" }]), /project idea name/);
  assert.throws(ideas([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }]), /projectIdeas/);
  assert.deepEqual(validateGeminiPayload({ detections: [detection({ projectIdeas: [{ name: "Rover" }] })] })[0].projectIdeas, [{ name: "Rover", reason: "" }]);
});

test("a review row cannot ask for an existing and a new project at once", () => {
  const items = [reviewed({ projectId: "project-1", newProjectName: "Rover" })];
  assert.throws(() => validateConfirmationPayload({ token: "signed-token", items }), /either an existing project or a new one/);

  const { items: parsed } = validateConfirmationPayload({ token: "signed-token", items: [reviewed({ projectId: "project-1" })] });
  assert.equal(parsed[0].projectId, "project-1");
  assert.equal(parsed[0].newProjectName, null);
});

test("confirming files the part into the project the row chose", async () => {
  const { adapter } = createDatabase();
  await confirm(adapter, [reviewed({ newProjectName: "Pan-tilt camera mount", projectReason: "Two servos aim the camera." })]);

  const [project] = await listProjectPlans(OWNER, adapter);
  assert.equal(project.name, "Pan-tilt camera mount");
  assert.equal(project.summary, "Two servos aim the camera.");
  assert.equal(project.requirements.length, 1);
  assert.equal(project.requirements[0].requirement.name, "SG90 micro servo");
  assert.equal(project.requirements[0].required, 2);
  assert.equal(project.readiness.percent, 100, "the part it was catalogued from already satisfies it");
});

test("the same idea twice adds a requirement without splitting the project", async () => {
  const { adapter } = createDatabase();
  await confirm(adapter, [reviewed({ newProjectName: "Pan-tilt camera mount" })]);
  await confirm(adapter, [reviewed({ id: "row-2", name: "MG996R servo", model: "MG996R", newProjectName: "pan-tilt camera mount" })]);

  const plans = await listProjectPlans(OWNER, adapter);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].requirements.map((entry) => entry.requirement.name).sort(), ["MG996R servo", "SG90 micro servo"]);
  assert.deepEqual(plans[0].requirements.map((entry) => entry.requirement.position), [0, 1], "the appended requirement keeps its order");
});

test("filing into an existing project leaves its other requirements alone", async () => {
  const { adapter } = createDatabase();
  const first = await confirm(adapter, [reviewed({ newProjectName: "Arduino car" })]);
  assert.equal(first.inventory.length, 1);
  const [project] = await listProjectPlans(OWNER, adapter);

  await confirm(adapter, [reviewed({ id: "row-2", name: "L298N driver", model: "L298N", quantity: 1, projectId: project.id })]);
  const [updated] = await listProjectPlans(OWNER, adapter);
  assert.equal(updated.id, project.id);
  assert.equal(updated.requirements.length, 2);
});

test("a row with no project choice touches no project", async () => {
  const { adapter } = createDatabase();
  await confirm(adapter, [reviewed()]);
  assert.deepEqual(await listProjectPlans(OWNER, adapter), []);
});

test("a project deleted mid-review does not fail the confirmation", async () => {
  const { adapter } = createDatabase();
  const saved = await confirm(adapter, [reviewed({ projectId: "project-that-vanished" })]);
  assert.equal(saved.inventory.length, 1, "the inventory is still written");
  assert.deepEqual(await listProjectPlans(OWNER, adapter), []);
});

test("one owner's suggestion cannot reach another owner's project", async () => {
  const { adapter } = createDatabase();
  await confirmIdentification(
    { token: await issueConfirmationToken(SECRET), items: [reviewed({ newProjectName: "Their build" })] },
    adapter,
    { ownerId: "owner-2", secret: SECRET },
  );
  const [theirs] = await listProjectPlans("owner-2", adapter);

  await confirm(adapter, [reviewed({ id: "row-2", projectId: theirs.id })]);
  assert.equal((await listProjectPlans("owner-2", adapter))[0].requirements.length, 1, "their project is untouched");
  assert.deepEqual(await listProjectPlans(OWNER, adapter), [], "and nothing was created for the other owner");
});
