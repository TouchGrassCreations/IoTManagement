import assert from "node:assert/strict";
import test from "node:test";
import { handleCabinetRead, handleCabinetUpdate } from "../../app/api/cabinet/route.ts";
import { OwnerRequiredError } from "../../lib/auth/owner.ts";

const cabinet = { ownerId: "owner-1", label: "ada@example.com", visibility: "private" };
const patch = (body) =>
  new Request("http://test/api/cabinet", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET returns the owner's cabinet", async () => {
  const response = await handleCabinetRead({ load: async () => cabinet });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cabinet });
});

test("GET refuses a visitor with no cabinet of their own", async () => {
  const response = await handleCabinetRead({ load: async () => { throw new OwnerRequiredError(); } });
  assert.equal(response.status, 401);
});

test("PATCH stores a valid visibility", async () => {
  let received;
  const response = await handleCabinetUpdate(patch({ visibility: "public" }), {
    save: async (visibility) => { received = visibility; return { ...cabinet, visibility }; },
  });
  assert.equal(response.status, 200);
  assert.equal(received, "public");
  assert.equal((await response.json()).cabinet.visibility, "public");
});

test("PATCH rejects anything but private or public", async () => {
  const refuse = async () => { throw new Error("must not run"); };
  for (const body of [{ visibility: "unlisted" }, { visibility: true }, {}]) {
    assert.equal((await handleCabinetUpdate(patch(body), { save: refuse })).status, 400, JSON.stringify(body));
  }
});

test("PATCH refuses an anonymous visitor", async () => {
  const response = await handleCabinetUpdate(patch({ visibility: "public" }), {
    save: async () => { throw new OwnerRequiredError(); },
  });
  assert.equal(response.status, 401);
});
