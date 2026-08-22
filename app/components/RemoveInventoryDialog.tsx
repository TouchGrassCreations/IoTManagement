"use client";

import { useEffect, useRef, useState } from "react";
import type { InventoryItem } from "../../lib/inventory/types.ts";

export default function RemoveInventoryDialog({ item, onCancel, onConfirm }: { item: InventoryItem; onCancel: () => void; onConfirm: (quantity: number) => void }) {
  const [quantity, setQuantity] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);
  const removesAll = quantity === item.quantity;

  return <div className="modal-backdrop">
    <div className="modal remove-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-warning">
      <p className="eyebrow">ADJUST INVENTORY</p>
      <h2 id="remove-title">Remove {item.name}?</h2>
      <p>{item.model || "Model unknown"} · Current stock: {item.quantity}</p>
      <label>Quantity to remove
        <input ref={inputRef} type="number" min="1" max={item.quantity} value={quantity} onChange={(event) => setQuantity(Math.min(item.quantity, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))} />
      </label>
      <p id="remove-warning" className={removesAll ? "destructive-warning" : "quantity-warning"}>
        {removesAll ? "This removes the component and permanently deletes all of its identification and adjustment history after the Undo period." : `${item.quantity - quantity} will remain in stock. This adjustment will be recorded in the audit history.`}
      </p>
      <div className="dialog-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-button" onClick={() => onConfirm(quantity)}>Confirm removal</button>
      </div>
    </div>
  </div>;
}
