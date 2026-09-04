/**
 * Readiness, missing lists and shopping lists, as pure functions over a
 * project's requirements and a snapshot of the owner's inventory. Nothing here
 * touches the database, so the arithmetic the planner is judged on is testable
 * on its own.
 */

import { normalizeIdentity } from "../identification/validation.ts";
import type {
  InventorySnapshotRow,
  Project,
  ProjectPlan,
  ProjectReadiness,
  ProjectRequirement,
  RequirementMatch,
  ShoppingList,
  ShoppingListEntry,
} from "./types.ts";

export const UNKNOWN_MODEL_KEY = "__unknown__";

/** The catalogue's key, so "you own this" means what "this merged into that row" means. */
export function modelKeyFor(model: string | null): string {
  return model ? normalizeIdentity(model) : UNKNOWN_MODEL_KEY;
}

function identityKey(normalizedName: string, modelKey: string): string {
  return `${normalizedName} :: ${modelKey}`;
}

type InventoryIndex = { byIdentity: Map<string, number>; byCategory: Map<string, number> };

export function indexInventory(rows: InventorySnapshotRow[]): InventoryIndex {
  const byIdentity = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const quantity = Math.max(0, row.quantity);
    const key = identityKey(row.normalizedName, row.modelKey);
    byIdentity.set(key, (byIdentity.get(key) ?? 0) + quantity);
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + quantity);
  }
  return { byIdentity, byCategory };
}

/**
 * Identity mode compares the whole key, so a requirement with no model
 * (`__unknown__`) is satisfied only by model-unknown stock, and a requirement
 * naming a model is satisfied only by that model. The asymmetry is deliberate:
 * "ESP32-CAM" must not quietly stand in for "ESP32-CAM (OV5640)".
 */
function ownedUnitsFor(requirement: ProjectRequirement, index: InventoryIndex): number {
  if (requirement.matchMode === "category") return index.byCategory.get(requirement.category) ?? 0;
  return index.byIdentity.get(identityKey(requirement.normalizedName, requirement.modelKey)) ?? 0;
}

export function matchRequirements(
  requirements: ProjectRequirement[],
  inventory: InventorySnapshotRow[],
): RequirementMatch[] {
  const index = indexInventory(inventory);
  return requirements.map((requirement) => {
    const required = requirement.quantityRequired;
    const owned = Math.min(required, ownedUnitsFor(requirement, index));
    return { requirement, required, owned, missing: required - owned };
  });
}

/**
 * Every requirement weighs the same, whatever quantity it asks for. Counting
 * units instead let bulk items drown out the parts a build actually turns on:
 * twenty jumper wires and no ESP32-CAM read 95% ready while nothing could be
 * assembled. One requirement is one share of the build.
 *
 * Within a requirement the credit is proportional, so half the wires still
 * moves the bar — the distortion was the weighting between requirements, not
 * partial progress inside one.
 *
 * The percentage is floored so an all-but-one-part project never reads 100%,
 * and a project that declares nothing is 0% — an empty project is not a
 * finished one.
 */
export function readinessOf(matches: RequirementMatch[]): ProjectReadiness {
  const requiredParts = matches.length;
  const satisfiedParts = matches.filter((match) => match.missing === 0).length;
  const requiredUnits = matches.reduce((total, match) => total + match.required, 0);
  const ownedUnits = matches.reduce((total, match) => total + match.owned, 0);
  // A requirement asking for nothing is trivially met rather than a divide by zero.
  const shares = matches.reduce((total, match) => total + (match.required <= 0 ? 1 : match.owned / match.required), 0);

  return {
    requiredParts,
    satisfiedParts,
    requiredUnits,
    ownedUnits,
    percent: requiredParts === 0 ? 0 : Math.floor((shares / requiredParts) * 100),
    ready: requiredParts > 0 && satisfiedParts === requiredParts,
  };
}

export function planProject(
  project: Project,
  requirements: ProjectRequirement[],
  inventory: InventorySnapshotRow[],
): ProjectPlan {
  const matches = matchRequirements(requirements, inventory);
  return { ...project, requirements: matches, readiness: readinessOf(matches) };
}

/** Distinct parts still short — the count that decides what to buy next. */
const partsShort = (plan: ProjectPlan) => plan.readiness.requiredParts - plan.readiness.satisfiedParts;
const unitsShort = (plan: ProjectPlan) => plan.readiness.requiredUnits - plan.readiness.ownedUnits;

/** Buildable-now first: the answer to "what can I start this afternoon?". */
export function rankProjects(plans: ProjectPlan[]): ProjectPlan[] {
  return [...plans].sort(
    (a, b) =>
      b.readiness.percent - a.readiness.percent ||
      partsShort(a) - partsShort(b) ||
      unitsShort(a) - unitsShort(b) ||
      a.name.localeCompare(b.name),
  );
}

function shoppingKey(requirement: ProjectRequirement): string {
  return requirement.matchMode === "category"
    ? `category ${requirement.category}`
    : `identity ${identityKey(requirement.normalizedName, requirement.modelKey)}`;
}

/**
 * Shortfalls are summed rather than maximised: nothing is reserved, so building
 * two projects that each still need two servos means buying four.
 */
export function buildShoppingList(plans: ProjectPlan[]): ShoppingList {
  const entries = new Map<string, ShoppingListEntry>();
  for (const plan of plans) {
    for (const match of plan.requirements) {
      if (match.missing === 0) continue;
      const { requirement } = match;
      const key = shoppingKey(requirement);
      const existing = entries.get(key);
      if (existing) {
        existing.missing += match.missing;
        existing.projects.push({ id: plan.id, name: plan.name });
        continue;
      }
      entries.set(key, {
        key,
        name: requirement.matchMode === "category" ? `Any ${requirement.category}` : requirement.name,
        model: requirement.matchMode === "category" ? null : requirement.model,
        category: requirement.category,
        matchMode: requirement.matchMode,
        missing: match.missing,
        projects: [{ id: plan.id, name: plan.name }],
      });
    }
  }
  const ordered = [...entries.values()].sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  return { entries: ordered, totalUnits: ordered.reduce((total, entry) => total + entry.missing, 0) };
}
