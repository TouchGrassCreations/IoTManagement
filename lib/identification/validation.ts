import type { Alternative, BoundingBox, ConfirmRequest, Detection, ProjectIdea, ReviewItem } from "./types.ts";
import { validatePartImage } from "./image.ts";

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
  const raw = object(value);
  const result = { top: Number(raw.top), left: Number(raw.left), width: Number(raw.width), height: Number(raw.height) };
  const outOfRange = Object.values(result).some((edge) => !Number.isFinite(edge) || edge < 0 || edge > 1);
  // The 1.001 slack absorbs the model's rounding without accepting a box that
  // genuinely runs off the photo.
  const overflows = result.top + result.height > 1.001 || result.left + result.width > 1.001;
  if (outOfRange || overflows || result.width === 0 || result.height === 0) throw new Error("boundingBox is invalid");
  return result;
};

/** Short label shown on a part card. Falls back to the model-unknown marker. */
export function partCode(model: string | null) {
  const code = (model ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14)
    .replace(/-+$/, "");
  return code || "MODEL-UNKNOWN";
}

export function normalizeIdentity(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function alternatives(value: unknown): Alternative[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error("alternatives is invalid");
  return value.map((candidate) => {
    const raw = object(candidate);
    return { name: text(raw.name, "alternative name"), model: nullableText(raw.model, "alternative model") };
  });
}

/** Absent or empty ideas are normal: not every part suggests a build. */
function projectIdeas(value: unknown): ProjectIdea[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error("projectIdeas is invalid");
  return value.map((candidate) => {
    const raw = object(candidate);
    const reason = raw.reason === undefined || raw.reason === null || raw.reason === "";
    return { name: text(raw.name, "project idea name"), reason: reason ? "" : text(raw.reason, "project idea reason", 300) };
  });
}

function optionalText(value: unknown, field: string, max = 120): string | null {
  return value === undefined || value === null || value === "" ? null : text(value, field, max);
}

function detection(value: unknown): Detection {
  const raw = object(value);
  const quantity = Number(raw.quantity);
  const confidence = Number(raw.confidence);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("quantity is invalid");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("confidence is invalid");

  return {
    name: text(raw.name, "Name"),
    model: nullableText(raw.model, "Model"),
    category: normalizeCategory(text(raw.category, "Category")),
    quantity,
    boundingBox: box(raw.boundingBox),
    confidence,
    visibleMarkings: strings(raw.visibleMarkings, "visibleMarkings"),
    alternatives: alternatives(raw.alternatives),
    description: text(raw.description, "Description", 500),
    tags: strings(raw.tags, "tags"),
    projectMatch: optionalText(raw.projectMatch, "projectMatch"),
    projectIdeas: projectIdeas(raw.projectIdeas),
  };
}

export function validateGeminiPayload(value: unknown): Detection[] {
  const detections = object(value).detections;
  if (!Array.isArray(detections) || detections.length > MAX_ITEMS) throw new Error("detections is invalid");
  return detections.map(detection);
}

/** A manual row carries no box or confidence, so stand-ins keep `detection` happy. */
const WHOLE_IMAGE_BOX = { top: 0, left: 0, width: 1, height: 1 };

function reviewItem(raw: unknown): ReviewItem[] {
  const row = object(raw);
  const validSource = ["gemini", "manual"].includes(String(row.source));
  if (typeof row.id !== "string" || typeof row.accepted !== "boolean" || !validSource) {
    throw new Error("Review data is invalid");
  }
  if (!row.accepted) return [];

  const base = detection({
    ...row,
    boundingBox: row.boundingBox ?? WHOLE_IMAGE_BOX,
    confidence: row.confidence ?? 0,
  });
  const fromGemini = row.source === "gemini";
  const unset = row.location === undefined || row.location === null || row.location === "";
  const projectId = optionalText(row.projectId, "Project", 64);
  const newProjectName = optionalText(row.newProjectName, "New project name");
  if (projectId && newProjectName) throw new Error("Choose either an existing project or a new one");

  return [{
    ...base,
    id: row.id,
    accepted: true,
    source: row.source as "gemini" | "manual",
    boundingBox: row.boundingBox === null ? null : base.boundingBox,
    confidence: row.confidence === null ? null : base.confidence,
    detectedName: fromGemini ? nullableText(row.detectedName ?? row.name, "Detected name") : null,
    detectedModel: fromGemini ? nullableText(row.detectedModel ?? row.model, "Detected model") : null,
    location: unset ? "Unsorted" : text(row.location, "Storage location"),
    image: validatePartImage(row.image),
    projectId,
    newProjectName,
    projectReason: optionalText(row.projectReason, "Project reason", 300),
  }];
}

export function validateConfirmationPayload(value: unknown): ConfirmRequest {
  const raw = object(value);
  const token = text(raw.token, "token", 2000);
  if (!Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) throw new Error("items is invalid");

  const items = raw.items.flatMap((row, index): ReviewItem[] => {
    try {
      return reviewItem(row);
    } catch (error) {
      throw new Error(`Component ${index + 1}: ${error instanceof Error ? error.message : "Invalid data"}`);
    }
  });

  if (!items.some((item) => item.accepted)) throw new Error("At least one item must be accepted");
  return { token, items };
}
