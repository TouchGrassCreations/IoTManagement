/**
 * The rules around opening a device camera, kept out of the component so they
 * can be tested without a browser.
 *
 * Two of them decide whether the button is offered at all, and both bite on a
 * self-hosted install: `getUserMedia` exists only in a secure context, so a
 * cabinet reached over plain http at a LAN address cannot open a camera no
 * matter how many permissions the visitor grants.
 */

export type CameraSupport = { available: true } | { available: false; reason: string };

export type CameraEnvironment = {
  secure: boolean;
  hasMediaDevices: boolean;
  /** Loopback is exempt from the secure-context rule, which is why dev works. */
  host?: string;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function cameraSupport(environment: CameraEnvironment): CameraSupport {
  // The insecure-origin check comes first because it is the cause, not a
  // second symptom: a browser on plain http does not merely refuse the camera,
  // it deletes `navigator.mediaDevices`. Reporting that as "this browser
  // cannot open a camera" would send someone to change browsers when what they
  // need is a certificate.
  if (!environment.secure && !LOOPBACK.has(environment.host ?? "")) {
    return {
      available: false,
      reason: "Cameras need a secure connection. Open this site over HTTPS, or choose a photo instead.",
    };
  }
  if (!environment.hasMediaDevices) {
    return { available: false, reason: "This browser cannot open a camera. Choose a photo instead." };
  }
  return { available: true };
}

/**
 * Turns the browser's exception into something worth reading. `getUserMedia`
 * reports refusal, absence and hardware contention as three different names,
 * and the fix differs for each.
 */
export function describeCameraError(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow it in your browser's site settings, or choose a photo instead.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device. Choose a photo instead.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is already in use by another app. Close it and try again.";
    default:
      return "The camera could not be opened. Choose a photo instead.";
  }
}

/**
 * The next camera to try, so one button cycles front and back without needing
 * to know which is which. Returns null when there is nothing to switch to.
 */
export function nextCameraId(devices: Array<{ deviceId: string }>, currentId: string): string | null {
  if (devices.length < 2) return null;
  const index = devices.findIndex((device) => device.deviceId === currentId);
  return devices[(index + 1) % devices.length]?.deviceId ?? null;
}

/** Long edge for a capture. Big enough to read chip markings, small enough to upload. */
export const CAPTURE_MAX_EDGE = 1920;
export const CAPTURE_QUALITY = 0.92;

/** Fits a frame inside the capture budget without distorting it. */
export function captureSize(width: number, height: number, maxEdge = CAPTURE_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return { width: Math.max(1, width), height: Math.max(1, height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
