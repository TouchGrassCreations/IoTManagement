import { INVENTORY_CATEGORIES } from "../identification/validation.ts";
import type { UpdateInventoryInput } from "./types.ts";

export class InvalidInventoryPayloadError extends Error {
  code = "INVALID_PAYLOAD" as const;
  constructor(message: string) {
    super(message);
  }
}

function optionalText(
  raw: Record<string, unknown>,
  field: string,
  label: string,
  max: number,
): string | undefined {
  if (!(field in raw) || raw[field] === undefined) return undefined;
  const value = raw[field];
  if (typeof value !== "string" || !value.trim()) throw new InvalidInventoryPayloadError(`${label} is required.`);
  if (value.length > max) throw new InvalidInventoryPayloadError(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}

/**
 * Parses an edit payload. Absent fields are left untouched rather than cleared,
 * so a partial update never silently wipes a description or a tag list.
 */
export function parseInventoryEdit(id: string, body: unknown): UpdateInventoryInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InvalidInventoryPayloadError("The edit payload is not valid.");
  }
  const raw = body as Record<string, unknown>;

  const expectedCurrentQuantity = raw.expectedCurrentQuantity;
  if (!Number.isInteger(expectedCurrentQuantity) || (expectedCurrentQuantity as number) < 1) {
    throw new InvalidInventoryPayloadError("The current stock level is required to detect a conflicting edit.");
  }

  const input: UpdateInventoryInput = { id, expectedCurrentQuantity: expectedCurrentQuantity as number };

  const name = optionalText(raw, "name", "Name", 120);
  if (name !== undefined) input.name = name;

  if ("model" in raw && raw.model !== undefined) {
    const model = raw.model;
    if (model === null || model === "") input.model = null;
    else if (typeof model !== "string") throw new InvalidInventoryPayloadError("Model is not valid.");
    else if (model.length > 120) throw new InvalidInventoryPayloadError("Model must be 120 characters or fewer.");
    else input.model = model.trim();
  }

  const category = optionalText(raw, "category", "Category", 120);
  if (category !== undefined) {
    if (!INVENTORY_CATEGORIES.includes(category as (typeof INVENTORY_CATEGORIES)[number])) {
      throw new InvalidInventoryPayloadError("Category is not one of the known categories.");
    }
    input.category = category;
  }

  const location = optionalText(raw, "location", "Storage location", 120);
  if (location !== undefined) input.location = location;

  if ("description" in raw && raw.description !== undefined) {
    const description = raw.description;
    if (typeof description !== "string") throw new InvalidInventoryPayloadError("Description is not valid.");
    if (description.length > 500) throw new InvalidInventoryPayloadError("Description must be 500 characters or fewer.");
    input.description = description.trim();
  }

  if ("tags" in raw && raw.tags !== undefined) {
    const tags = raw.tags;
    if (!Array.isArray(tags) || tags.length > 10) throw new InvalidInventoryPayloadError("Tags are not valid.");
    input.tags = tags.map((tag) => {
      if (typeof tag !== "string" || !tag.trim()) throw new InvalidInventoryPayloadError("Tags are not valid.");
      if (tag.length > 120) throw new InvalidInventoryPayloadError("Each tag must be 120 characters or fewer.");
      return tag.trim();
    });
  }

  if ("quantityDelta" in raw && raw.quantityDelta !== undefined) {
    const delta = raw.quantityDelta;
    if (!Number.isInteger(delta)) throw new InvalidInventoryPayloadError("Stock change must be a whole number.");
    if (Math.abs(delta as number) > 999_999) throw new InvalidInventoryPayloadError("Stock change is unrealistically large.");
    input.quantityDelta = delta as number;
  }

  return input;
}
