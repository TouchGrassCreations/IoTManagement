import type { Alternative, BoundingBox, ConfirmRequest, Detection, ReviewItem } from "./types.ts";

const MAX_ITEMS = 50;
export const INVENTORY_CATEGORIES = ["Microcontrollers & Compute", "Sensors", "Cameras & Vision", "Motors & Actuators", "Motor Drivers & Power Drivers", "Power Sources", "Power Management", "Communication Modules", "Displays & Indicators", "Input & Controls", "Passive Components", "Active Components", "Prototyping & PCB", "Wiring & Connectors", "Mechanical / Robotics", "Fasteners & Mounting", "Tools & Test Equipment", "Consumables", "Storage / Spare Parts", "Others"] as const;
export function normalizeCategory(value: string) {
  const category = value.trim().toLowerCase();
  const exact = INVENTORY_CATEGORIES.find((item) => item.toLowerCase() === category);
  if (exact) return exact;
  if (/esp32.?cam|camera|vision|ov2640/.test(category)) return "Cameras & Vision";
  if (/sensor|transducer/.test(category)) return "Sensors";
  if (/motor driver|power driver|h-bridge|l298|tb6612|bts7960|mosfet module|relay module|\bdrivers?\b/.test(category)) return "Motor Drivers & Power Drivers";
  if (/actuator|motor|servo|stepper|solenoid/.test(category)) return "Motors & Actuators";
  if (/microcontroller|compute|arduino|esp32|esp8266|raspberry pi|jetson|development board|\bboards?\b/.test(category)) return "Microcontrollers & Compute";
  if (/battery holder|bms|buck|boost|converter|power management|regulator module|charger/.test(category)) return "Power Management";
  if (/power source|battery pack|power bank|\bbatter(?:y|ies)\b|\bcells?\b|18650|lipo|aa\/aaa/.test(category)) return "Power Sources";
  if (/communication|wireless|radio|bluetooth|wi-?fi|lora|nrf24|gsm|lte|gps/.test(category)) return "Communication Modules";
  if (/display|indicator|screen|oled|lcd|tft|\b leds?\b|rgb|buzzer/.test(` ${category}`)) return "Displays & Indicators";
  if (/input|control|button|switch|potentiometer|encoder|joystick|keypad/.test(category)) return "Input & Controls";
  if (/passive|resistor|capacitor|inductor|\bdiodes?\b/.test(category)) return "Passive Components";
  if (/active component|transistor|mosfet|\bics?\b|op-amp|voltage regulator/.test(category)) return "Active Components";
  if (/breadboard|perfboard|\bpcbs?\b|prototype|prototyping|header pin|\bsockets?\b/.test(category)) return "Prototyping & PCB";
  if (/jumper|dupont|jst|terminal|usb cable|barrel connector|connector|interconnect|wiring/.test(category)) return "Wiring & Connectors";
  if (/mechanical|robot|wheel|chassis|bracket|coupler|gear|shaft/.test(category)) return "Mechanical / Robotics";
  if (/fastener|mounting|screw|\bnuts?\b|spacer|standoff|cable tie|double-sided tape/.test(category)) return "Fasteners & Mounting";
  if (/tool|test equipment|multimeter|soldering iron|wire stripper|crimper|logic analyzer/.test(category)) return "Tools & Test Equipment";
  if (/consumable|solder|flux|heat.?shrink|electrical tape|hookup wire/.test(category)) return "Consumables";
  if (/storage|spare|salvaged|unidentified|unknown/.test(category)) return "Storage / Spare Parts";
  if (category === "boards") return "Microcontrollers & Compute";
  if (category === "actuators") return "Motors & Actuators";
  if (category === "drivers") return "Motor Drivers & Power Drivers";
  if (category === "displays") return "Displays & Indicators";
  if (category === "communication") return "Communication Modules";
  if (category === "power") return "Power Management";
  if (category === "passives") return "Passive Components";
  if (category === "interconnects") return "Wiring & Connectors";
  if (/prototyping/.test(category)) return "Prototyping & PCB";
  if (category === "tools") return "Tools & Test Equipment";
  return "Others";
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
};
const text = (value: unknown, field: string, max = 120) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return value.trim();
};
const nullableText = (value: unknown, field: string) => value === null || value === "" ? null : text(value, field);
const strings = (value: unknown, field: string, max = 10) => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} is invalid`);
  return value.map((item) => text(item, field, 120));
};
const box = (value: unknown): BoundingBox => {
  const v = object(value);
  const result = { top: Number(v.top), left: Number(v.left), width: Number(v.width), height: Number(v.height) };
  if (Object.values(result).some((n) => !Number.isFinite(n) || n < 0 || n > 1) || result.top + result.height > 1.001 || result.left + result.width > 1.001 || result.width === 0 || result.height === 0) throw new Error("boundingBox is invalid");
  return result;
};

export function normalizeIdentity(value: string) {
  return value.normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").trim().replace(/\s+/g, " ").toLowerCase();
}

function alternatives(value: unknown): Alternative[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error("alternatives is invalid");
  return value.map((candidate) => { const v = object(candidate); return { name: text(v.name, "alternative name"), model: nullableText(v.model, "alternative model") }; });
}

function detection(value: unknown): Detection {
  const v = object(value);
  const quantity = Number(v.quantity); const confidence = Number(v.confidence);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("quantity is invalid");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("confidence is invalid");
  return { name: text(v.name, "Name"), model: nullableText(v.model, "Model"), category: normalizeCategory(text(v.category, "Category")), quantity, boundingBox: box(v.boundingBox), confidence, visibleMarkings: strings(v.visibleMarkings, "visibleMarkings"), alternatives: alternatives(v.alternatives), description: text(v.description, "Description", 500), tags: strings(v.tags, "tags") };
}

export function validateGeminiPayload(value: unknown): Detection[] {
  const detections = object(value).detections;
  if (!Array.isArray(detections) || detections.length > MAX_ITEMS) throw new Error("detections is invalid");
  return detections.map(detection);
}

export function validateConfirmationPayload(value: unknown): ConfirmRequest {
  const v = object(value); const token = text(v.token, "token", 2000);
  if (!Array.isArray(v.items) || v.items.length > MAX_ITEMS) throw new Error("items is invalid");
  const items = v.items.flatMap((raw, index): ReviewItem[] => {
    const row = object(raw);
    if (typeof row.id !== "string" || typeof row.accepted !== "boolean" || !["gemini", "manual"].includes(String(row.source))) throw new Error(`Component ${index + 1}: Review data is invalid`);
    if (!row.accepted) return [];
    try {
      const base = detection({ ...row, boundingBox: row.boundingBox ?? { top: 0, left: 0, width: 1, height: 1 }, confidence: row.confidence ?? 0 });
      return [{ ...base, id: row.id, accepted: true, source: row.source as "gemini" | "manual", boundingBox: row.boundingBox === null ? null : base.boundingBox, confidence: row.confidence === null ? null : base.confidence, detectedName: row.source === "gemini" ? nullableText(row.detectedName ?? row.name, "Detected name") : null, detectedModel: row.source === "gemini" ? nullableText(row.detectedModel ?? row.model, "Detected model") : null }];
    } catch (error) {
      throw new Error(`Component ${index + 1}: ${error instanceof Error ? error.message : "Invalid data"}`);
    }
  });
  if (!items.some((item) => item.accepted)) throw new Error("At least one item must be accepted");
  return { token, items };
}
