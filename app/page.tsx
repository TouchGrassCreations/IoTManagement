"use client";

import { useMemo, useState } from "react";
import IdentificationWorkspace from "./components/IdentificationWorkspace";
import type { InventoryResult } from "../lib/identification/types";

type Part = {
  id: number | string;
  name: string;
  category: string;
  quantity: number;
  location: string;
  code: string;
  tone: string;
  symbol: string;
  description: string;
  tags: string[];
};

const starterParts: Part[] = [
  { id: 1, name: "Arduino Uno R3", category: "Boards", quantity: 3, location: "Bin A1", code: "ARD-UNO", tone: "blue", symbol: "UNO", description: "ATmega328P development board for rapid prototyping.", tags: ["5V", "Digital", "Analog"] },
  { id: 2, name: "ESP32 DevKit V1", category: "Boards", quantity: 2, location: "Bin A2", code: "ESP-32", tone: "navy", symbol: "32", description: "Wi-Fi and Bluetooth enabled microcontroller board.", tags: ["Wi-Fi", "Bluetooth", "3.3V"] },
  { id: 3, name: "DHT22", category: "Sensors", quantity: 4, location: "Bin B1", code: "SNS-DHT22", tone: "white", symbol: "°%", description: "Digital temperature and humidity sensor.", tags: ["Temperature", "Humidity", "Digital"] },
  { id: 4, name: "HC-SR04", category: "Sensors", quantity: 6, location: "Bin B2", code: "SNS-US04", tone: "teal", symbol: ")))", description: "Ultrasonic distance sensor with a 2–400 cm range.", tags: ["Distance", "5V", "Digital"] },
  { id: 5, name: "PIR Motion Sensor", category: "Sensors", quantity: 2, location: "Bin B3", code: "SNS-PIR", tone: "mint", symbol: "PIR", description: "Passive infrared sensor for detecting human motion.", tags: ["Motion", "Digital", "5V"] },
  { id: 6, name: "L298N Motor Driver", category: "Drivers", quantity: 2, location: "Bin C1", code: "DRV-L298", tone: "red", symbol: "M↔", description: "Dual H-bridge driver for DC motors and steppers.", tags: ["Motor", "12V", "Dual channel"] },
  { id: 7, name: "SG90 Micro Servo", category: "Actuators", quantity: 8, location: "Bin C2", code: "ACT-SG90", tone: "sky", symbol: "90°", description: "Compact 180° positional servo for lightweight mechanisms.", tags: ["Servo", "PWM", "5V"] },
  { id: 8, name: "Soil Moisture Probe", category: "Sensors", quantity: 5, location: "Bin B4", code: "SNS-SOIL", tone: "green", symbol: "H₂O", description: "Analog probe for estimating soil moisture levels.", tags: ["Soil", "Analog", "Farm"] },
  { id: 9, name: "Mini Breadboard", category: "Prototyping", quantity: 7, location: "Bin D1", code: "PRT-BRD", tone: "cream", symbol: "•••", description: "170-point solderless board for compact circuits.", tags: ["Prototype", "Reusable"] },
];

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
  const [parts, setParts] = useState(starterParts);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All parts");
  const [isAdding, setIsAdding] = useState(false);
  const [isIdentifying, setIsIdentifying] = useState(false);

  const categories = ["All parts", "Boards", "Sensors", "Drivers", "Actuators", "Prototyping"];
  const filtered = useMemo(() => parts.filter((part) => {
    const matchesCategory = category === "All parts" || part.category === category;
    const haystack = `${part.name} ${part.code} ${part.category} ${part.tags.join(" ")}`.toLowerCase();
    return matchesCategory && haystack.includes(query.toLowerCase());
  }), [parts, query, category]);
  const unitCount = parts.reduce((sum, part) => sum + part.quantity, 0);

  function addPart(formData: FormData) {
    const name = String(formData.get("name") || "Unnamed component");
    const newPart: Part = {
      id: Date.now(), name, category: String(formData.get("category") || "Sensors"),
      quantity: Number(formData.get("quantity")) || 1, location: String(formData.get("location") || "Unsorted"),
      code: `NEW-${parts.length + 1}`, tone: "purple", symbol: name.slice(0, 3).toUpperCase(),
      description: "Newly catalogued component. Add notes after identification.", tags: ["New", "Needs review"],
    };
    setParts((current) => [newPart, ...current]);
    setIsAdding(false);
  }

  function applyIdentified(identified: InventoryResult[]) {
    setParts((current) => {
      const next = [...current];
      for (const item of identified) {
        const index = next.findIndex((part) => part.name.toLowerCase() === item.name.toLowerCase());
        const converted: Part = { id: item.id, name: item.name, category: item.category, quantity: item.quantity, location: "Unsorted", code: item.model || "MODEL-UNKNOWN", tone: "purple", symbol: item.name.slice(0, 3).toUpperCase(), description: item.description, tags: item.tags };
        if (index >= 0) next[index] = { ...next[index], ...converted }; else next.unshift(converted);
      }
      return next;
    });
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
              <div><strong>{parts.length}</strong><span>types catalogued</span></div>
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
                const count = item === "All parts" ? parts.length : parts.filter((p) => p.category === item).length;
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
              <div className="section-heading">
                <div><p className="eyebrow">INVENTORY</p><h2>{category}</h2></div>
                <p>Showing {filtered.length} of {parts.length} component types</p>
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
                      <footer><span>⌖ {part.location}</span><button aria-label={`More options for ${part.name}`}>•••</button></footer>
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
    </main>
  );
}
