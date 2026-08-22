import assert from "node:assert/strict";
import test from "node:test";
import { handleIdentifyRequest } from "../app/api/identify/route.ts";
import { handleConfirmRequest } from "../app/api/identify/confirm/route.ts";

const sample = { name: "HC-SR04 ultrasonic sensor", model: "HC-SR04", category: "Sensors", quantity: 1, boundingBox: { top: .1, left: .1, width: .3, height: .2 }, confidence: .93, visibleMarkings: ["HC-SR04"], alternatives: [], description: "Ultrasonic distance sensor", tags: ["distance", "5V"] };

function imageRequest(type = "image/png") {
  const form = new FormData();
  form.set("image", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "parts.png", { type }));
  return new Request("http://test/api/identify", { method: "POST", body: form });
}

test("returns provisional detections without image data", async () => {
  const response = await handleIdentifyRequest(imageRequest(), { recognize: async () => [sample], issueToken: async () => "signed-token" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { detections: [sample], token: "signed-token" });
  assert.doesNotMatch(JSON.stringify(payload), /iVBOR/);
});

test("rejects unsupported image content", async () => {
  const response = await handleIdentifyRequest(imageRequest("text/plain"), { recognize: async () => [], issueToken: async () => "unused" });
  assert.equal(response.status, 400);
});

test("maps provider failures without returning a token", async () => {
  const response = await handleIdentifyRequest(imageRequest(), { recognize: async () => { throw new Error("Gemini quota exceeded"); }, issueToken: async () => { throw new Error("must not run"); } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Identification is temporarily unavailable. Please retry." });
});

test("confirmation persists only accepted reviewed rows", async () => {
  let received;
  const response = await handleConfirmRequest(new Request("http://test/api/identify/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "signed-token", items: [{ ...sample, id: "one", accepted: true, source: "gemini" }, { ...sample, id: "two", accepted: false, source: "gemini" }] }) }), { confirm: async (input) => { received = input; return { scanId: "scan-1", inventory: [{ id: "part-1", ...sample }] }; } });
  assert.equal(response.status, 200);
  assert.equal(received.items.filter((item) => item.accepted).length, 1);
  assert.equal((await response.json()).scanId, "scan-1");
});
