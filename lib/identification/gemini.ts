import { validateGeminiPayload } from "./validation.ts";
import type { Detection } from "./types.ts";

const basePrompt = `Identify one or more distinct IoT, electronics, mechanical, or robotics inventory items in this image. Deliberately scan the entire frame, including every edge and corner, before responding. Include partially visible or cropped items when distinctive visible features support their general identity; reduce confidence and set model to null when the exact model is not supported. An item touching or extending beyond an image boundary must not be omitted solely because it is cropped.

Treat each assembled electronic module or development board as one component; do not break it into chips, sensors, connectors, or other parts mounted on it. For example, identify an ESP32-CAM as one component, not as its ESP32 chip, camera, antenna, and supporting circuitry. For a mechanical or robotics assembly, identify major visually distinguishable inventory parts separately even when attached, such as a mecanum wheel, aluminum robot chassis, motor, bracket, or coupler. Separately placed detachable modules remain separate components. Do not infer completely hidden parts, and do not count duplicates unless each instance is visibly supported. Group visually identical repeated components and set quantity to their actual count, which may be greater than one. Return only a JSON object shaped exactly like:
{"detections":[{"name":"string","model":"string or null","category":"string","quantity":"integer actual count","boundingBox":{"top":0.0,"left":0.0,"width":0.1,"height":0.1},"confidence":0.0,"visibleMarkings":["string"],"alternatives":[{"name":"string","model":"string or null"}],"description":"string","tags":["string"]}]}
Use exact model names only when visible markings support them; otherwise set model to null. Choose exactly one category from: Microcontrollers & Compute; Sensors; Cameras & Vision; Motors & Actuators; Motor Drivers & Power Drivers; Power Sources; Power Management; Communication Modules; Displays & Indicators; Input & Controls; Passive Components; Active Components; Prototyping & PCB; Wiring & Connectors; Mechanical / Robotics; Fasteners & Mounting; Tools & Test Equipment; Consumables; Storage / Spare Parts; Others. An ESP32-CAM is Cameras & Vision. A standalone voltage-regulator IC is Active Components, while an assembled regulator or converter module is Power Management. Unidentified, salvaged, or explicitly spare items are Storage / Spare Parts; use Others only when no listed category fits. Bounding boxes and confidence are numbers from 0 to 1. Use empty arrays when there are no markings, alternatives, or tags. Do not invent text that is not visible.`;

/**
 * The cabinet's project names come from the server, never the browser, so a
 * client cannot shape the prompt. `projectMatch` is constrained to that list;
 * `projectIdeas` is where the model is free to propose something new.
 */
export function promptFor(projects: string[]): string {
  const known = projects.slice(0, 40);
  const matching = known.length
    ? `The cabinet already contains these projects: ${known.map((name) => JSON.stringify(name)).join(", ")}. For each component set "projectMatch" to the exact name of the one project it most likely belongs to, copied character for character from that list, or null when none of them fit. Never put a name outside that list in projectMatch.`
    : `The cabinet has no projects yet, so set "projectMatch" to null for every component.`;
  return `${basePrompt}
${matching} Also set "projectIdeas" to at most two builds this component would make possible, each shaped {"name":"short project name","reason":"one short sentence on what the component does for it"}. Suggest ideas that suit hobby IoT, electronics and robotics builds, and use an empty array when nothing fits. Include "projectMatch" and "projectIdeas" on every detection.`;
}

function normalizeGeminiBoxes(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const payload = value as { detections?: Array<{ boundingBox?: Record<string, unknown> }> };
  for (const detection of payload.detections ?? []) {
    const box = detection.boundingBox;
    if (!box) continue;
    let coordinates = [box.top, box.left, box.width, box.height].map(Number);
    const looksLikeIntegerScale = coordinates.every(Number.isInteger) && coordinates.some((coordinate) => coordinate > 1);
    if (coordinates.some((coordinate) => coordinate >= 10) || looksLikeIntegerScale) {
      coordinates = coordinates.map((coordinate) => coordinate / 1000);
    }
    const round = (coordinate: number) => Math.round(coordinate * 1_000_000) / 1_000_000;
    const top = Math.min(.999, Math.max(0, coordinates[0]));
    const left = Math.min(.999, Math.max(0, coordinates[1]));
    const width = Math.min(1 - left, Math.max(.001, coordinates[2]));
    const height = Math.min(1 - top, Math.max(.001, coordinates[3]));
    [box.top, box.left, box.width, box.height] = [top, left, width, height].map(round);
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function recognizeComponents(input: { bytes: Uint8Array; mimeType: string; fetchImpl?: typeof fetch; apiKey?: string; model?: string; projects?: string[] }): Promise<Detection[]> {
  const key = input.apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API key is not configured");
  const model = input.model ?? process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  const base64 = bytesToBase64(input.bytes);
  const response = await (input.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ contents: [{ parts: [{ text: promptFor(input.projects ?? []) }, { inlineData: { mimeType: input.mimeType, data: base64 } }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(`Gemini returned ${response.status}: ${failure?.error?.message || "Unknown provider error"}`);
  }
  const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const output = json.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!output) throw new Error("Gemini returned no structured result");
  return validateGeminiPayload(normalizeGeminiBoxes(JSON.parse(output)));
}
