import assert from "node:assert/strict";
import test from "node:test";
import { PART_IMAGE_MAX_CHARACTERS, cropRectFromBox, thumbnailSize, validatePartImage } from "../lib/identification/image.ts";
import { partCode } from "../lib/identification/validation.ts";

const box = { top: 0.25, left: 0.25, width: 0.5, height: 0.5 };

test("accepts inline part photos and refuses anything else", () => {
  const photo = `data:image/webp;base64,${"A".repeat(120)}`;
  assert.equal(validatePartImage(photo), photo);
  assert.equal(validatePartImage(null), null);
  assert.equal(validatePartImage(""), null);
  assert.throws(() => validatePartImage("https://example.com/part.png"), /JPG, PNG, or WebP/);
  assert.throws(() => validatePartImage("data:text/html;base64,AAAA"), /JPG, PNG, or WebP/);
  assert.throws(() => validatePartImage("data:image/webp;base64,AAA=A"), /JPG, PNG, or WebP/);
  assert.throws(() => validatePartImage(`data:image/webp;base64,${"A".repeat(PART_IMAGE_MAX_CHARACTERS)}`), /too large/);
});

test("pads a detection crop without leaving the photo", () => {
  const rect = cropRectFromBox(box, 1000, 1000);
  assert.deepEqual(rect, { left: 210, top: 210, width: 580, height: 580 });
  const corner = cropRectFromBox({ top: 0, left: 0, width: 0.2, height: 0.2 }, 800, 600);
  assert.equal(corner.left, 0);
  assert.equal(corner.top, 0);
  assert.ok(corner.left + corner.width <= 800 && corner.top + corner.height <= 600);
});

test("keeps an edge-cropped part inside the photo bounds", () => {
  const edge = cropRectFromBox({ top: 0.9, left: 0.92, width: 0.1, height: 0.1 }, 640, 480);
  assert.ok(edge.left + edge.width <= 640, "crop stays within the width");
  assert.ok(edge.top + edge.height <= 480, "crop stays within the height");
  assert.ok(edge.width >= 1 && edge.height >= 1, "crop keeps a usable size");
  assert.throws(() => cropRectFromBox(box, 0, 100), /Image dimensions/);
});

test("scales thumbnails down to the tile budget but never up", () => {
  assert.deepEqual(thumbnailSize(1600, 800), { width: 320, height: 160 });
  assert.deepEqual(thumbnailSize(90, 40), { width: 90, height: 40 });
  assert.deepEqual(thumbnailSize(1000, 1000, 200), { width: 200, height: 200 });
});

test("labels a card from the confirmed model", () => {
  assert.equal(partCode("HC-SR04"), "HC-SR04");
  assert.equal(partCode("ESP32 DevKit v1"), "ESP32-DEVKIT-V");
  assert.equal(partCode("  bmp280  "), "BMP280");
  assert.equal(partCode(null), "MODEL-UNKNOWN");
  assert.equal(partCode("!!!"), "MODEL-UNKNOWN");
});
