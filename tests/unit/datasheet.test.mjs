import assert from "node:assert/strict";
import test from "node:test";
import { datasheetQuery, datasheetSearchUrl } from "../../lib/parts/datasheet.ts";

test("a confirmed model is what the search asks for", () => {
  assert.equal(datasheetQuery({ name: "ESP32 Camera Board", model: "ESP32-CAM" }), "ESP32-CAM datasheet");
  assert.equal(
    datasheetSearchUrl({ name: "ESP32 Camera Board", model: "ESP32-CAM" }),
    "https://www.google.com/search?q=ESP32-CAM%20datasheet",
  );
});

test("a part with no model falls back to its name", () => {
  assert.equal(datasheetQuery({ name: "PIR Motion Sensor", model: null }), "PIR Motion Sensor datasheet");
  assert.equal(datasheetQuery({ name: "PIR Motion Sensor", model: "   " }), "PIR Motion Sensor datasheet");
});

test("stray whitespace never reaches the query string", () => {
  assert.equal(datasheetQuery({ name: "x", model: "  L298N\n  Motor  " }), "L298N Motor datasheet");
});

test("awkward characters are escaped rather than breaking the URL", () => {
  const url = datasheetSearchUrl({ name: "Relay & Socket", model: "SRD-05VDC-SL-C #2" });
  assert.equal(url, "https://www.google.com/search?q=SRD-05VDC-SL-C%20%232%20datasheet");
  assert.equal(new URL(url).searchParams.get("q"), "SRD-05VDC-SL-C #2 datasheet");
});

test("a part with nothing to search for gets no link at all", () => {
  assert.equal(datasheetQuery({ name: "   ", model: null }), null);
  assert.equal(datasheetSearchUrl({ name: "", model: "" }), null);
});
