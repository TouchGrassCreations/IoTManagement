"use client";
/* eslint-disable @next/next/no-img-element -- thumbnails come from this app's own photo endpoint */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EditPartDialog, { type PartEdit } from "./EditPartDialog";
import PendingRemovalToast from "./PendingRemovalToast";
import RemoveInventoryDialog from "./RemoveInventoryDialog";
import { INVENTORY_CATEGORIES } from "../../lib/identification/validation.ts";
import { thumbnailFromFile } from "../../lib/identification/crop-client.ts";
import { ALL_CATEGORIES, type InventorySort } from "../../lib/inventory/query.ts";
import { ApiError, fetchInventory, fetchSummary, partPhotoUrl, removePart, savePartPhoto, updatePart } from "../../lib/inventory/client.ts";
import { createPendingRemoval } from "../../lib/inventory/pending-removal.ts";
import { projectInventoryWithPending } from "../../lib/inventory/optimistic-inventory.ts";
import { createInventoryResponseGuard } from "../../lib/inventory/response-guard.ts";
import type { InventoryItem, InventorySummary } from "../../lib/inventory/types.ts";

type PendingRemoval = { item: InventoryItem; quantity: number; deadline: number };

const SORT_LABELS: { value: InventorySort; label: string }[] = [
  { value: "name", label: "A–Z" },
  { value: "recent", label: "Newest" },
  { value: "quantity", label: "Most stock" },
];

const EMPTY_SUMMARY: InventorySummary = { totalTypes: 0, totalUnits: 0, photographed: 0, categories: [], locations: [] };

function symbolFor(name: string): string {
  return name.slice(0, 3).toUpperCase();
}

export default function InventoryView({ refreshToken, onIdentify }: { refreshToken: number; onIdentify: () => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<InventorySummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [location, setLocation] = useState<string | null>(null);
  const [sort, setSort] = useState<InventorySort>("name");
  const [error, setError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [photoTarget, setPhotoTarget] = useState("");
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [removeItem, setRemoveItem] = useState<InventoryItem | null>(null);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);

  const removalController = useRef(createPendingRemoval());
  const responseGuard = useRef(createInventoryResponseGuard());
  const removalOpeners = useRef(new Map<string, HTMLButtonElement>());
  const photoInput = useRef<HTMLInputElement>(null);

  // Typing filters the server-side query, so hold off until the user pauses.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function reportError(failure: unknown, fallback: string) {
    if (failure instanceof ApiError && failure.status === 401) {
      setSignInRequired(true);
      setError("");
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  }

  const load = useCallback(async () => {
    const attempt = responseGuard.current.beginLoad();
    setLoading(true);
    try {
      const [page, totals] = await Promise.all([
        fetchInventory({ search, category, location, sort }),
        fetchSummary(),
      ]);
      attempt.apply(() => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setSummary(totals);
      });
      setError("");
      setSignInRequired(false);
    } catch (failure) {
      reportError(failure, "Inventory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [search, category, location, sort]);

  useEffect(() => {
    const controller = removalController.current;
    void load();
    return () => controller.dispose();
  }, [load, refreshToken]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchInventory({ search, category, location, sort, cursor: nextCursor });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      reportError(failure, "The next page could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  const displayed = useMemo(() => projectInventoryWithPending(items, pendingRemovals), [items, pendingRemovals]);
  const categoryCounts = useMemo(
    () => new Map(summary.categories.map((entry) => [entry.category, entry.count])),
    [summary.categories],
  );

  function replaceItem(saved: InventoryItem) {
    responseGuard.current.recordMutation();
    setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  }

  function openPhotoPicker(id: string) {
    setPhotoTarget(id);
    if (photoInput.current) {
      photoInput.current.value = "";
      photoInput.current.click();
    }
  }

  async function attachPhoto(file: File | null) {
    const id = photoTarget;
    setPhotoTarget("");
    if (!file || !id) return;
    try {
      const image = await thumbnailFromFile(file);
      if (!image) throw new Error("That photo could not be read. Try a JPG, PNG, or WebP image.");
      const { item } = await savePartPhoto(id, image);
      replaceItem(item);
      setError("");
    } catch (failure) {
      reportError(failure, "The photo could not be saved.");
    }
  }

  async function saveEdit(changes: PartEdit) {
    if (!editItem) return;
    setSavingEdit(true);
    setEditError("");
    try {
      const result = await updatePart(editItem.id, { ...changes, expectedCurrentQuantity: editItem.quantity });
      setEditItem(null);
      // A merge removes one row and grows another, so totals and counts move too.
      if (result.mergedFromId) await load();
      else {
        replaceItem(result.item);
        setSummary((current) => ({
          ...current,
          totalUnits: current.totalUnits - editItem.quantity + result.item.quantity,
        }));
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409 && failure.item) {
        setEditItem(failure.item);
        replaceItem(failure.item);
        setEditError("Someone changed this part while you were editing. The latest values are shown — try again.");
      } else {
        setEditError(failure instanceof Error ? failure.message : "The part could not be updated.");
      }
    } finally {
      setSavingEdit(false);
    }
  }

  function scheduleRemoval(item: InventoryItem, quantity: number) {
    const scheduled = removalController.current.schedule({
      item,
      quantity,
      onOptimistic: () => {},
      onRestore: () => {},
      commit: () => removePart(item.id, quantity, item.quantity),
      onCommitted: (result) => {
        if (result) {
          responseGuard.current.recordMutation();
          setItems((current) =>
            result.deleted ? current.filter((part) => part.id !== result.id) : current.map((part) => (part.id === result.item.id ? result.item : part)),
          );
          setSummary((current) => ({
            ...current,
            totalTypes: result.deleted ? current.totalTypes - 1 : current.totalTypes,
            totalUnits: current.totalUnits - quantity,
          }));
        }
        setPendingRemovals((current) => current.filter((pending) => pending.item.id !== item.id));
        setError("");
      },
      onError: (failure) => {
        setPendingRemovals((current) => current.filter((pending) => pending.item.id !== item.id));
        reportError(failure, "The component could not be removed.");
        if (failure instanceof ApiError && failure.status === 409) {
          if (failure.item) replaceItem(failure.item);
          void load();
        }
      },
    });
    if (scheduled) setPendingRemovals((current) => [...current, { item, quantity, deadline: Date.now() + 10_000 }]);
    setRemoveItem(null);
  }

  function undoRemoval(id: string) {
    if (removalController.current.undo(id)) {
      setPendingRemovals((current) => current.filter((pending) => pending.item.id !== id));
      requestAnimationFrame(() => removalOpeners.current.get(id)?.focus());
    }
  }

  function selectCategory(next: string) {
    setCategory(next);
    setLocation(null);
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

  return (
    <>
      <section className="hero camera-hero">
        <div>
          <p className="eyebrow">POINT YOUR CAMERA AT THE PILE</p>
          <h1>Photograph it.<br /><em>It&rsquo;s catalogued.</em></h1>
          <p className="hero-copy">One photo identifies every board, sensor, and mystery module in the frame, crops a picture of each part, and files it in your cabinet.</p>
          <div className="hero-actions">
            <button className="hero-camera-button" onClick={onIdentify}><span aria-hidden="true">◉</span> Identify with camera</button>
            <span className="hero-hint">Camera or uploaded photo · review every result before it is saved</span>
          </div>
        </div>
        <div className="hero-stats" aria-label="Inventory overview">
          <div><strong>{summary.totalTypes}</strong><span>types catalogued</span></div>
          <div><strong>{summary.totalUnits}</strong><span>total components</span></div>
          <div><strong>{summary.photographed}</strong><span>with a photo</span></div>
        </div>
      </section>

      <section className="toolbar" aria-label="Inventory controls">
        <label className="search">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search parts, labels, or functions…" />
        </label>
        <label className="sort-control">
          <span className="visually-hidden">Sort by</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as InventorySort)}>
            {SORT_LABELS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        <button className="add-button" onClick={onIdentify}><span aria-hidden="true">◉</span> Identify &amp; catalogue</button>
      </section>

      <section className="inventory-layout">
        <aside>
          <p className="aside-title">CATEGORIES</p>
          {[ALL_CATEGORIES, ...INVENTORY_CATEGORIES].map((entry) => {
            const count = entry === ALL_CATEGORIES ? summary.totalTypes : categoryCounts.get(entry) ?? 0;
            return (
              <button key={entry} className={category === entry && !location ? "selected" : ""} onClick={() => selectCategory(entry)}>
                <span>{entry}</span><b>{count}</b>
              </button>
            );
          })}

          {summary.locations.length > 0 && (
            <>
              <p className="aside-title bins-title">BINS</p>
              {summary.locations.map((entry) => (
                <button
                  key={entry.location}
                  className={location === entry.location ? "selected" : ""}
                  onClick={() => { setLocation(entry.location); setCategory(ALL_CATEGORIES); }}
                >
                  <span>⌖ {entry.location}</span><b>{entry.count}</b>
                </button>
              ))}
            </>
          )}

          <div className="identify-card">
            <span className="identify-icon">◉</span>
            <h3>Every part starts with a photo</h3>
            <p>Snap the whole handful at once. Gemini names each one, you review, and each part keeps its own cropped picture.</p>
            <button onClick={onIdentify}>Open the camera →</button>
          </div>
        </aside>

        <div className="parts-panel">
          {error && <p className="inventory-message error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
          {loading && <p className="inventory-message" role="status">Loading inventory…</p>}
          <div className="section-heading">
            <div><p className="eyebrow">INVENTORY</p><h2>{location ? `Bin ${location}` : category}</h2></div>
            <p>Showing {displayed.length} of {location ? displayed.length : categoryCounts.get(category) ?? summary.totalTypes} component types</p>
          </div>

          <div className="parts-grid">
            {displayed.map((part) => (
              <article className="part-card" key={part.id}>
                <div className={`part-visual purple ${part.hasImage ? "has-photo" : ""}`}>
                  {part.hasImage ? <img src={partPhotoUrl(part)} alt={part.name} loading="lazy" /> : <span>{symbolFor(part.name)}</span>}
                  <small>{part.code}</small>
                  {!part.hasImage && <button type="button" className="attach-photo-button" onClick={() => openPhotoPicker(part.id)}>＋ Add photo</button>}
                </div>
                <div className="part-body">
                  <div className="part-top"><span>{part.category}</span><strong>×{part.quantity}</strong></div>
                  <h3>{part.name}</h3>
                  <p>{part.description}</p>
                  <div className="tags">{part.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <footer>
                    <span>⌖ {part.location}</span>
                    <span className="card-actions">
                      <button type="button" className="edit-part-button" onClick={() => { setEditItem(part); setEditError(""); }} aria-label={`Edit ${part.name}`}>Edit</button>
                      <button
                        ref={(element) => { if (element) removalOpeners.current.set(part.id, element); else removalOpeners.current.delete(part.id); }}
                        type="button"
                        className="remove-part-button"
                        disabled={pendingRemovals.some((pending) => pending.item.id === part.id)}
                        onClick={() => setRemoveItem(part)}
                        aria-label={`Remove ${part.name} from inventory`}
                      >
                        Remove
                      </button>
                    </span>
                  </footer>
                </div>
              </article>
            ))}

            {displayed.length === 0 && !loading && (
              <div className="empty">
                <strong>No parts found</strong>
                <p>{summary.totalTypes === 0 ? "Photograph your first handful of components to fill the cabinet." : "Try a different search, bin, or category."}</p>
                {summary.totalTypes === 0 && <button type="button" className="empty-camera-button" onClick={onIdentify}>◉ Identify with camera</button>}
              </div>
            )}
          </div>

          {nextCursor && (
            <button type="button" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more parts"}
            </button>
          )}
        </div>
      </section>

      <input
        ref={photoInput}
        className="hidden-photo-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => void attachPhoto(event.target.files?.[0] || null)}
      />

      {editItem && (
        <EditPartDialog
          item={editItem}
          saving={savingEdit}
          error={editError}
          onCancel={() => setEditItem(null)}
          onSave={(changes) => void saveEdit(changes)}
        />
      )}
      {removeItem && (
        <RemoveInventoryDialog
          item={removeItem}
          onCancel={() => {
            const id = removeItem.id;
            setRemoveItem(null);
            requestAnimationFrame(() => removalOpeners.current.get(id)?.focus());
          }}
          onConfirm={(quantity) => scheduleRemoval(removeItem, quantity)}
        />
      )}
      {pendingRemovals.length > 0 && (
        <div className="removal-toast-stack">
          {pendingRemovals.map((pending) => (
            <PendingRemovalToast
              key={pending.item.id}
              quantity={pending.quantity}
              name={pending.item.name}
              deadline={pending.deadline}
              onUndo={() => undoRemoval(pending.item.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}
