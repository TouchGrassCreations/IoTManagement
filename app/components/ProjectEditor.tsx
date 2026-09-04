"use client";

import { useEffect, useRef, useState } from "react";
import { INVENTORY_CATEGORIES } from "../../lib/identification/validation.ts";
import { MATCH_MODES, PROJECT_ACCENTS, PROJECT_STATES } from "../../lib/projects/types.ts";
import type {
  MatchMode,
  ProjectAccent,
  ProjectPlan,
  ProjectState,
  RequirementInput,
} from "../../lib/projects/types.ts";

export type ProjectDraft = {
  name: string;
  summary: string;
  state: ProjectState;
  accent: ProjectAccent;
  icon: string;
  nextStep: string | null;
  requirements: RequirementInput[];
};

type Row = RequirementInput & { key: string };

type Props = {
  project: ProjectPlan | null;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (draft: ProjectDraft) => void;
};

const STATE_LABELS: Record<ProjectState, string> = {
  planned: "Planned",
  building: "Building",
  built: "Built",
  shelved: "Shelved",
};

const MODE_LABELS: Record<MatchMode, string> = {
  identity: "This exact part",
  category: "Any part in the category",
};

let rowSequence = 0;

function blankRow(): Row {
  rowSequence += 1;
  return {
    key: `row-${rowSequence}`,
    name: "",
    model: null,
    category: INVENTORY_CATEGORIES[0],
    quantityRequired: 1,
    matchMode: "identity",
    note: null,
  };
}

function rowsFor(project: ProjectPlan | null): Row[] {
  if (!project || project.requirements.length === 0) return [blankRow()];
  return project.requirements.map((match) => {
    rowSequence += 1;
    const { requirement } = match;
    return {
      key: `row-${rowSequence}`,
      name: requirement.name,
      model: requirement.model,
      category: requirement.category,
      quantityRequired: requirement.quantityRequired,
      matchMode: requirement.matchMode,
      note: requirement.note,
    };
  });
}

export default function ProjectEditor({ project, saving, error, onCancel, onSave }: Props) {
  const [name, setName] = useState(project?.name ?? "");
  const [summary, setSummary] = useState(project?.summary ?? "");
  const [state, setState] = useState<ProjectState>(project?.state ?? "planned");
  const [accent, setAccent] = useState<ProjectAccent>(project?.accent ?? "green");
  const [icon, setIcon] = useState(project?.icon ?? "");
  const [nextStep, setNextStep] = useState(project?.nextStep ?? "");
  const [rows, setRows] = useState<Row[]>(() => rowsFor(project));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  function editRow(key: string, changes: Partial<RequirementInput>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave({
      name: name.trim(),
      summary: summary.trim(),
      state,
      accent,
      icon: icon.trim().toUpperCase() || name.trim().slice(0, 3).toUpperCase() || "PRJ",
      nextStep: nextStep.trim() || null,
      requirements: rows
        .filter((row) => row.name.trim())
        .map((row) => ({
          name: row.name.trim(),
          model: row.model?.trim() || null,
          category: row.category,
          quantityRequired: row.quantityRequired,
          matchMode: row.matchMode,
          note: row.note?.trim() || null,
        })),
    });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal project-editor" role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
        <button type="button" className="close" onClick={onCancel} aria-label="Close">×</button>
        <p className="eyebrow">{project ? "EDIT PROJECT" : "NEW PROJECT"}</p>
        <h2 id="project-editor-title">{project ? project.name : "What are you building?"}</h2>
        <p>List the parts the build needs. Each one is matched against your cabinet as stock changes.</p>

        <form onSubmit={submit}>
          {error && <p className="identify-error" role="alert">{error}</p>}

          <div className="form-row">
            <label>Project name
              <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
            </label>
            <label>Badge
              <input value={icon} placeholder="CAM" onChange={(event) => setIcon(event.target.value)} maxLength={6} />
            </label>
          </div>

          <label>Summary
            <input value={summary} placeholder="What the finished build does" onChange={(event) => setSummary(event.target.value)} maxLength={500} />
          </label>

          <div className="form-row">
            <label>Next step
              <input value={nextStep} placeholder="Mount the motor driver" onChange={(event) => setNextStep(event.target.value)} maxLength={120} />
            </label>
            <label>State
              <select value={state} onChange={(event) => setState(event.target.value as ProjectState)}>
                {PROJECT_STATES.map((entry) => <option key={entry} value={entry}>{STATE_LABELS[entry]}</option>)}
              </select>
            </label>
          </div>

          <label>Card colour
            <select value={accent} onChange={(event) => setAccent(event.target.value as ProjectAccent)}>
              {PROJECT_ACCENTS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>

          <div className="requirement-list">
            <p className="eyebrow">PARTS THIS BUILD NEEDS</p>
            {rows.map((row, index) => (
              <fieldset className="requirement-row" key={row.key}>
                <legend className="visually-hidden">Requirement {index + 1}</legend>
                <label>Part
                  <input value={row.name} onChange={(event) => editRow(row.key, { name: event.target.value })} maxLength={120} placeholder="ESP32-CAM" />
                </label>
                <label>Model
                  <input value={row.model ?? ""} onChange={(event) => editRow(row.key, { model: event.target.value })} maxLength={120} placeholder="Unknown" />
                </label>
                <label>Category
                  <select value={row.category} onChange={(event) => editRow(row.key, { category: event.target.value })}>
                    {INVENTORY_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
                  </select>
                </label>
                <label>Qty
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={row.quantityRequired}
                    onChange={(event) => editRow(row.key, { quantityRequired: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })}
                  />
                </label>
                <label>Match
                  <select value={row.matchMode} onChange={(event) => editRow(row.key, { matchMode: event.target.value as MatchMode })}>
                    {MATCH_MODES.map((entry) => <option key={entry} value={entry}>{MODE_LABELS[entry]}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="remove-row"
                  onClick={() => setRows((current) => (current.length === 1 ? [blankRow()] : current.filter((entry) => entry.key !== row.key)))}
                  aria-label={`Remove requirement ${index + 1}`}
                >
                  ×
                </button>
              </fieldset>
            ))}
            <button type="button" className="add-row" onClick={() => setRows((current) => [...current, blankRow()])}>
              ＋ Add a part
            </button>
          </div>

          <div className="dialog-actions">
            <button type="button" className="cancel-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : project ? "Save project" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
