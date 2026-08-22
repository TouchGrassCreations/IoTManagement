import { validateGeminiPayload } from "./validation.ts";
import type { Detection } from "./types.ts";

const prompt = `Identify every distinct IoT/electronics component in this image. Group identical repeated parts and count them. Return only JSON matching the schema. Use exact model names only when visible markings support them; otherwise set model to null. Bounding boxes are normalized 0..1 coordinates. Do not invent text that is not visible.`;

export async function recognizeComponents(input: { bytes: Uint8Array; mimeType: string; fetchImpl?: typeof fetch }): Promise<Detection[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API key is not configured");
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const base64 = Buffer.from(input.bytes).toString("base64");
  const response = await (input.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: input.mimeType, data: base64 } }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object", required: ["detections"], properties: { detections: { type: "array", maxItems: 50, items: { type: "object", required: ["name", "model", "category", "quantity", "boundingBox", "confidence", "visibleMarkings", "alternatives", "description", "tags"], properties: { name: { type: "string" }, model: { anyOf: [{ type: "string" }, { type: "null" }] }, category: { type: "string" }, quantity: { type: "integer" }, boundingBox: { type: "object", properties: { top: { type: "number" }, left: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, required: ["top", "left", "width", "height"] }, confidence: { type: "number" }, visibleMarkings: { type: "array", items: { type: "string" } }, alternatives: { type: "array", items: { type: "object", properties: { name: { type: "string" }, model: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["name", "model"] } }, description: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } } } } }),
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const output = json.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!output) throw new Error("Gemini returned no structured result");
  return validateGeminiPayload(JSON.parse(output));
}
