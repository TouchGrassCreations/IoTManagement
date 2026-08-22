import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCategory, normalizeIdentity, validateConfirmationPayload, validateGeminiPayload } from "../lib/identification/validation.ts";

const sample = {
  name: "PIR motion sensor", model: null, category: "Sensors", quantity: 2,
  boundingBox: { top: 0.1, left: 0.2, width: 0.3, height: 0.4 },
  confidence: 0.72, visibleMarkings: ["HC-SR501"], alternatives: [],
  description: "Passive infrared motion module", tags: ["motion", "5V"],
};

test("normalizes identity without erasing model punctuation", () => {
  assert.equal(normalizeIdentity("  ESP32–CAM   AI-Thinker "), "esp32-cam ai-thinker");
});

test("accepts a bounded multi-detection response", () => {
  assert.equal(validateGeminiPayload({ detections: [sample] })[0].quantity, 2);
});

test("rejects impossible quantities and coordinates", () => {
  assert.throws(() => validateGeminiPayload({ detections: [{ ...sample, quantity: 0 }] }), /quantity/);
  assert.throws(() => validateGeminiPayload({ detections: [{ ...sample, boundingBox: { top: -1, left: 0, width: 2, height: 1 } }] }), /boundingBox/);
});

test("validates edited confirmation rows", () => {
  const payload = validateConfirmationPayload({ token: "signed-token", items: [{ ...sample, name: "HC-SR501 PIR sensor", detectedName: "PIR motion sensor", detectedModel: null, id: "row-1", accepted: true, source: "gemini" }] });
  assert.equal(payload.items[0].model, null);
  assert.equal(payload.items[0].detectedName, "PIR motion sensor");
});

test("ignores rejected incomplete rows during confirmation", () => {
  const payload = validateConfirmationPayload({ token: "signed-token", items: [
    { ...sample, id: "accepted", accepted: true, source: "gemini" },
    { ...sample, id: "rejected", accepted: false, source: "manual", name: "" },
  ] });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, "accepted");
});

test("identifies the component with an invalid name", () => {
  assert.throws(() => validateConfirmationPayload({ token: "signed-token", items: [
    { ...sample, id: "first", accepted: true, source: "gemini" },
    { ...sample, id: "second", accepted: true, source: "manual", name: "" },
  ] }), /Component 2: Name is required/);
});

test("normalizes provider categories to inventory categories", () => {
  assert.equal(normalizeCategory("sensor"), "Sensors");
  assert.equal(normalizeCategory("ESP32-CAM development board"), "Cameras & Vision");
  assert.equal(normalizeCategory("ESP32 development board"), "Microcontrollers & Compute");
  assert.equal(normalizeCategory("display module"), "Displays & Indicators");
  assert.equal(normalizeCategory("jumper cables"), "Wiring & Connectors");
  assert.equal(normalizeCategory("breadboard"), "Prototyping & PCB");
  assert.equal(normalizeCategory("18650 battery"), "Power Sources");
  assert.equal(normalizeCategory("buck converter"), "Power Management");
  assert.equal(normalizeCategory("sensor board"), "Sensors");
  assert.equal(normalizeCategory("motor driver board"), "Motor Drivers & Power Drivers");
  assert.equal(normalizeCategory("mystery object"), "Others");
});
