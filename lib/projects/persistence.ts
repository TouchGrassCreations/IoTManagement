import type { D1Like } from "../identification/persistence.ts";
import { normalizeIdentity } from "../identification/validation.ts";
import { buildShoppingList, modelKeyFor, planProject, rankProjects } from "./matching.ts";
import type {
  CreateProjectInput,
  InventorySnapshotRow,
  MatchMode,
  Project,
  ProjectAccent,
  ProjectPlan,
  ProjectRequirement,
  ProjectState,
  RequirementInput,
  ShoppingList,
  UpdateProjectInput,
} from "./types.ts";

type ProjectRow = {
  id: string;
  name: string;
  summary: string;
  state: string;
  accent: string;
  icon: string;
  next_step: string | null;
  created_at: string;
  updated_at: string;
};

type RequirementRow = {
  id: string;
  project_id: string;
  name: string;
  normalized_name: string;
  model: string | null;
  model_key: string;
  category: string;
  quantity_required: number;
  match_mode: string;
  note: string | null;
  position: number;
};

const PROJECT_COLUMNS = "id,name,summary,state,accent,icon,next_step,created_at,updated_at";
const REQUIREMENT_COLUMNS =
  "r.id,r.project_id,r.name,r.normalized_name,r.model,r.model_key,r.category,r.quantity_required,r.match_mode,r.note,r.position";

/** A requirement row is only reachable through a project the owner holds. */
const OWNED_PROJECT = "SELECT id FROM projects WHERE id = ? AND owner_id = ?";

export class ProjectNotFoundError extends Error {
  code = "PROJECT_NOT_FOUND" as const;
  id: string;
  constructor(id: string) {
    super("That project was not found.");
    this.id = id;
  }
}

export class DuplicateProjectError extends Error {
  code = "DUPLICATE_PROJECT" as const;
  projectName: string;
  constructor(projectName: string) {
    super(projectName ? `You already have a project called ${projectName}.` : "You already have a project with that name.");
    this.projectName = projectName;
  }
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    state: row.state as ProjectState,
    accent: row.accent as ProjectAccent,
    icon: row.icon,
    nextStep: row.next_step,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requirementFromRow(row: RequirementRow): ProjectRequirement {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    model: row.model,
    modelKey: row.model_key,
    category: row.category,
    quantityRequired: row.quantity_required,
    matchMode: row.match_mode as MatchMode,
    note: row.note,
    position: row.position,
  };
}

function changed(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("meta" in result)) return true;
  const meta = (result as { meta?: { changes?: number } }).meta;
  return typeof meta?.changes !== "number" || meta.changes > 0;
}

/**
 * The unique index is the only thing that can decide a name collision without
 * racing a concurrent create, so the violation is translated rather than
 * pre-checked.
 */
async function withNameGuard<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) throw new DuplicateProjectError(name);
    throw error;
  }
}

async function inventorySnapshot(ownerId: string, db: D1Like): Promise<InventorySnapshotRow[]> {
  const rows = await db
    .prepare("SELECT normalized_name,model_key,category,quantity FROM inventory_parts WHERE owner_id = ?")
    .bind(ownerId)
    .all<{ normalized_name: string; model_key: string; category: string; quantity: number }>();
  return rows.results.map((row) => ({
    normalizedName: row.normalized_name,
    modelKey: row.model_key,
    category: row.category,
    quantity: row.quantity,
  }));
}

async function loadRequirements(ownerId: string, db: D1Like, projectId?: string): Promise<Map<string, ProjectRequirement[]>> {
  const rows = await db
    .prepare(
      `SELECT ${REQUIREMENT_COLUMNS} FROM project_parts r
       JOIN projects p ON p.id = r.project_id
       WHERE p.owner_id = ?${projectId ? " AND p.id = ?" : ""}
       ORDER BY r.project_id, r.position, r.id`,
    )
    .bind(...(projectId ? [ownerId, projectId] : [ownerId]))
    .all<RequirementRow>();

  const byProject = new Map<string, ProjectRequirement[]>();
  for (const row of rows.results) {
    const existing = byProject.get(row.project_id);
    if (existing) existing.push(requirementFromRow(row));
    else byProject.set(row.project_id, [requirementFromRow(row)]);
  }
  return byProject;
}

export async function listProjectPlans(ownerId: string, db: D1Like): Promise<ProjectPlan[]> {
  const [projects, requirements, inventory] = await Promise.all([
    db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner_id = ? ORDER BY normalized_name`).bind(ownerId).all<ProjectRow>(),
    loadRequirements(ownerId, db),
    inventorySnapshot(ownerId, db),
  ]);
  return rankProjects(
    projects.results.map((row) => planProject(projectFromRow(row), requirements.get(row.id) ?? [], inventory)),
  );
}

export async function getProjectPlan(id: string, ownerId: string, db: D1Like): Promise<ProjectPlan> {
  const row = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? AND owner_id = ?`)
    .bind(id, ownerId)
    .first<ProjectRow>();
  if (!row) throw new ProjectNotFoundError(id);

  const [requirements, inventory] = await Promise.all([loadRequirements(ownerId, db, id), inventorySnapshot(ownerId, db)]);
  return planProject(projectFromRow(row), requirements.get(id) ?? [], inventory);
}

function requirementStatements(projectId: string, ownerId: string, rows: RequirementInput[], db: D1Like) {
  return rows.map((row, index) =>
    db
      .prepare(
        `INSERT INTO project_parts
           (id,project_id,name,normalized_name,model,model_key,category,quantity_required,match_mode,note,position)
         SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (${OWNED_PROJECT})`,
      )
      .bind(
        crypto.randomUUID(),
        projectId,
        row.name,
        normalizeIdentity(row.name),
        row.model,
        modelKeyFor(row.model),
        row.category,
        row.quantityRequired,
        row.matchMode,
        row.note,
        index,
        projectId,
        ownerId,
      ),
  );
}

export async function createProject(input: CreateProjectInput, ownerId: string, db: D1Like): Promise<ProjectPlan> {
  const id = crypto.randomUUID();
  await withNameGuard(input.name, () =>
    db.batch([
      db
        .prepare(
          `INSERT INTO projects (id,owner_id,name,normalized_name,summary,state,accent,icon,next_step)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(id, ownerId, input.name, normalizeIdentity(input.name), input.summary, input.state, input.accent, input.icon, input.nextStep),
      ...requirementStatements(id, ownerId, input.requirements, db),
    ]),
  );
  return getProjectPlan(id, ownerId, db);
}

export async function updateProject(
  id: string,
  changes: UpdateProjectInput,
  ownerId: string,
  db: D1Like,
): Promise<ProjectPlan> {
  const assignments: string[] = [];
  const bindings: unknown[] = [];

  if (changes.name !== undefined) {
    assignments.push("name = ?", "normalized_name = ?");
    bindings.push(changes.name, normalizeIdentity(changes.name));
  }
  if (changes.summary !== undefined) {
    assignments.push("summary = ?");
    bindings.push(changes.summary);
  }
  if (changes.state !== undefined) {
    assignments.push("state = ?");
    bindings.push(changes.state);
  }
  if (changes.accent !== undefined) {
    assignments.push("accent = ?");
    bindings.push(changes.accent);
  }
  if (changes.icon !== undefined) {
    assignments.push("icon = ?");
    bindings.push(changes.icon);
  }
  if (changes.nextStep !== undefined) {
    assignments.push("next_step = ?");
    bindings.push(changes.nextStep);
  }
  if (assignments.length === 0) return getProjectPlan(id, ownerId, db);

  const results = await withNameGuard(changes.name ?? "", () =>
    db.batch([
      db
        .prepare(`UPDATE projects SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?`)
        .bind(...bindings, id, ownerId),
    ]),
  );
  if (!changed(results[0])) throw new ProjectNotFoundError(id);
  return getProjectPlan(id, ownerId, db);
}

/** Deletes the project and its requirements. Inventory is never touched. */
export async function deleteProject(id: string, ownerId: string, db: D1Like): Promise<{ deleted: true; id: string }> {
  const results = await db.batch([
    db.prepare(`DELETE FROM project_parts WHERE project_id IN (${OWNED_PROJECT})`).bind(id, ownerId),
    db.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?").bind(id, ownerId),
  ]);
  if (!changed(results[1])) throw new ProjectNotFoundError(id);
  return { deleted: true, id };
}

export async function replaceProjectRequirements(
  id: string,
  rows: RequirementInput[],
  ownerId: string,
  db: D1Like,
): Promise<ProjectPlan> {
  const results = await db.batch([
    db.prepare(`DELETE FROM project_parts WHERE project_id IN (${OWNED_PROJECT})`).bind(id, ownerId),
    ...requirementStatements(id, ownerId, rows, db),
    db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?").bind(id, ownerId),
  ]);
  if (!changed(results[results.length - 1])) throw new ProjectNotFoundError(id);
  return getProjectPlan(id, ownerId, db);
}

export async function projectShoppingList(ownerId: string, ids: string[] | null, db: D1Like): Promise<ShoppingList> {
  const plans = await listProjectPlans(ownerId, db);
  const selected = ids === null ? plans : plans.filter((plan) => ids.includes(plan.id));
  return buildShoppingList(selected);
}

/** Names the owner already holds, so seeding can skip them without failing. */
export async function existingProjectNames(ownerId: string, db: D1Like): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT normalized_name FROM projects WHERE owner_id = ?")
    .bind(ownerId)
    .all<{ normalized_name: string }>();
  return new Set(rows.results.map((row) => row.normalized_name));
}
