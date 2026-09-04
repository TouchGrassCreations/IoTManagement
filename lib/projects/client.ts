import type {
  CreateProjectInput,
  ProjectPlan,
  RequirementInput,
  ShoppingList,
  TemplateSeedResult,
  UpdateProjectInput,
} from "./types.ts";

/** An API failure that carries the status, so the view can gate on a 401. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const SIGN_IN_MESSAGE = "Sign in to open your cabinet.";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new ApiError(payload?.error || "That request could not be completed.", response.status);
  if (!payload) throw new ApiError("The server returned an unreadable response.", response.status);
  return payload;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const projectUrl = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const fetchProjects = (owner?: string | null) =>
  request<{ projects: ProjectPlan[] }>(owner ? `/api/projects?owner=${encodeURIComponent(owner)}` : "/api/projects");

export const fetchProject = (id: string) => request<{ project: ProjectPlan }>(projectUrl(id));

export const createProject = (input: CreateProjectInput) =>
  request<{ project: ProjectPlan }>("/api/projects", jsonInit("POST", input));

export const updateProject = (id: string, changes: UpdateProjectInput) =>
  request<{ project: ProjectPlan }>(projectUrl(id), jsonInit("PATCH", changes));

export const deleteProject = (id: string) =>
  request<{ deleted: true; id: string }>(projectUrl(id), { method: "DELETE" });

export const saveRequirements = (id: string, requirements: RequirementInput[]) =>
  request<{ project: ProjectPlan }>(`${projectUrl(id)}/parts`, jsonInit("PUT", { requirements }));

export const fetchShoppingList = (ids?: string[]) =>
  request<ShoppingList>(
    ids && ids.length > 0
      ? `/api/projects/shopping-list?ids=${encodeURIComponent(ids.join(","))}`
      : "/api/projects/shopping-list",
  );

export const seedTemplates = () => request<TemplateSeedResult>("/api/projects/templates", { method: "POST" });

export type CabinetSummary = { ownerId: string; label: string | null; visibility: "private" | "public" };

export const fetchCabinet = () => request<{ cabinet: CabinetSummary }>("/api/cabinet");

export const saveCabinetVisibility = (visibility: "private" | "public") =>
  request<{ cabinet: CabinetSummary }>("/api/cabinet", jsonInit("PATCH", { visibility }));
