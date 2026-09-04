export const PROJECT_STATES = ["planned", "building", "built", "shelved"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

/** Display tokens the project card art is styled with. */
export const PROJECT_ACCENTS = ["green", "blue", "coral", "purple", "amber"] as const;
export type ProjectAccent = (typeof PROJECT_ACCENTS)[number];

export const MATCH_MODES = ["identity", "category"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export type Project = {
  id: string;
  name: string;
  summary: string;
  state: ProjectState;
  accent: ProjectAccent;
  icon: string;
  nextStep: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRequirement = {
  id: string;
  name: string;
  normalizedName: string;
  model: string | null;
  modelKey: string;
  category: string;
  quantityRequired: number;
  matchMode: MatchMode;
  note: string | null;
  position: number;
};

/** A requirement as it arrives from a client, before identity keys are derived. */
export type RequirementInput = {
  name: string;
  model: string | null;
  category: string;
  quantityRequired: number;
  matchMode: MatchMode;
  note: string | null;
};

export type CreateProjectInput = {
  name: string;
  summary: string;
  state: ProjectState;
  accent: ProjectAccent;
  icon: string;
  nextStep: string | null;
  requirements: RequirementInput[];
};

export type UpdateProjectInput = {
  name?: string;
  summary?: string;
  state?: ProjectState;
  accent?: ProjectAccent;
  icon?: string;
  nextStep?: string | null;
};

/** Inventory reduced to the columns matching needs, so it stays a pure input. */
export type InventorySnapshotRow = {
  normalizedName: string;
  modelKey: string;
  category: string;
  quantity: number;
};

export type RequirementMatch = {
  requirement: ProjectRequirement;
  required: number;
  /** Never above `required`: surplus stock does not make a build more ready. */
  owned: number;
  missing: number;
};

export type ProjectReadiness = {
  requiredUnits: number;
  ownedUnits: number;
  percent: number;
  ready: boolean;
};

export type ProjectPlan = Project & {
  requirements: RequirementMatch[];
  readiness: ProjectReadiness;
};

export type ShoppingListEntry = {
  key: string;
  name: string;
  model: string | null;
  category: string;
  matchMode: MatchMode;
  missing: number;
  projects: { id: string; name: string }[];
};

export type ShoppingList = {
  entries: ShoppingListEntry[];
  totalUnits: number;
};

export type TemplateSeedResult = {
  created: string[];
  skipped: string[];
  projects: ProjectPlan[];
};
