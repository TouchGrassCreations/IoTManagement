"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IdentificationWorkspace from "./components/IdentificationWorkspace";
import PendingRemovalToast from "./components/PendingRemovalToast";
import RemoveInventoryDialog from "./components/RemoveInventoryDialog";
import { INVENTORY_CATEGORIES } from "../lib/identification/validation.ts";
import { createPendingRemoval } from "../lib/inventory/pending-removal.ts";
import { projectInventoryWithPending } from "../lib/inventory/optimistic-inventory.ts";
import { createInventoryResponseGuard } from "../lib/inventory/response-guard.ts";
import type { InventoryItem, RemoveInventoryResult } from "../lib/inventory/types.ts";
import type { InventoryResult } from "../lib/identification/types";

type Part = InventoryItem & {
  tone: string;
  symbol: string;
};

type PendingRemoval = { item: Part; quantity: number; deadline: number };
type RemovalRequestError = Error & { status?: number; item?: InventoryItem };

function presentPart(item: InventoryItem): Part {
  return { ...item, tone: "purple", symbol: item.name.slice(0, 3).toUpperCase() };
}

const projects = [
  { name: "Elderly monitoring camera", state: "In progress", accent: "coral", owned: 6, total: 8, next: "Add local video storage", missing: ["ESP32-CAM", "MicroSD module"], icon: "CAM" },
  { name: "Basic Arduino car", state: "In progress", accent: "blue", owned: 9, total: 11, next: "Mount motor driver", missing: ["2× gear motors", "Battery holder"], icon: "CAR" },
  { name: "Mecanum wheel car", state: "Not started", accent: "purple", owned: 5, total: 13, next: "Source drivetrain", missing: ["4× mecanum wheels", "4× motors", "Chassis", "Battery"], icon: "MEC" },
  { name: "4 DOF robot arm", state: "Partially built", accent: "amber", owned: 10, total: 14, next: "Finish joint calibration", missing: ["Servo controller", "Claw gripper", "Power supply"], icon: "ARM" },
  { name: "Small urban indoor farm", state: "In progress", accent: "green", owned: 11, total: 15, next: "Automate watering", missing: ["Water pump", "Relay module", "Grow light"], icon: "FARM" },
];

const nav = ["Inventory", "Projects"] as const;

export default function Home() {
  const [view, setView] = useState<(typeof nav)[number]>("Inventory");
  const [parts, setParts] = useState<Part[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All parts");
  const [isAdding, setIsAdding] = useState(false);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [removeItem, setRemoveItem] = useState<Part | null>(null);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const removalController = useRef(createPendingRemoval());
  const inventoryResponseGuard = useRef(createInventoryResponseGuard());
  const removalOpeners = useRef(new Map<string, HTMLButtonElement>());

  function updatePendingRemovals(update: (current: PendingRemoval[]) => PendingRemoval[]) {
    setPendingRemovals(update);
  }

  const loadInventory = useCallback(async () => {
    const load = inventoryResponseGuard.current.beginLoad();
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
      if (!response.ok) throw new Error("Inventory could not be loaded.");
      const payload = await response.json() as { inventory: InventoryItem[] };
      load.apply(() => setParts(payload.inventory.map(presentPart)));
      setInventoryError("");
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : "Inventory could not be loaded.");
    } finally { setInventoryLoading(false); }
  }, []);

  useEffect(() => {
    const controller = removalController.current;
    const start = window.setTimeout(() => void loadInventory(), 0);
    return () => { window.clearTimeout(start); controller.dispose(); };
  }, [loadInventory]);

  const categories = ["All parts", ...INVENTORY_CATEGORIES];
  const displayedParts = useMemo(() => projectInventoryWithPending(parts, pendingRemovals), [parts, pendingRemovals]);
  const filtered = useMemo(() => displayedParts.filter((part) => {
    const matchesCategory = category === "All parts" || part.category === category;
    const haystack = `${part.name} ${part.code} ${part.category} ${part.tags.join(" ")}`.toLowerCase();
    return matchesCategory && haystack.includes(query.toLowerCase());
  }), [displayedParts, query, category]);
  const unitCount = displayedParts.reduce((sum, part) => sum + part.quantity, 0);

  async function addPart(formData: FormData) {
    const name = String(formData.get("name") || "Unnamed component");
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, category: String(formData.get("category") || "Sensors"), quantity: Number(formData.get("quantity")) || 1, location: String(formData.get("location") || "Unsorted") }) });
      const payload = await response.json() as { item?: InventoryItem; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error || "The component could not be added.");
      inventoryResponseGuard.current.recordMutation();
      setParts((current) => [presentPart(payload.item!), ...current.filter((part) => part.id !== payload.item!.id)]);
      setInventoryError("");
      setIsAdding(false);
    } catch (error) { setInventoryError(error instanceof Error ? error.message : "The component could not be added."); }
  }

  function applyIdentified(identified: InventoryResult[]) {
    void identified;
    inventoryResponseGuard.current.recordMutation();
    void loadInventory();
  }

  function scheduleRemoval(item: Part, quantity: number) {
    const scheduled = removalController.current.schedule({
      item, quantity,
      onOptimistic: () => {},
      onRestore: () => {},
      commit: async () => {
        const response = await fetch(`/api/inventory/${encodeURIComponent(item.id)}/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quantity, expectedCurrentQuantity: item.quantity }) });
        const payload = await response.json() as RemoveInventoryResult & { error?: string; item?: InventoryItem };
        if (!response.ok) { const error = new Error(payload.error || "The component could not be removed.") as RemovalRequestError; error.status = response.status; error.item = payload.item; throw error; }
        return payload;
      },
      onCommitted: (result) => {
        if (result) {
          inventoryResponseGuard.current.recordMutation();
          setParts((current) => result.deleted ? current.filter((part) => part.id !== result.id) : current.map((part) => part.id === result.item.id ? presentPart(result.item) : part));
        }
        updatePendingRemovals((current) => current.filter((pending) => pending.item.id !== item.id));
        setInventoryError("");
      },
      onError: (error) => {
        updatePendingRemovals((current) => current.filter((pending) => pending.item.id !== item.id));
        setInventoryError(error instanceof Error ? error.message : "The component could not be removed.");
        if (error && typeof error === "object" && "status" in error && error.status === 409) {
          const conflict = error as RemovalRequestError;
          if (conflict.item) {
            inventoryResponseGuard.current.recordMutation();
            setParts((current) => current.some((part) => part.id === conflict.item!.id) ? current.map((part) => part.id === conflict.item!.id ? presentPart(conflict.item!) : part) : [...current, presentPart(conflict.item)]);
          }
          void loadInventory();
        }
      },
    });
    if (scheduled) updatePendingRemovals((current) => [...current, { item, quantity, deadline: Date.now() + 10_000 }]);
    setRemoveItem(null);
  }

  function undoRemoval(id: string) {
    if (removalController.current.undo(id)) {
      updatePendingRemovals((current) => current.filter((pending) => pending.item.id !== id));
      requestAnimationFrame(() => removalOpeners.current.get(id)?.focus());
    }
  }

  function cancelRemoval() {
    const id = removeItem?.id;
    setRemoveItem(null);
    if (id) requestAnimationFrame(() => removalOpeners.current.get(id)?.focus());
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("Inventory")} aria-label="Parts Cabinet home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Parts Cabinet</span>
        </button>
        <nav aria-label="Main navigation">
          {nav.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="Notifications">●</button>
          <button className="avatar" aria-label="Account">RK</button>
        </div>
      </header>

      {view === "Inventory" ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">YOUR WORKBENCH, ORGANIZED</p>
              <h1>Know what you have.<br /><em>Build what you imagine.</em></h1>
              <p className="hero-copy">Catalog every board, sensor, and tiny mystery module—then turn your box of parts into real projects.</p>
            </div>
            <div className="hero-stats" aria-label="Inventory overview">
              <div><strong>{displayedParts.length}</strong><span>types catalogued</span></div>
              <div><strong>{unitCount}</strong><span>total components</span></div>
              <div><strong>{projects.length}</strong><span>projects planned</span></div>
            </div>
          </section>

          <section className="toolbar" aria-label="Inventory controls">
            <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts, labels, or functions…" /></label>
            <button className="add-button" onClick={() => setIsAdding(true)}><span>＋</span> Add component</button>
          </section>

          <section className="inventory-layout">
            <aside>
              <p className="aside-title">CATEGORIES</p>
              {categories.map((item) => {
                const count = item === "All parts" ? displayedParts.length : displayedParts.filter((p) => p.category === item).length;
                return <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}><span>{item}</span><b>{count}</b></button>;
              })}
              <div className="identify-card">
                <span className="identify-icon">?</span>
                <h3>Mystery part?</h3>
                <p>Snap a clear photo and save it for identification.</p>
                <button onClick={() => setIsIdentifying(true)}>Identify a part →</button>
              </div>
            </aside>

            <div className="parts-panel">
              {inventoryError && <p className="inventory-message error" role="alert">{inventoryError} <button type="button" onClick={() => void loadInventory()}>Retry</button></p>}
              {inventoryLoading && <p className="inventory-message" role="status">Loading inventory…</p>}
              <div className="section-heading">
                <div><p className="eyebrow">INVENTORY</p><h2>{category}</h2></div>
                <p>Showing {filtered.length} of {displayedParts.length} component types</p>
              </div>
              <div className="parts-grid">
                {filtered.map((part) => (
                  <article className="part-card" key={part.id}>
                    <div className={`part-visual ${part.tone}`}><span>{part.symbol}</span><small>{part.code}</small></div>
                    <div className="part-body">
                      <div className="part-top"><span>{part.category}</span><strong>×{part.quantity}</strong></div>
                      <h3>{part.name}</h3>
                      <p>{part.description}</p>
                      <div className="tags">{part.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                      <footer><span>⌖ {part.location}</span><button ref={(element) => { if (element) removalOpeners.current.set(part.id, element); else removalOpeners.current.delete(part.id); }} className="remove-part-button" disabled={pendingRemovals.some((pending) => pending.item.id === part.id)} onClick={() => setRemoveItem(part)} aria-label={`Remove ${part.name} from inventory`}>Remove</button></footer>
                    </div>
                  </article>
                ))}
                {filtered.length === 0 && <div className="empty"><strong>No parts found</strong><p>Try a different search or category.</p></div>}
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="projects-view">
          <div className="projects-intro">
            <div><p className="eyebrow">PROJECT PLANNER</p><h1>See what’s possible.<br /><em>Spot what’s missing.</em></h1></div>
            <p>Every build is matched against your cabinet, so your next shopping list stays short and intentional.</p>
          </div>
          <div className="project-grid">
            {projects.map((project) => {
              const percent = Math.round((project.owned / project.total) * 100);
              return <article className="project-card" key={project.name}>
                <div className={`project-art ${project.accent}`}><span>{project.icon}</span><b>{percent}%</b></div>
                <div className="project-content">
                  <div className="project-meta"><span>{project.state}</span><small>{project.owned} / {project.total} parts ready</small></div>
                  <h2>{project.name}</h2>
                  <div className="progress"><i style={{ width: `${percent}%` }} /></div>
                  <p className="next-step"><b>Next:</b> {project.next}</p>
                  <div className="missing"><p>MISSING</p>{project.missing.map((item) => <span key={item}>＋ {item}</span>)}</div>
                  <button>Open project <span>→</span></button>
                </div>
              </article>;
            })}
          </div>
        </section>
      )}

      {isAdding && <div className="modal-backdrop">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
          <button className="close" onClick={() => setIsAdding(false)} aria-label="Close">×</button>
          <p className="eyebrow">CATALOG A PART</p><h2 id="add-title">What did you find?</h2>
          <p>Add what you know now—you can fill in technical details later.</p>
          <form action={addPart}>
            <label>Component name<input name="name" placeholder="e.g. BMP280 pressure sensor" required /></label>
            <div className="form-row">
              <label>Category<select name="category" defaultValue="Sensors">{categories.slice(1).map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Quantity<input name="quantity" type="number" min="1" defaultValue="1" /></label>
            </div>
            <label>Storage location<input name="location" placeholder="e.g. Bin B5" /></label>
            <button className="submit" type="submit">Add to cabinet</button>
          </form>
        </div>
      </div>}
      {isIdentifying && <IdentificationWorkspace onClose={() => setIsIdentifying(false)} onConfirmed={applyIdentified} />}
      {removeItem && <RemoveInventoryDialog item={removeItem} onCancel={cancelRemoval} onConfirm={(quantity) => scheduleRemoval(removeItem, quantity)} />}
      {pendingRemovals.length > 0 && <div className="removal-toast-stack">
        {pendingRemovals.map((pending) => <PendingRemovalToast key={pending.item.id} quantity={pending.quantity} name={pending.item.name} deadline={pending.deadline} onUndo={() => undoRemoval(pending.item.id)} />)}
      </div>}
    </main>
  );
}
