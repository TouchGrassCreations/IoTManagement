"use client";

import { useCallback, useEffect, useState } from "react";
import ProjectEditor, { type ProjectDraft } from "./ProjectEditor";
import {
  ApiError,
  createProject,
  deleteProject,
  fetchProjects,
  fetchShoppingList,
  saveRequirements,
  seedTemplates,
  updateProject,
} from "../../lib/projects/client.ts";
import type { ProjectPlan, ProjectState, RequirementMatch, ShoppingList } from "../../lib/projects/types.ts";

const STATE_LABELS: Record<ProjectState, string> = {
  planned: "Planned",
  building: "Building",
  built: "Built",
  shelved: "Shelved",
};

const EMPTY_LIST: ShoppingList = { entries: [], totalUnits: 0 };

function shortfallLabel(match: RequirementMatch): string {
  const { requirement } = match;
  const name = requirement.matchMode === "category" ? `any ${requirement.category}` : requirement.name;
  return `${match.missing} × ${name}`;
}

export default function ProjectsView() {
  const [projects, setProjects] = useState<ProjectPlan[]>([]);
  const [shopping, setShopping] = useState<ShoppingList>(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectPlan | null>(null);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ProjectPlan | null>(null);

  function reportError(failure: unknown, fallback: string) {
    if (failure instanceof ApiError && failure.status === 401) {
      setSignInRequired(true);
      setError("");
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [planned, list] = await Promise.all([fetchProjects(), fetchShoppingList()]);
      setProjects(planned.projects);
      setShopping(list);
      setError("");
      setSignInRequired(false);
    } catch (failure) {
      reportError(failure, "Your projects could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the fetch's first setState lands outside the effect body.
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [load]);

  async function saveProject(draft: ProjectDraft) {
    setSaving(true);
    setEditorError("");
    try {
      if (editing) {
        const fields = { name: draft.name, summary: draft.summary, state: draft.state, accent: draft.accent, icon: draft.icon, nextStep: draft.nextStep };
        await updateProject(editing.id, fields);
        await saveRequirements(editing.id, draft.requirements);
      } else {
        await createProject(draft);
      }
      setEditorOpen(false);
      setEditing(null);
      setNotice("");
      await load();
    } catch (failure) {
      setEditorError(failure instanceof Error ? failure.message : "The project could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(project: ProjectPlan) {
    setDeleting(null);
    try {
      await deleteProject(project.id);
      setNotice(`${project.name} was deleted. Its parts stayed in your cabinet.`);
      await load();
    } catch (failure) {
      reportError(failure, "The project could not be deleted.");
    }
  }

  async function addStarters() {
    setSeeding(true);
    try {
      const result = await seedTemplates();
      setProjects(result.projects);
      setShopping(await fetchShoppingList());
      setNotice(
        result.skipped.length > 0
          ? `Added ${result.created.length}. Already in your cabinet: ${result.skipped.join(", ")}.`
          : `Added ${result.created.length} starter projects.`,
      );
      setError("");
    } catch (failure) {
      reportError(failure, "The starter projects could not be added.");
    } finally {
      setSeeding(false);
    }
  }

  if (signInRequired) {
    return (
      <section className="sign-in-gate">
        <p className="eyebrow">YOUR CABINET IS PRIVATE</p>
        <h1>Sign in to open it.</h1>
        <p>Parts, projects and history belong to the person who catalogued them. Sign in to see yours.</p>
        <a className="hero-camera-button" href="/signin-with-chatgpt?return_to=%2F">Sign in with ChatGPT</a>
      </section>
    );
  }

  const buildable = projects.filter((project) => project.readiness.ready).length;

  return (
    <section className="projects-view">
      <div className="projects-intro">
        <div>
          <p className="eyebrow">PROJECT PLANNER</p>
          <h1>See what&rsquo;s possible.<br /><em>Spot what&rsquo;s missing.</em></h1>
        </div>
        <p>Every build is matched against your cabinet, so your next shopping list stays short and intentional.</p>
      </div>

      <div className="projects-toolbar">
        <div className="projects-tally">
          <strong>{projects.length}</strong> {projects.length === 1 ? "project" : "projects"}
          <span>·</span>
          <strong>{buildable}</strong> ready to build
        </div>
        <div className="projects-actions">
          <button type="button" className="ghost-button" onClick={() => void addStarters()} disabled={seeding}>
            {seeding ? "Adding…" : "Add starter projects"}
          </button>
          <button type="button" className="hero-camera-button" onClick={() => { setEditing(null); setEditorError(""); setEditorOpen(true); }}>
            <span aria-hidden="true">＋</span> New project
          </button>
        </div>
      </div>

      {error && <p className="inventory-message error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
      {notice && <p className="inventory-message" role="status">{notice}</p>}
      {loading && <p className="inventory-message" role="status">Loading projects…</p>}

      <div className="section-heading">
        <div><p className="eyebrow">RANKED BY WHAT YOU ALREADY OWN</p><h2>What you can build now</h2></div>
        <p>{shopping.totalUnits} part{shopping.totalUnits === 1 ? "" : "s"} short across every project</p>
      </div>

      <div className="project-grid">
        {projects.map((project) => {
          const missing = project.requirements.filter((match) => match.missing > 0);
          return (
            <article className="project-card" key={project.id}>
              <div className={`project-art ${project.accent}`}>
                <span>{project.icon}</span>
                <b>{project.readiness.percent}%</b>
              </div>
              <div className="project-content">
                <div className="project-meta">
                  <span>{STATE_LABELS[project.state]}</span>
                  <small>{project.readiness.ownedUnits} / {project.readiness.requiredUnits} parts ready</small>
                </div>
                <h2>{project.name}</h2>
                <div className="progress"><i style={{ width: `${project.readiness.percent}%` }} /></div>
                {project.summary && <p className="project-summary">{project.summary}</p>}
                {project.nextStep && <p className="next-step"><b>Next:</b> {project.nextStep}</p>}
                {missing.length > 0 ? (
                  <div className="missing">
                    <p>MISSING</p>
                    {missing.map((match) => <span key={match.requirement.id}>＋ {shortfallLabel(match)}</span>)}
                  </div>
                ) : (
                  <p className="ready-note">
                    {project.readiness.requiredUnits === 0
                      ? "No parts listed yet — add what this build needs."
                      : "Every part is in the cabinet."}
                  </p>
                )}
                <div className="project-card-actions">
                  <button type="button" onClick={() => { setEditing(project); setEditorError(""); setEditorOpen(true); }}>
                    Edit project <span aria-hidden="true">→</span>
                  </button>
                  <button type="button" className="delete-project" onClick={() => setDeleting(project)}>Delete</button>
                </div>
              </div>
            </article>
          );
        })}

        {projects.length === 0 && !loading && (
          <div className="empty">
            <strong>No projects yet</strong>
            <p>Start from the five builds this cabinet was designed around, or describe your own.</p>
            <button type="button" className="empty-camera-button" onClick={() => void addStarters()} disabled={seeding}>
              {seeding ? "Adding…" : "Add starter projects"}
            </button>
          </div>
        )}
      </div>

      {shopping.entries.length > 0 && (
        <section className="shopping-list">
          <div className="section-heading">
            <div><p className="eyebrow">SHOPPING LIST</p><h2>Buy these next</h2></div>
            <p>Merged across every project, nothing reserved</p>
          </div>
          <ul>
            {shopping.entries.map((entry) => (
              <li key={entry.key}>
                <b>{entry.missing}×</b>
                <span className="shopping-name">{entry.name}{entry.model ? ` (${entry.model})` : ""}</span>
                <span className="shopping-category">{entry.category}</span>
                <span className="shopping-projects">for {entry.projects.map((project) => project.name).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editorOpen && (
        <ProjectEditor
          key={editing?.id ?? "new-project"}
          project={editing}
          saving={saving}
          error={editorError}
          onCancel={() => { setEditorOpen(false); setEditing(null); }}
          onSave={(draft) => void saveProject(draft)}
        />
      )}

      {deleting && (
        <div className="modal-backdrop">
          <div className="modal delete-project-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
            <p className="eyebrow">DELETE PROJECT</p>
            <h2 id="delete-project-title">{deleting.name}</h2>
            <p className="destructive-warning">The plan and its part list go. Nothing leaves your inventory.</p>
            <div className="dialog-actions">
              <button type="button" className="cancel-button" onClick={() => setDeleting(null)}>Keep it</button>
              <button type="button" className="danger-button" onClick={() => void confirmDelete(deleting)}>Delete project</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
