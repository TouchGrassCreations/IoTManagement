"use client";

import { PART_IMAGE_MAX_CHARACTERS, PART_IMAGE_MAX_EDGE, cropRectFromBox, thumbnailSize, type PixelRect } from "./image.ts";
import type { BoundingBox } from "./types.ts";

const QUALITY_LADDER = [0.75, 0.6, 0.45];
const EDGE_LADDER = [PART_IMAGE_MAX_EDGE, 224, 160];
const WHOLE_IMAGE: BoundingBox = { top: 0, left: 0, width: 1, height: 1 };

function encode(canvas: HTMLCanvasElement, quality: number) {
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}

function draw(source: CanvasImageSource, rect: PixelRect, maxEdge: number) {
  const size = thumbnailSize(rect.width, rect.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, rect.left, rect.top, rect.width, rect.height, 0, 0, size.width, size.height);
  return canvas;
}

/** Encodes the smallest tile that still reads clearly and fits the D1 budget. */
function toDataUrl(source: CanvasImageSource, rect: PixelRect) {
  for (const edge of EDGE_LADDER) {
    const canvas = draw(source, rect, edge);
    if (!canvas) return null;
    for (const quality of QUALITY_LADDER) {
      const encoded = encode(canvas, quality);
      if (encoded.length <= PART_IMAGE_MAX_CHARACTERS) return encoded;
    }
  }
  return null;
}

async function decode(file: File) {
  if (typeof document === "undefined") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

/**
 * Crops one tile per detection from the photo the user just analyzed, so every
 * component lands in the cabinet with a picture of the part itself.
 */
export async function cropDetections(file: File, boxes: Array<BoundingBox | null>): Promise<Array<string | null>> {
  const bitmap = await decode(file);
  if (!bitmap) return boxes.map(() => null);
  try {
    return boxes.map((box) => {
      try {
        return toDataUrl(bitmap, cropRectFromBox(box ?? WHOLE_IMAGE, bitmap.width, bitmap.height));
      } catch {
        return null;
      }
    });
  } finally {
    bitmap.close();
  }
}

/** Downscales a whole photo for parts catalogued without a detection box. */
export async function thumbnailFromFile(file: File): Promise<string | null> {
  const bitmap = await decode(file);
  if (!bitmap) return null;
  try {
    return toDataUrl(bitmap, cropRectFromBox(WHOLE_IMAGE, bitmap.width, bitmap.height, 0));
  } finally {
    bitmap.close();
  }
}
