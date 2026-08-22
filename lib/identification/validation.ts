import type { Alternative, BoundingBox, ConfirmRequest, Detection, ReviewItem } from "./types.ts";

const MAX_ITEMS = 50;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
};
const text = (value: unknown, field: string, max = 120) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} is invalid`);
  return value.trim();
};
const nullableText = (value: unknown, field: string) => value === null || value === "" ? null : text(value, field);
const strings = (value: unknown, field: string, max = 10) => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} is invalid`);
  return value.map((item) => text(item, field, 120));
};
const box = (value: unknown): BoundingBox => {
  const v = object(value);
  const result = { top: Number(v.top), left: Number(v.left), width: Number(v.width), height: Number(v.height) };
  if (Object.values(result).some((n) => !Number.isFinite(n) || n < 0 || n > 1) || result.top + result.height > 1.001 || result.left + result.width > 1.001 || result.width === 0 || result.height === 0) throw new Error("boundingBox is invalid");
  return result;
};

export function normalizeIdentity(value: string) {
  return value.normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").trim().replace(/\s+/g, " ").toLowerCase();
}

function alternatives(value: unknown): Alternative[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error("alternatives is invalid");
  return value.map((candidate) => { const v = object(candidate); return { name: text(v.name, "alternative name"), model: nullableText(v.model, "alternative model") }; });
}

function detection(value: unknown): Detection {
  const v = object(value);
  const quantity = Number(v.quantity); const confidence = Number(v.confidence);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("quantity is invalid");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("confidence is invalid");
  return { name: text(v.name, "name"), model: nullableText(v.model, "model"), category: text(v.category, "category"), quantity, boundingBox: box(v.boundingBox), confidence, visibleMarkings: strings(v.visibleMarkings, "visibleMarkings"), alternatives: alternatives(v.alternatives), description: text(v.description, "description", 500), tags: strings(v.tags, "tags") };
}

export function validateGeminiPayload(value: unknown): Detection[] {
  const detections = object(value).detections;
  if (!Array.isArray(detections) || detections.length > MAX_ITEMS) throw new Error("detections is invalid");
  return detections.map(detection);
}

export function validateConfirmationPayload(value: unknown): ConfirmRequest {
  const v = object(value); const token = text(v.token, "token", 2000);
  if (!Array.isArray(v.items) || v.items.length > MAX_ITEMS) throw new Error("items is invalid");
  const items = v.items.map((raw): ReviewItem => {
    const row = object(raw); const base = detection({ ...row, boundingBox: row.boundingBox ?? { top: 0, left: 0, width: 1, height: 1 }, confidence: row.confidence ?? 0 });
    if (typeof row.id !== "string" || typeof row.accepted !== "boolean" || !["gemini", "manual"].includes(String(row.source))) throw new Error("review item is invalid");
    return { ...base, id: row.id, accepted: row.accepted, source: row.source as "gemini" | "manual", boundingBox: row.boundingBox === null ? null : base.boundingBox, confidence: row.confidence === null ? null : base.confidence, detectedName: row.source === "gemini" ? nullableText(row.detectedName ?? row.name, "detectedName") : null, detectedModel: row.source === "gemini" ? nullableText(row.detectedModel ?? row.model, "detectedModel") : null };
  });
  if (!items.some((item) => item.accepted)) throw new Error("At least one item must be accepted");
  return { token, items };
}
