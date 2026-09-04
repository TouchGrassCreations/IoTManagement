import { INVENTORY_CATEGORIES } from "../identification/validation.ts";
import {
  MATCH_MODES,
  PROJECT_ACCENTS,
  PROJECT_STATES,
  type CreateProjectInput,
  type MatchMode,
  type ProjectAccent,
  type ProjectState,
  type RequirementInput,
  type UpdateProjectInput,
} from "./types.ts";

const MAX_REQUIREMENTS = 60;
const MAX_SELECTED_PROJECTS = 100;
const MAX_QUANTITY = 999;

export class InvalidProjectPayloadError extends Error {
  code = "INVALID_PAYLOAD" as const;
  constructor(message: string) {
    super(message);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidProjectPayloadError(`${label} is not valid.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidProjectPayloadError(`${label} is required.`);
  if (value.length > max) throw new InvalidProjectPayloadError(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}

function nullableText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, label, max);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  const candidate = text(value, label, 40);
  if (!options.includes(candidate as T)) throw new InvalidProjectPayloadError(`${label} is not recognised.`);
  return candidate as T;
}

function category(value: unknown): string {
  const candidate = text(value, "Category", 120);
  if (!INVENTORY_CATEGORIES.includes(candidate as (typeof INVENTORY_CATEGORIES)[number])) {
    throw new InvalidProjectPayloadError("Category is not one of the known categories.");
  }
  return candidate;
}

function requirement(value: unknown, index: number): RequirementInput {
  try {
    const row = object(value, "The requirement");
    const quantity = row.quantityRequired;
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_QUANTITY) {
      throw new InvalidProjectPayloadError(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    return {
      name: text(row.name, "Part name", 120),
      model: nullableText(row.model, "Model", 120),
      category: category(row.category),
      quantityRequired: quantity as number,
      matchMode: row.matchMode === undefined ? "identity" : oneOf<MatchMode>(row.matchMode, MATCH_MODES, "Match mode"),
      note: nullableText(row.note, "Note", 500),
    };
  } catch (error) {
    throw new InvalidProjectPayloadError(`Requirement ${index + 1}: ${error instanceof Error ? error.message : "is not valid."}`);
  }
}

export function parseRequirementList(value: unknown): RequirementInput[] {
  if (!Array.isArray(value)) throw new InvalidProjectPayloadError("The requirement list is not valid.");
  if (value.length > MAX_REQUIREMENTS) {
    throw new InvalidProjectPayloadError(`A project can hold at most ${MAX_REQUIREMENTS} requirements.`);
  }
  return value.map(requirement);
}

export function parseRequirementPayload(body: unknown): RequirementInput[] {
  const raw = object(body, "The requirement payload");
  return parseRequirementList(raw.requirements);
}

export function parseProjectCreate(body: unknown): CreateProjectInput {
  const raw = object(body, "The project payload");
  return {
    name: text(raw.name, "Project name", 120),
    summary: raw.summary === undefined || raw.summary === null ? "" : text(raw.summary, "Summary", 500),
    state: raw.state === undefined ? "planned" : oneOf<ProjectState>(raw.state, PROJECT_STATES, "State"),
    accent: raw.accent === undefined ? "green" : oneOf<ProjectAccent>(raw.accent, PROJECT_ACCENTS, "Accent"),
    icon: raw.icon === undefined ? "PRJ" : text(raw.icon, "Icon", 6).toUpperCase(),
    nextStep: nullableText(raw.nextStep, "Next step", 120),
    requirements: raw.requirements === undefined ? [] : parseRequirementList(raw.requirements),
  };
}

/**
 * Absent fields stay as they are; only what the client sent is written, so a
 * partial edit never blanks a summary the form did not show.
 */
export function parseProjectUpdate(body: unknown): UpdateProjectInput {
  const raw = object(body, "The project payload");
  const input: UpdateProjectInput = {};

  if (raw.name !== undefined) input.name = text(raw.name, "Project name", 120);
  if (raw.summary !== undefined) input.summary = raw.summary === null ? "" : text(raw.summary, "Summary", 500);
  if (raw.state !== undefined) input.state = oneOf<ProjectState>(raw.state, PROJECT_STATES, "State");
  if (raw.accent !== undefined) input.accent = oneOf<ProjectAccent>(raw.accent, PROJECT_ACCENTS, "Accent");
  if (raw.icon !== undefined) input.icon = text(raw.icon, "Icon", 6).toUpperCase();
  if ("nextStep" in raw) input.nextStep = nullableText(raw.nextStep, "Next step", 120);

  return input;
}

/** Reads the optional `ids` filter on the shopping list, ignoring empty entries. */
export function parseProjectIds(url: URL): string[] | null {
  const raw = url.searchParams.get("ids");
  if (raw === null) return null;
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > MAX_SELECTED_PROJECTS) throw new InvalidProjectPayloadError("Too many projects were selected.");
  return ids;
}
