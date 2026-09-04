import assert from "node:assert/strict";
import test from "node:test";
import { handleProjectCreate, handleProjectList } from "../../app/api/projects/route.ts";
import { handleProjectDelete, handleProjectRead, handleProjectUpdate } from "../../app/api/projects/[id]/route.ts";
import { handleProjectPartsReplace } from "../../app/api/projects/[id]/parts/route.ts";
import { handleShoppingList } from "../../app/api/projects/shopping-list/route.ts";
import { handleTemplateSeed } from "../../app/api/projects/templates/route.ts";
import { OwnerRequiredError } from "../../lib/auth/owner.ts";
import { DuplicateProjectError, ProjectNotFoundError } from "../../lib/projects/persistence.ts";

const plan = {
  id: "project-1",
  name: "Indoor farm",
  summary: "",
  state: "planned",
  accent: "green",
  icon: "FARM",
  nextStep: null,
  createdAt: "2026-01-01 00:00:00",
  updatedAt: "2026-01-01 00:00:00",
  requirements: [],
  readiness: { requiredParts: 0, satisfiedParts: 0, requiredUnits: 0, ownedUnits: 0, percent: 0, ready: false },
};

const body = (payload, method = "POST") =>
  new Request("http://test/api/projects", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

const raw = (text) => new Request("http://test/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: text });

const refuse = () => {
  throw new Error("must not run");
};

test("the list returns the owner's ranked projects", async () => {
  const response = await handleProjectList({ list: async () => [plan] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { projects: [plan] });
});

test("an unresolved owner is a 401, before anything is read", async () => {
  const response = await handleProjectList({
    list: async () => {
      throw new OwnerRequiredError();
    },
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Sign in to open your cabinet.");
});

test("creating a project returns 201 and the validated payload", async () => {
  let received;
  const response = await handleProjectCreate(
    body({ name: "Indoor farm", state: "building", requirements: [{ name: "DHT22", category: "Sensors", quantityRequired: 2 }] }),
    {
      create: async (input) => {
        received = input;
        return plan;
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(received.state, "building");
  assert.equal(received.accent, "green", "an omitted accent falls back rather than failing");
  assert.deepEqual(received.requirements, [
    { name: "DHT22", model: null, category: "Sensors", quantityRequired: 2, matchMode: "identity", note: null },
  ]);
});

test("an invalid payload is a 400 and never reaches the database", async () => {
  for (const payload of [
    { name: "" },
    { name: "Farm", state: "abandoned" },
    { name: "Farm", requirements: [{ name: "DHT22", category: "Not a category", quantityRequired: 1 }] },
    { name: "Farm", requirements: [{ name: "DHT22", category: "Sensors", quantityRequired: 0 }] },
  ]) {
    const response = await handleProjectCreate(body(payload), { create: refuse });
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
});

test("an invalid requirement names the row that is wrong", async () => {
  const response = await handleProjectPartsReplace(
    body({ requirements: [{ name: "DHT22", category: "Sensors", quantityRequired: 1 }, { name: "", category: "Sensors", quantityRequired: 1 }] }, "PUT"),
    { replace: refuse },
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Requirement 2/);
});

test("a body that is not JSON is a 400, not a 500", async () => {
  const response = await handleProjectCreate(raw("{not json"), { create: refuse });
  assert.equal(response.status, 400);
});

test("a duplicate project name is a 409", async () => {
  const response = await handleProjectCreate(body({ name: "Indoor farm" }), {
    create: async () => {
      throw new DuplicateProjectError("Indoor farm");
    },
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already have a project/);
});

test("a project belonging to someone else is a 404, on every verb", async () => {
  const missing = () => {
    throw new ProjectNotFoundError("project-9");
  };

  assert.equal((await handleProjectRead({ get: async () => missing() })).status, 404);
  assert.equal((await handleProjectUpdate(body({ name: "Mine now" }, "PATCH"), { update: async () => missing() })).status, 404);
  assert.equal((await handleProjectDelete({ remove: async () => missing() })).status, 404);
  assert.equal((await handleProjectPartsReplace(body({ requirements: [] }, "PUT"), { replace: async () => missing() })).status, 404);
});

test("a partial update only carries the fields that were sent", async () => {
  let received;
  const response = await handleProjectUpdate(body({ nextStep: null, state: "built" }, "PATCH"), {
    update: async (changes) => {
      received = changes;
      return plan;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, { state: "built", nextStep: null });
});

test("deleting reports the deletion", async () => {
  const response = await handleProjectDelete({ remove: async () => ({ deleted: true, id: "project-1" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, id: "project-1" });
});

test("the shopping list passes an explicit selection through and defaults to everything", async () => {
  let received = "unset";
  const build = async (ids) => {
    received = ids;
    return { entries: [], totalUnits: 0 };
  };

  await handleShoppingList(new Request("http://test/api/projects/shopping-list?ids=a,,b"), { build });
  assert.deepEqual(received, ["a", "b"]);

  await handleShoppingList(new Request("http://test/api/projects/shopping-list"), { build });
  assert.equal(received, null);
});

test("template seeding reports what it created and what it skipped", async () => {
  const result = { created: ["Basic Arduino car"], skipped: ["Indoor farm"], projects: [plan] };
  const response = await handleTemplateSeed({ seed: async () => result });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
});
