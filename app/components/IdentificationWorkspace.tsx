"use client";
/* eslint-disable @next/next/no-img-element -- object URL previews and inline crop thumbnails are local, transient images */
import { useEffect, useRef, useState } from "react";
import type { Detection, InventoryResult, ProjectIdea, ReviewItem } from "../../lib/identification/types.ts";
import { fetchProjects } from "../../lib/projects/client.ts";
import type { ProjectPlan } from "../../lib/projects/types.ts";
import { INVENTORY_CATEGORIES } from "../../lib/identification/validation.ts";
import { cropDetections, thumbnailFromFile } from "../../lib/identification/crop-client.ts";

type Props = { onClose: () => void; onConfirmed: (items: InventoryResult[]) => void };

function blankItem(): ReviewItem {
  return { id: crypto.randomUUID(), accepted: true, source: "manual", name: "", model: null, category: "Sensors", quantity: 1, location: "Unsorted", image: null, boundingBox: null, confidence: null, detectedName: null, detectedModel: null, visibleMarkings: [], alternatives: [], description: "Added by hand while reviewing the photo.", tags: [], projectMatch: null, projectIdeas: [], projectId: null, newProjectName: null, projectReason: null };
}

export default function IdentificationWorkspace({ onClose, onConfirmed }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"" | "analyzing" | "saving">("");
  const [error, setError] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const [focusRow, setFocusRow] = useState("");
  const [projects, setProjects] = useState<ProjectPlan[]>([]);
  const previewRef = useRef("");

  // The dropdown needs the cabinet's projects whether or not a scan happens.
  useEffect(() => {
    let cancelled = false;
    void fetchProjects()
      .then((payload) => { if (!cancelled) setProjects(payload.projects); })
      .catch(() => { /* Filing into a project is optional; the batch still saves. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { previewRef.current = preview; }, [preview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  function choose(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : "");
    setItems((current) => current.filter((item) => item.source === "manual"));
    setError("");
  }

  /** Manual-only sessions never touch Gemini, so they mint their own confirmation token. */
  async function ensureToken() {
    if (token) return token;
    const response = await fetch("/api/identify/token", { method: "POST" });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error || "Cataloguing is temporarily unavailable. Please retry.");
    setToken(data.token);
    return data.token;
  }

  async function analyze() {
    if (!file) return;
    setBusy("analyzing");
    setError("");
    try {
      const form = new FormData();
      form.set("image", file);
      const response = await fetch("/api/identify", { method: "POST", body: form });
      const data = await response.json() as { detections?: Detection[]; token?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Identification failed");
      const detections = data.detections || [];
      const crops = await cropDetections(file, detections.map((detection) => detection.boundingBox));
      setToken(data.token || "");
      setItems((current) => [
        ...detections.map((detection, index): ReviewItem => {
          const matched = projects.find((project) => project.name.toLowerCase() === (detection.projectMatch ?? "").toLowerCase());
          return { ...detection, id: `d-${index}`, accepted: true, source: "gemini", location: "Unsorted", image: crops[index] ?? null, detectedName: detection.name, detectedModel: detection.model, projectId: matched?.id ?? null, newProjectName: null, projectReason: null };
        }),
        ...current.filter((item) => item.source === "manual"),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Identification failed");
    } finally {
      setBusy("");
    }
  }

  function patch(id: string, values: Partial<ReviewItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  }

  /** One dropdown covers an existing project, one of Gemini's ideas, and your own. */
  function projectChoice(item: ReviewItem) {
    if (item.projectId) return `existing:${item.projectId}`;
    if (item.newProjectName === null) return "";
    const idea = item.projectIdeas.findIndex((candidate) => candidate.name === item.newProjectName);
    return idea === -1 ? "custom" : `idea:${idea}`;
  }

  function chooseProject(item: ReviewItem, value: string) {
    if (value === "") return patch(item.id, { projectId: null, newProjectName: null, projectReason: null });
    if (value === "custom") return patch(item.id, { projectId: null, newProjectName: "", projectReason: null });
    if (value.startsWith("existing:")) return patch(item.id, { projectId: value.slice(9), newProjectName: null, projectReason: null });
    const idea: ProjectIdea | undefined = item.projectIdeas[Number(value.slice(5))];
    if (idea) patch(item.id, { projectId: null, newProjectName: idea.name, projectReason: idea.reason });
  }

  function addManual() {
    const item = blankItem();
    setError("");
    setItems((current) => [...current, item]);
    setFocusRow(item.id);
  }

  async function attachPhoto(id: string, chosen: File | null) {
    if (!chosen) return;
    const thumbnail = await thumbnailFromFile(chosen);
    if (!thumbnail) { setError("That photo could not be read. Try a JPG, PNG, or WebP image."); return; }
    patch(id, { image: thumbnail });
  }

  async function confirm() {
    setBusy("saving");
    setError("");
    try {
      const confirmationToken = await ensureToken();
      const response = await fetch("/api/identify/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: confirmationToken, items }) });
      const data = await response.json() as { inventory?: InventoryResult[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Confirmation failed");
      onConfirmed(data.inventory || []);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Confirmation failed");
    } finally {
      setBusy("");
    }
  }

  const accepted = items.filter((item) => item.accepted && item.name.trim());
  const detected = items.filter((item) => item.source === "gemini");

  return <div className="identify-overlay" role="dialog" aria-modal="true" aria-labelledby="identify-title">
    <section className="identify-workspace">
      <header>
        <div>
          <p className="eyebrow">CAMERA IDENTIFICATION</p>
          <h2 id="identify-title">Point, shoot, catalogue</h2>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <p className="privacy-note">Photos are sent to Gemini for identification. The full photo is never stored — only a small cropped thumbnail of each part you confirm is saved with your inventory.</p>

      <div className="identify-columns">
        <div className="upload-pane">
          <label className="photo-drop">
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => choose(event.target.files?.[0] || null)} />
            {preview ? <span className="photo-frame">
              <img src={preview} alt="Components selected for identification" />
              {detected.map((item, index) => item.boundingBox && <b key={item.id} className={`detection-box ${item.accepted ? "" : "rejected"} ${highlighted === item.id ? "active" : ""}`} style={{ left: `${item.boundingBox.left * 100}%`, top: `${item.boundingBox.top * 100}%`, width: `${item.boundingBox.width * 100}%`, height: `${item.boundingBox.height * 100}%` }}><i>{index + 1}</i></b>)}
            </span> : <>
              <strong>Take or choose a photo</strong>
              <span>Place one or several parts on a clear, well-lit background.</span>
            </>}
          </label>
          <button className="submit" disabled={!file || busy !== ""} onClick={analyze}>{busy === "analyzing" ? "Analyzing…" : detected.length ? "Re-analyze photo" : "Identify components"}</button>
          <button className="manual-button" onClick={addManual} disabled={busy !== ""}>＋ Add a part by hand instead</button>
        </div>

        <div className="review-pane" aria-live="polite">
          {error && <p className="identify-error" role="alert">{error}</p>}
          {!items.length && !error && <div className="review-empty">
            <strong>Review before saving</strong>
            <p>Gemini’s likely names, models and counts appear here, each with the crop of the part it found. Nothing is saved until you confirm.</p>
          </div>}
          {items.map((item, index) => <article className={`detection-row ${item.accepted ? "" : "rejected"}`} key={item.id} onFocus={() => setHighlighted(item.id)} onMouseEnter={() => setHighlighted(item.id)} onMouseLeave={() => setHighlighted("")}>
            <div className="detection-heading">
              <strong>{item.source === "gemini" ? `Component ${index + 1}` : "Added by hand"}</strong>
              {item.confidence !== null && <span className={item.confidence < .7 ? "low-confidence" : ""}>{Math.round(item.confidence * 100)}% likely</span>}
            </div>
            <div className="detection-preview">
              {item.image ? <img src={item.image} alt={item.name ? `Crop of ${item.name}` : "Crop of this component"} /> : <span className="preview-placeholder">No photo</span>}
              <label className="photo-swap">
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void attachPhoto(item.id, event.target.files?.[0] || null)} />
                {item.image ? "Replace photo" : "Add a photo"}
              </label>
            </div>
            <label>Name<input ref={(element) => { if (element && focusRow === item.id) { element.focus(); setFocusRow(""); } }} value={item.name} placeholder="e.g. BMP280 pressure sensor" onChange={(event) => patch(item.id, { name: event.target.value })} /></label>
            <div className="form-row">
              <label>Model<input value={item.model || ""} placeholder="Model unknown" onChange={(event) => patch(item.id, { model: event.target.value || null })} /></label>
              <label>Quantity<input type="number" min="1" max="999" value={item.quantity || ""} onChange={(event) => patch(item.id, { quantity: Number(event.target.value) })} /></label>
            </div>
            <div className="form-row">
              <label>Category<select value={item.category} onChange={(event) => patch(item.id, { category: event.target.value })}>{INVENTORY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Storage<input value={item.location} placeholder="Bin B5" onChange={(event) => patch(item.id, { location: event.target.value })} /></label>
            </div>
            <label>Project
              <select value={projectChoice(item)} onChange={(event) => chooseProject(item, event.target.value)}>
                <option value="">Not part of a project</option>
                {projects.map((project) => <option key={project.id} value={`existing:${project.id}`}>{project.name}</option>)}
                {item.projectIdeas.map((idea, ideaIndex) => <option key={idea.name} value={`idea:${ideaIndex}`}>✨ New: {idea.name}</option>)}
                <option value="custom">＋ New project of my own…</option>
              </select>
            </label>
            {item.newProjectName !== null && <input className="new-project-name" value={item.newProjectName} placeholder="New project name" aria-label="New project name" onChange={(event) => patch(item.id, { newProjectName: event.target.value })} />}
            {item.projectReason && <p className="project-hint">✨ {item.projectReason}</p>}
            {item.source === "gemini" && item.projectMatch && item.projectId && <p className="project-hint">✨ Gemini thinks this belongs to {item.projectMatch}.</p>}
            {item.source === "gemini" && item.model === null && <p className="model-warning">Exact model not visible — it will be saved as model unknown.</p>}
            <button className="reject-button" onClick={() => patch(item.id, { accepted: !item.accepted })}>{item.accepted ? "Reject" : "Restore"}</button>
          </article>)}
          {items.length > 0 && <>
            <button className="manual-button" onClick={addManual}>＋ Add a missed component</button>
            <button className="confirm-button" disabled={!accepted.length || busy !== ""} onClick={() => void confirm()}>{busy === "saving" ? "Saving…" : accepted.length ? `Confirm and add ${accepted.length} item${accepted.length === 1 ? "" : "s"}` : "Name each part to save it"}</button>
          </>}
        </div>
      </div>
    </section>
  </div>;
}
