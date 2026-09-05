import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURE_MAX_EDGE,
  cameraSupport,
  captureSize,
  describeCameraError,
  nextCameraId,
} from "../../lib/identification/camera.ts";

test("a secure page with a camera API can open the camera", () => {
  assert.deepEqual(
    cameraSupport({ secure: true, hasMediaDevices: true, host: "cabinet.example" }),
    { available: true },
  );
});

test("plain http at a LAN address asks for HTTPS, not for a different browser", () => {
  // The self-hosting trap, verified in a real browser: Chromium does not merely
  // refuse the camera on an insecure origin, it deletes navigator.mediaDevices.
  // So the absent API must not out-rank the reason it is absent, or someone on
  // http://192.168.1.10:3000 is told to change browsers instead of to add TLS.
  for (const hasMediaDevices of [true, false]) {
    const support = cameraSupport({ secure: false, hasMediaDevices, host: "192.168.1.10" });

    assert.equal(support.available, false);
    assert.match(support.reason, /HTTPS/, `mediaDevices present: ${hasMediaDevices}`);
  }
});

test("loopback is exempt, so local development still works over http", () => {
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    assert.equal(cameraSupport({ secure: false, hasMediaDevices: true, host }).available, true, host);
  }
});

test("a secure page whose browser lacks the API says so plainly", () => {
  const support = cameraSupport({ secure: true, hasMediaDevices: false, host: "cabinet.example" });

  assert.equal(support.available, false);
  assert.match(support.reason, /cannot open a camera/);
});

test("each way the camera can fail names its own remedy", () => {
  assert.match(describeCameraError({ name: "NotAllowedError" }), /site settings/);
  assert.match(describeCameraError({ name: "NotFoundError" }), /No camera was found/);
  assert.match(describeCameraError({ name: "NotReadableError" }), /already in use/);
  assert.match(describeCameraError(new Error("something else")), /could not be opened/);
  assert.match(describeCameraError(null), /could not be opened/);
});

test("switching cycles the cameras and stops at one", () => {
  const devices = [{ deviceId: "back" }, { deviceId: "front" }];

  assert.equal(nextCameraId(devices, "back"), "front");
  assert.equal(nextCameraId(devices, "front"), "back", "the switch wraps rather than dead-ending");
  assert.equal(nextCameraId(devices, "unknown"), "back", "an unrecognised camera starts the cycle");
  assert.equal(nextCameraId([{ deviceId: "only" }], "only"), null);
  assert.equal(nextCameraId([], ""), null);
});

test("a frame is scaled to the capture budget without distorting it", () => {
  const landscape = captureSize(4032, 3024);
  assert.equal(landscape.width, CAPTURE_MAX_EDGE);
  assert.equal(landscape.height, Math.round(3024 * (CAPTURE_MAX_EDGE / 4032)));
  assert.ok(Math.abs(landscape.width / landscape.height - 4032 / 3024) < 0.01, "the aspect ratio should survive");

  const portrait = captureSize(1080, 2400);
  assert.equal(portrait.height, CAPTURE_MAX_EDGE, "the long edge is capped whichever way up the phone is");

  assert.deepEqual(captureSize(640, 480), { width: 640, height: 480 }, "a small frame is left alone");
  assert.deepEqual(captureSize(0, 0), { width: 1, height: 1 }, "a frame with no dimensions still makes a canvas");
});
