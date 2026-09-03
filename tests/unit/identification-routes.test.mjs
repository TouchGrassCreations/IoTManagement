import assert from "node:assert/strict";
import test from "node:test";
import { handleIdentifyRequest } from "../../app/api/identify/route.ts";
import { handleConfirmRequest } from "../../app/api/identify/confirm/route.ts";
import { handleIdentifyTokenRequest } from "../../app/api/identify/token/route.ts";
import { recognizeComponents } from "../../lib/identification/gemini.ts";

const sample = { name: "HC-SR04 ultrasonic sensor", model: "HC-SR04", category: "Sensors", quantity: 1, boundingBox: { top: .1, left: .1, width: .3, height: .2 }, confidence: .93, visibleMarkings: ["HC-SR04"], alternatives: [], description: "Ultrasonic distance sensor", tags: ["distance", "5V"] };

function imageRequest(type = "image/png") {
  const form = new FormData();
  form.set("image", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "parts.png", { type }));
  return new Request("http://test/api/identify", { method: "POST", body: form });
}

test("returns provisional detections without image data", async () => {
  const response = await handleIdentifyRequest(imageRequest(), { enforceRateLimit: async () => {}, recognize: async () => [sample], issueToken: async () => "signed-token" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { detections: [sample], token: "signed-token" });
  assert.doesNotMatch(JSON.stringify(payload), /iVBOR/);
});

test("rejects unsupported image content", async () => {
  const response = await handleIdentifyRequest(imageRequest("text/plain"), { enforceRateLimit: async () => {}, recognize: async () => [], issueToken: async () => "unused" });
  assert.equal(response.status, 400);
});

test("maps provider failures without returning a token", async () => {
  const response = await handleIdentifyRequest(imageRequest(), { enforceRateLimit: async () => {}, recognize: async () => { throw new Error("Gemini quota exceeded"); }, issueToken: async () => { throw new Error("must not run"); } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Identification is temporarily unavailable. Please retry." });
});

test("uses JSON mode without an over-complex provider schema", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  let requestBody;
  let requestInit;
  try {
    const result = await recognizeComponents({
      bytes: new Uint8Array([1]),
      mimeType: "image/png",
      fetchImpl: async (_url, init) => {
        requestInit = init;
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detections: [{ ...sample, boundingBox: { top: 100, left: 200, width: 300, height: 400 } }] }) }] } }] }), { status: 200 });
      },
    });
    assert.deepEqual(result[0].boundingBox, { top: .1, left: .2, width: .3, height: .4 });
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }

  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
  assert.equal(requestInit.cache, "no-store");
  assert.equal(requestBody.generationConfig.responseJsonSchema, undefined);
  assert.match(requestBody.contents[0].parts[0].text, /boundingBox/);
  assert.match(requestBody.contents[0].parts[0].text, /alternatives/);
  assert.match(requestBody.contents[0].parts[0].text, /ESP32-CAM/i);
  assert.match(requestBody.contents[0].parts[0].text, /one component/i);
  assert.match(requestBody.contents[0].parts[0].text, /quantity.*actual count/i);
  assert.match(requestBody.contents[0].parts[0].text, /Microcontrollers & Compute/);
  assert.match(requestBody.contents[0].parts[0].text, /Storage \/ Spare Parts/);
  assert.match(requestBody.contents[0].parts[0].text, /Others/);
  assert.match(requestBody.contents[0].parts[0].text, /edge|corner/i);
  assert.match(requestBody.contents[0].parts[0].text, /partially visible|cropped/i);
  assert.match(requestBody.contents[0].parts[0].text, /mecanum wheel/i);
  assert.match(requestBody.contents[0].parts[0].text, /aluminum.*chassis/i);
  assert.match(requestBody.contents[0].parts[0].text, /do not infer.*hidden/i);
});

test("clamps Gemini bounding boxes that extend beyond the image", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const result = await recognizeComponents({
      bytes: new Uint8Array([1]), mimeType: "image/png",
      fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detections: [{ ...sample, boundingBox: { top: 800, left: 700, width: 400, height: 300 } }] }) }] } }] }), { status: 200 }),
    });
    assert.deepEqual(result[0].boundingBox, { top: .8, left: .7, width: .3, height: .2 });
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("does not rescale an already-normalized overflowing box", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const result = await recognizeComponents({
      bytes: new Uint8Array([1]), mimeType: "image/png",
      fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detections: [{ ...sample, boundingBox: { top: .2, left: .2, width: 1.1, height: .4 } }] }) }] } }] }), { status: 200 }),
    });
    assert.deepEqual(result[0].boundingBox, { top: .2, left: .2, width: .8, height: .4 });
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("normalizes a tiny integer 0-1000 box near an image edge", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const result = await recognizeComponents({
      bytes: new Uint8Array([1]), mimeType: "image/png",
      fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detections: [{ ...sample, boundingBox: { top: 2, left: 3, width: 4, height: 5 } }] }) }] } }] }), { status: 200 }),
    });
    assert.deepEqual(result[0].boundingBox, { top: .002, left: .003, width: .004, height: .005 });
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("confirmation persists only accepted reviewed rows", async () => {
  let received;
  const response = await handleConfirmRequest(new Request("http://test/api/identify/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "signed-token", items: [{ ...sample, id: "one", accepted: true, source: "gemini" }, { ...sample, id: "two", accepted: false, source: "gemini" }] }) }), { confirm: async (input) => { received = input; return { scanId: "scan-1", inventory: [{ id: "part-1", ...sample }] }; } });
  assert.equal(response.status, 200);
  assert.equal(received.items.filter((item) => item.accepted).length, 1);
  assert.equal((await response.json()).scanId, "scan-1");
});

test("issues a confirmation token for a manual-only batch", async () => {
  const response = await handleIdentifyTokenRequest({ issueToken: async () => "signed-token" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: "signed-token" });
});

test("surfaces an unconfigured token secret instead of a token", async () => {
  const response = await handleIdentifyTokenRequest({ issueToken: async () => { throw new Error("Confirmation token secret is not configured"); } });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /not configured/);
});

test("confirmation forwards the cropped photo of each reviewed part", async () => {
  let received;
  const photo = `data:image/webp;base64,${"A".repeat(80)}`;
  await handleConfirmRequest(new Request("http://test/api/identify/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "signed-token", items: [{ ...sample, id: "one", accepted: true, source: "gemini", image: photo, location: "Bin B3" }] }) }), { confirm: async (input) => { received = input; return { scanId: "scan-1", inventory: [] }; } });
  assert.equal(received.items[0].image, photo);
  assert.equal(received.items[0].location, "Bin B3");
});
