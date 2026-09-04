"use client";

import { useState } from "react";
import HistoryView from "./components/HistoryView";
import IdentificationWorkspace from "./components/IdentificationWorkspace";
import InventoryView from "./components/InventoryView";
import ProjectsView from "./components/ProjectsView";

const nav = ["Inventory", "Projects", "History"] as const;

export default function Home() {
  const [view, setView] = useState<(typeof nav)[number]>("Inventory");
  const [isIdentifying, setIsIdentifying] = useState(false);
  // Bumped after a confirmed scan so the inventory reloads from the server.
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("Inventory")} aria-label="Parts Cabinet home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Parts Cabinet</span>
        </button>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="camera-button" onClick={() => setIsIdentifying(true)}>
            <span aria-hidden="true">◉</span> Identify a part
          </button>
          <button className="avatar" aria-label="Account">RK</button>
        </div>
      </header>

      {view === "Inventory" && (
        <InventoryView refreshToken={refreshToken} onIdentify={() => setIsIdentifying(true)} />
      )}
      {view === "Projects" && <ProjectsView />}
      {view === "History" && <HistoryView refreshToken={refreshToken} />}

      {isIdentifying && (
        <IdentificationWorkspace
          onClose={() => setIsIdentifying(false)}
          onConfirmed={() => setRefreshToken((current) => current + 1)}
        />
      )}
    </main>
  );
}
