import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoppingList,
  matchRequirements,
  planProject,
  rankProjects,
  readinessOf,
} from "../../lib/projects/matching.ts";

let sequence = 0;

function requirement(overrides = {}) {
  sequence += 1;
  const name = overrides.name ?? `Part ${sequence}`;
  return {
    id: `req-${sequence}`,
    name,
    normalizedName: name.toLowerCase(),
    model: null,
    modelKey: "__unknown__",
    category: "Sensors",
    quantityRequired: 1,
    matchMode: "identity",
    note: null,
    position: sequence,
    ...overrides,
  };
}

function stock(overrides = {}) {
  const name = overrides.name ?? "Part";
  return {
    normalizedName: name.toLowerCase(),
    modelKey: "__unknown__",
    category: "Sensors",
    quantity: 1,
    ...overrides,
  };
}

const project = (id, name) => ({
  id,
  name,
  summary: "",
  state: "planned",
  accent: "green",
  icon: "PRJ",
  nextStep: null,
  createdAt: "2026-01-01 00:00:00",
  updatedAt: "2026-01-01 00:00:00",
});

test("identity mode sums the matching rows and caps owned at what is required", () => {
  const need = requirement({ name: "SG90 Micro Servo", quantityRequired: 3 });
  const [match] = matchRequirements(
    [need],
    [stock({ name: "sg90 micro servo", quantity: 2 }), stock({ name: "sg90 micro servo", quantity: 5 })],
  );

  assert.equal(match.required, 3);
  assert.equal(match.owned, 3, "surplus stock does not make the build more than ready");
  assert.equal(match.missing, 0);
});

test("a null model never matches a known model, in either direction", () => {
  const unknownModel = requirement({ name: "ESP32-CAM", model: null, modelKey: "__unknown__", quantityRequired: 1 });
  const knownModel = requirement({ name: "ESP32-CAM", model: "OV5640", modelKey: "ov5640", quantityRequired: 1 });

  const [wantsUnknown] = matchRequirements([unknownModel], [stock({ name: "esp32-cam", modelKey: "ov5640", quantity: 4 })]);
  assert.equal(wantsUnknown.owned, 0, "a model-unknown requirement is not satisfied by a specific variant");

  const [wantsKnown] = matchRequirements([knownModel], [stock({ name: "esp32-cam", modelKey: "__unknown__", quantity: 4 })]);
  assert.equal(wantsKnown.owned, 0, "a specific variant is not satisfied by model-unknown stock");

  const [exact] = matchRequirements([knownModel], [stock({ name: "esp32-cam", modelKey: "ov5640", quantity: 1 })]);
  assert.equal(exact.owned, 1);
});

test("category mode is satisfied by any part filed in that category", () => {
  const need = requirement({ name: "Jumper wires", category: "Wiring & Connectors", matchMode: "category", quantityRequired: 20 });
  const [match] = matchRequirements([need], [
    stock({ name: "dupont ribbon", category: "Wiring & Connectors", quantity: 12 }),
    stock({ name: "jst lead", category: "Wiring & Connectors", quantity: 5 }),
    stock({ name: "dht22", category: "Sensors", quantity: 40 }),
  ]);

  assert.equal(match.owned, 17, "unrelated categories are ignored");
  assert.equal(match.missing, 3);
});

test("a pile of cheap parts does not outweigh the part the build turns on", () => {
  const wires = requirement({ name: "Jumper wire", category: "Wiring & Connectors", quantityRequired: 10 });
  const board = requirement({ name: "Arduino Uno R3", category: "Microcontrollers & Compute", quantityRequired: 1 });

  const withWires = readinessOf(matchRequirements([wires, board], [stock({ name: "jumper wire", category: "Wiring & Connectors", quantity: 10 })]));
  const withBoard = readinessOf(matchRequirements([wires, board], [stock({ name: "arduino uno r3", category: "Microcontrollers & Compute", quantity: 1 })]));

  // Counting units read these as 90% and 9%; each requirement is one share.
  assert.equal(withWires.percent, 50, "all the wires is half the build, not nearly all of it");
  assert.equal(withBoard.percent, 50, "the board is worth as much as the whole pile of wires");
  assert.equal(withWires.ready, false);
  assert.equal(withBoard.ready, false);
});

test("progress inside one requirement still moves the bar", () => {
  const wires = requirement({ name: "Jumper wire", category: "Wiring & Connectors", quantityRequired: 10 });
  const board = requirement({ name: "Arduino Uno R3", category: "Microcontrollers & Compute", quantityRequired: 1 });
  const inventory = [stock({ name: "jumper wire", category: "Wiring & Connectors", quantity: 5 })];

  const half = readinessOf(matchRequirements([wires, board], inventory));
  assert.equal(half.percent, 25, "half of one of two requirements");
  assert.equal(half.satisfiedParts, 0);
  assert.equal(half.requiredParts, 2);
});

test("a project is ready only when every unit is present", () => {
  const need = requirement({ name: "DHT22", quantityRequired: 2 });
  const complete = readinessOf(matchRequirements([need], [stock({ name: "dht22", quantity: 2 })]));

  assert.deepEqual(complete, {
    requiredParts: 1, satisfiedParts: 1, requiredUnits: 2, ownedUnits: 2, percent: 100, ready: true,
  });
});

test("one missing unit out of two hundred never rounds up to complete", () => {
  const need = requirement({ name: "M3 Screw", quantityRequired: 200 });
  const nearly = readinessOf(matchRequirements([need], [stock({ name: "m3 screw", quantity: 199 })]));

  assert.equal(nearly.percent, 99);
  assert.equal(nearly.ready, false);
});

test("a project with no requirements is empty, not finished", () => {
  assert.deepEqual(readinessOf([]), {
    requiredParts: 0, satisfiedParts: 0, requiredUnits: 0, ownedUnits: 0, percent: 0, ready: false,
  });
});

test("projects rank by readiness, then by how little is left to buy", () => {
  const inventory = [stock({ name: "dht22", quantity: 1 })];
  const ready = planProject(project("ready", "Ready"), [requirement({ name: "DHT22" })], inventory);
  const halfway = planProject(project("halfway", "Halfway"), [requirement({ name: "DHT22" }), requirement({ name: "Relay" })], inventory);
  const empty = planProject(project("empty", "Empty"), [], inventory);
  const distant = planProject(project("distant", "Distant"), [requirement({ name: "Chassis", quantityRequired: 9 })], inventory);

  assert.deepEqual(
    rankProjects([distant, empty, halfway, ready]).map((plan) => plan.id),
    ["ready", "halfway", "empty", "distant"],
  );
});

test("the shopping list merges duplicate shortfalls and names every project that wants them", () => {
  const inventory = [stock({ name: "sg90 micro servo", category: "Motors & Actuators", quantity: 1 })];
  const arm = planProject(
    project("arm", "Robot arm"),
    [requirement({ name: "SG90 Micro Servo", category: "Motors & Actuators", quantityRequired: 4 })],
    inventory,
  );
  const car = planProject(
    project("car", "Car"),
    [
      requirement({ name: "SG90 Micro Servo", category: "Motors & Actuators", quantityRequired: 2 }),
      requirement({ name: "Chassis", category: "Mechanical / Robotics", quantityRequired: 1 }),
    ],
    inventory,
  );

  const list = buildShoppingList([arm, car]);

  assert.equal(list.entries.length, 2);
  const [servos, chassis] = list.entries;
  assert.equal(servos.name, "SG90 Micro Servo");
  assert.equal(servos.missing, 4, "three for the arm and one for the car; nothing is reserved for either");
  assert.deepEqual(servos.projects.map((entry) => entry.name), ["Robot arm", "Car"]);
  assert.equal(chassis.missing, 1);
  assert.equal(list.totalUnits, 5);
});

test("a category requirement is listed as a category, not as a made-up part", () => {
  const plan = planProject(
    project("car", "Car"),
    [requirement({ name: "Jumper wires", category: "Wiring & Connectors", matchMode: "category", quantityRequired: 20 })],
    [],
  );

  const [entry] = buildShoppingList([plan]).entries;
  assert.equal(entry.name, "Any Wiring & Connectors");
  assert.equal(entry.model, null);
  assert.equal(entry.missing, 20);
});
