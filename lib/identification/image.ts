import type { BoundingBox } from "./types.ts";

/** Thumbnails live inside a D1 row, so they stay well below the 1 MB value ceiling. */
export const PART_IMAGE_MAX_CHARACTERS = 160_000;
export const PART_IMAGE_MAX_EDGE = 320;
export const PART_IMAGE_CROP_PADDING = 0.08;
const PART_IMAGE_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export type PixelRect = { left: number; top: number; width: number; height: number };

export function validatePartImage(value: unknown, field = "Photo"): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  if (value.length > PART_IMAGE_MAX_CHARACTERS) throw new Error(`${field} is too large — use a smaller photo`);
  const [, payload = ""] = value.split(",");
  if (!PART_IMAGE_PATTERN.test(value) || payload.length % 4 !== 0) throw new Error(`${field} must be a JPG, PNG, or WebP image`);
  return value;
}

/**
 * Turns a normalized detection box into a pixel crop, padded for context and
 * clamped to the photo so a part touching an edge still yields a usable tile.
 */
export function cropRectFromBox(box: BoundingBox, imageWidth: number, imageHeight: number, padding = PART_IMAGE_CROP_PADDING): PixelRect {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth < 1 || imageHeight < 1) throw new Error("Image dimensions are invalid");
  const left = Math.max(0, box.left - box.width * padding);
  const top = Math.max(0, box.top - box.height * padding);
  const right = Math.min(1, box.left + box.width * (1 + padding));
  const bottom = Math.min(1, box.top + box.height * (1 + padding));
  const rect = {
    left: Math.floor(left * imageWidth),
    top: Math.floor(top * imageHeight),
    width: Math.round((right - left) * imageWidth),
    height: Math.round((bottom - top) * imageHeight),
  };
  return {
    left: Math.min(rect.left, imageWidth - 1),
    top: Math.min(rect.top, imageHeight - 1),
    width: Math.max(1, Math.min(rect.width, imageWidth - Math.min(rect.left, imageWidth - 1))),
    height: Math.max(1, Math.min(rect.height, imageHeight - Math.min(rect.top, imageHeight - 1))),
  };
}

/** Scales a crop down to the thumbnail budget without ever upscaling it. */
export function thumbnailSize(width: number, height: number, maxEdge = PART_IMAGE_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
