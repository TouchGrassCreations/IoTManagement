"use client";

import { useEffect, useRef, useState } from "react";
import { INVENTORY_CATEGORIES } from "../../lib/identification/validation.ts";
import type { InventoryItem } from "../../lib/inventory/types.ts";

export type PartEdit = {
  name: string;
  model: string | null;
  category: string;
  location: string;
  description: string;
  tags: string[];
  quantityDelta: number;
};

type Props = {
  item: InventoryItem;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: (changes: PartEdit) => void;
};

export default function EditPartDialog({ item, saving, error, onCancel, onSave }: Props) {
  const [name, setName] = useState(item.name);
  const [model, setModel] = useState(item.model ?? "");
  const [category, setCategory] = useState(item.category);
  const [location, setLocation] = useState(item.location);
  const [description, setDescription] = useState(item.description);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [quantity, setQuantity] = useState(item.quantity);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  const identityChanged = name.trim() !== item.name || (model.trim() || null) !== item.model;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave({
      name: name.trim(),
      model: model.trim() || null,
      category,
      location: location.trim() || "Unsorted",
      description: description.trim(),
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 10),
      quantityDelta: quantity - item.quantity,
    });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <button type="button" className="close" onClick={onCancel} aria-label="Close">×</button>
        <p className="eyebrow">EDIT COMPONENT</p>
        <h2 id="edit-title">{item.name}</h2>
        <p>Correct anything identification got wrong, move it to a bin, or adjust stock you bought or used.</p>

        <form onSubmit={submit}>
          {error && <p className="identify-error" role="alert">{error}</p>}
          <label>Name<input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
          <div className="form-row">
            <label>Model<input value={model} placeholder="Model unknown" onChange={(event) => setModel(event.target.value)} maxLength={120} /></label>
            <label>In stock<input type="number" min="1" max="999999" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number.parseInt(event.target.value, 10) || 1))} /></label>
          </div>
          <div className="form-row">
            <label>Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {INVENTORY_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
              </select>
            </label>
            <label>Storage<input value={location} placeholder="Bin B5" onChange={(event) => setLocation(event.target.value)} maxLength={120} /></label>
          </div>
          <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label>
          <label>Tags<input value={tags} placeholder="Comma separated" onChange={(event) => setTags(event.target.value)} /></label>

          {identityChanged && (
            <p className="quantity-warning">
              Changing the name or model changes how this part is matched. If you already hold a part with the new
              identity, the two will be folded into one and their stock added together.
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" className="cancel-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
