"use client";

import Link from "next/link";
import { useState } from "react";
import InventoryView from "./InventoryView";
import ProjectsView from "./ProjectsView";

const nav = ["Inventory", "Projects"] as const;

/** A cabinet somebody shared: the owner's views, with nothing to press. */
export default function SharedCabinetView({ ownerId, label }: { ownerId: string; label: string | null }) {
  const [view, setView] = useState<(typeof nav)[number]>("Inventory");
  const owner = label || "A maker";

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Parts Cabinet</span>
        </span>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>
          ))}
        </nav>
        <div className="header-actions">
          <Link className="camera-button" href="/">Open your own</Link>
        </div>
      </header>

      <p className="visitor-banner" role="status">
        You are viewing <strong>{owner}</strong>&rsquo;s shared cabinet. It is read-only.
      </p>

      {view === "Inventory" && <InventoryView refreshToken={0} onIdentify={() => {}} owner={ownerId} canEdit={false} />}
      {view === "Projects" && <ProjectsView owner={ownerId} canEdit={false} />}
    </main>
  );
}
