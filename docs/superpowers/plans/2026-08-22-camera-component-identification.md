# Camera Component Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working prototype that identifies multiple IoT components in one camera/upload image with Gemini, lets the user correct the results, and atomically merges confirmed quantities into D1 with scan-level audit events.

**Architecture:** A client identification workspace sends one transient image to a server-only Gemini adapter and receives validated provisional detections plus an expiring confirmation token. A separate confirmation route revalidates edited items and uses a D1 batch to upsert inventory and append audit records without storing the image.

**Tech Stack:** TypeScript 5.9, React 19, vinext/Next App Router, Cloudflare Workers, Cloudflare D1, Drizzle ORM, Gemini REST API, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-22-camera-component-identification-design.md`

## Global Constraints

- Accept JPG, PNG, and WebP from camera capture or file upload.
- Process multiple components from one image with one Gemini full-image request.
- Treat Gemini output as provisional and untrusted; nothing is saved until explicit confirmation.
- Permit a null model and display it as `model unknown`.
- Merge only on normalized name plus normalized model; null models match only null models.
- Create one scan record and one append-only audit event per accepted detection.
- Store no source image bytes, path, or URL.
- Keep `GEMINI_API_KEY` server-side.
- Missing keys and recognition failures show clear errors and perform zero database writes.
- Prevent repeated confirmation from incrementing quantities twice.

## File Structure

- `lib/identification/types.ts`: provider-independent request, detection, review, and response types.
- `lib/identification/validation.ts`: image, Gemini-output, and confirmation-payload validation plus identity normalization.
- `lib/identification/gemini.ts`: server-only Gemini REST adapter.
- `lib/identification/tokens.ts`: signed, expiring, single-use confirmation token creation and verification.
- `lib/identification/persistence.ts`: atomic D1 merge and audit batch.
- `app/api/identify/route.ts`: transient image recognition endpoint.
- `app/api/identify/confirm/route.ts`: reviewed-batch persistence endpoint.
- `app/components/IdentificationWorkspace.tsx`: camera/upload, preview, editable multi-item review, and confirmation UI.
- `app/page.tsx`: inventory state integration and identify entry point.
- `app/globals.css`: responsive identification workspace styles.
- `db/schema.ts`: inventory, scan, and event tables.
- `drizzle/*.sql`: generated D1 migration.
- `tests/identification-validation.test.mjs`: validation and normalization tests against built TypeScript modules.
- `tests/identification-routes.test.mjs`: route behavior with injected provider/persistence seams.
- `tests/rendered-html.test.mjs`: updated production-render smoke assertions.

---

### Task 1: Identification Contracts and Validation

**Files:**
- Create: `lib/identification/types.ts`
- Create: `lib/identification/validation.ts`
- Create: `tests/identification-validation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `Detection`, `ReviewItem`, `RecognitionResult`, `normalizeIdentity(value: string): string`, `validateGeminiPayload(value: unknown): Detection[]`, and `validateConfirmationPayload(value: unknown): ConfirmRequest`.
- Consumes: no feature code.

- [ ] **Step 1: Add a focused TypeScript test command and write failing normalization/schema tests**

Add `"test:unit": "tsx --test tests/identification-*.test.mjs"` and dev dependency `tsx`, then test concrete behavior:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIdentity, validateGeminiPayload } from "../lib/identification/validation.ts";

test("normalizes identity without erasing model punctuation", () => {
  assert.equal(normalizeIdentity("  ESP32–CAM   AI-Thinker "), "esp32-cam ai-thinker");
});

test("accepts a bounded multi-detection response", () => {
  const detections = validateGeminiPayload({ detections: [{
    name: "PIR motion sensor", model: null, category: "Sensors", quantity: 2,
    boundingBox: { top: 0.1, left: 0.2, width: 0.3, height: 0.4 },
    confidence: 0.72, visibleMarkings: ["HC-SR501"], alternatives: [],
    description: "Passive infrared motion module", tags: ["motion", "5V"],
  }] });
  assert.equal(detections[0].quantity, 2);
});

test("rejects impossible quantities and coordinates", () => {
  assert.throws(() => validateGeminiPayload({ detections: [{ name: "x", model: null, category: "Sensors", quantity: 0, boundingBox: { top: -1, left: 0, width: 2, height: 1 }, confidence: 2, visibleMarkings: [], alternatives: [], description: "x", tags: [] }] }));
});
```

- [ ] **Step 2: Run the focused tests and verify the missing module failure**

Run: `npm run test:unit`

Expected: FAIL because `lib/identification/validation.ts` does not exist.

- [ ] **Step 3: Define exact contracts and bounded validators**

Define normalized 0–1 bounding boxes, nullable models, nullable manual confidence/bounds, maximum 50 detections, maximum quantity 999, 120-character names/models, 500-character descriptions, 10 markings/tags/alternatives, and rejection of non-object JSON. Implement Unicode NFKC normalization, dash canonicalization, trimming, whitespace collapse, and locale-insensitive lowercasing.

```ts
export type BoundingBox = { top: number; left: number; width: number; height: number };
export type Detection = {
  name: string; model: string | null; category: string; quantity: number;
  boundingBox: BoundingBox; confidence: number; visibleMarkings: string[];
  alternatives: Array<{ name: string; model: string | null }>;
  description: string; tags: string[];
};
export type ConfirmRequest = { token: string; items: ReviewItem[] };
```

- [ ] **Step 4: Run focused tests and type checking**

Run: `npm run test:unit` and `npx tsc --noEmit`

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the validated feature contracts**

```bash
git add package.json package-lock.json lib/identification tests/identification-validation.test.mjs
git commit -m "test: define identification contracts"
```

### Task 2: Gemini Recognition Adapter and Route

**Files:**
- Create: `lib/identification/gemini.ts`
- Create: `lib/identification/tokens.ts`
- Create: `app/api/identify/route.ts`
- Create: `tests/identification-routes.test.mjs`

**Interfaces:**
- Consumes: `validateGeminiPayload(value): Detection[]` from Task 1.
- Produces: `recognizeComponents(input: { bytes: Uint8Array; mimeType: string; fetchImpl?: typeof fetch }): Promise<Detection[]>`, `issueConfirmationToken(): Promise<string>`, and `POST(request): Promise<Response>`.

- [ ] **Step 1: Write failing adapter/route tests using injected fetch**

Cover supported image input, missing `GEMINI_API_KEY`, a successful structured Gemini response, non-2xx provider response, malformed provider JSON, and a valid empty detection result. Assert no image data appears in the response.

```js
test("recognition route returns provisional detections", async () => {
  const response = await identify(new Request("http://test/api/identify", {
    method: "POST", body: imageForm("image/png"),
  }), { recognize: async () => [sampleDetection], issueToken: async () => "token" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { detections: [sampleDetection], token: "token" });
});
```

- [ ] **Step 2: Run route tests and verify missing exports**

Run: `npm run test:unit`

Expected: FAIL because the adapter and route seam do not exist.

- [ ] **Step 3: Implement the server-only Gemini REST call**

Call `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` with `GEMINI_API_KEY`, default the configurable model to `gemini-3.1-flash-lite`, send inline base64 image data, request JSON output, and use an explicit response schema. Add an `AbortSignal.timeout(30000)` timeout. Prompt Gemini to group identical repeated parts, report only visible evidence, and return `model: null` when exact identity is unsupported.

- [ ] **Step 4: Implement image validation and token issuance in the route**

Accept exactly one `image` form field; allow only `image/jpeg`, `image/png`, and `image/webp`; enforce a 10 MiB prototype limit; check JPEG/PNG/WebP magic bytes; return typed 400/413/500/502/503 errors; and issue a signed 15-minute token only after valid recognition output. Use HMAC-SHA-256 with `CONFIRMATION_TOKEN_SECRET` and include a random nonce and expiry.

- [ ] **Step 5: Run focused tests and type checking**

Run: `npm run test:unit` and `npx tsc --noEmit`

Expected: adapter and route tests PASS; TypeScript exits 0.

- [ ] **Step 6: Commit the recognition boundary**

```bash
git add app/api/identify lib/identification/gemini.ts lib/identification/tokens.ts tests/identification-routes.test.mjs
git commit -m "feat: recognize components with Gemini"
```

### Task 3: D1 Inventory and Audit Persistence

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/identification/persistence.ts`
- Modify: `app/api/identify/confirm/route.ts`
- Create: `tests/identification-persistence.test.mjs`
- Create: generated `drizzle/*.sql`
- Modify: `.openai/hosting.json`

**Interfaces:**
- Consumes: `ConfirmRequest`, `normalizeIdentity`, and signed-token verification.
- Produces: `confirmIdentification(input: ConfirmRequest, context?: PersistenceContext): Promise<ConfirmResult>` and `POST(request): Promise<Response>`.

- [ ] **Step 1: Write failing merge, audit, and replay tests**

Test an existing known model increment, a new null-model item, refusal to merge null into known model, mixed-batch atomic failure, edited audit fields, manual candidate nullable fields, and replay returning the original result without a second increment.

```js
test("unknown model does not merge into a known model", async () => {
  const db = await testDatabase([{ name: "PIR motion sensor", model: "HC-SR501", quantity: 1 }]);
  await confirmIdentification(confirmedUnknownPir, { db, verifyToken });
  assert.deepEqual(await db.inventory(), [
    { name: "PIR motion sensor", model: "HC-SR501", quantity: 1 },
    { name: "PIR motion sensor", model: null, quantity: 2 },
  ]);
});
```

- [ ] **Step 2: Run persistence tests and verify failure**

Run: `npm run test:unit`

Expected: FAIL because schema and persistence functions do not exist.

- [ ] **Step 3: Define D1 tables and unique constraints**

Use text UUID primary keys for `inventory_parts`, `identification_scans`, and `identification_events`. Add a unique index over normalized name plus a non-null `model_key` where null models use the literal sentinel `__unknown__`. Store arrays and bounding boxes as JSON text. Set `.openai/hosting.json` `d1` to `"DB"`.

- [ ] **Step 4: Implement atomic confirmation with D1 batch statements**

Generate all UUIDs before the batch. For each item, enqueue an upsert that increments quantity, followed by an audit insert whose `inventory_part_id` is resolved with a scalar subquery on the normalized identity. Enqueue the unique scan insert first. Submit the full statement list through one D1 `batch`, which is transactional. On a unique confirmation-token hash, fetch and return the previous scan result without applying increments.

- [ ] **Step 5: Generate the migration and run focused tests**

Run: `npm run db:generate`, `npm run test:unit`, and `npx tsc --noEmit`

Expected: a migration creates all three tables and indexes; tests PASS; TypeScript exits 0.

- [ ] **Step 6: Commit the transactional persistence slice**

```bash
git add .openai/hosting.json db/schema.ts drizzle lib/identification/persistence.ts app/api/identify/confirm tests/identification-persistence.test.mjs
git commit -m "feat: persist identified inventory with audit events"
```

### Task 4: Camera, Review, and Confirmation Interface

**Files:**
- Create: `app/components/IdentificationWorkspace.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Create: `tests/identification-ui.test.mjs`

**Interfaces:**
- Consumes: `POST /api/identify` returning `{ detections, token }` and `POST /api/identify/confirm` returning `{ scanId, inventory }`.
- Produces: `IdentificationWorkspace({ onClose, onConfirmed })` and refreshed inventory cards.

- [ ] **Step 1: Write failing source-level and rendered interaction assertions**

Assert the file input uses `accept="image/jpeg,image/png,image/webp"` and `capture="environment"`; review rows expose name, model, quantity, category, reject, and manual-add controls; low confidence and null model have visible warning copy; confirm is disabled with no accepted valid rows; and API errors preserve review state.

- [ ] **Step 2: Run UI tests and verify the component is absent**

Run: `npm run test:unit`

Expected: FAIL because `IdentificationWorkspace.tsx` does not exist.

- [ ] **Step 3: Implement the state machine and accessible review UI**

Use explicit states `selecting | recognizing | reviewing | confirming | confirmed | error`. Revoke object-preview URLs on replacement/unmount. Keep rejected items in local state but exclude them from confirmation. Permit manual rows with null confidence/bounds. Use status text with `aria-live="polite"`, focus the first invalid field, and label every control.

- [ ] **Step 4: Integrate inventory refresh in the existing page**

Replace the mystery-part button behavior with the identification workspace. After confirmation, merge returned inventory rows into visible client state. Keep the existing manual **Add component** modal as a separate workflow.

- [ ] **Step 5: Add responsive visual treatment**

Create a desktop split layout with photo/region overlays and review cards, collapse it into a single column below 800px, preserve the existing paper/green visual system, and provide reduced-motion behavior. Ensure buttons remain at least 44px high on touch viewports.

- [ ] **Step 6: Run UI tests, lint, and type checking**

Run: `npm run test:unit`, `npm run lint`, and `npx tsc --noEmit`

Expected: all commands exit 0.

- [ ] **Step 7: Commit the complete confirmation interface**

```bash
git add app/components/IdentificationWorkspace.tsx app/page.tsx app/globals.css tests/identification-ui.test.mjs
git commit -m "feat: add camera identification review flow"
```

### Task 5: Production Smoke Tests and Setup Documentation

**Files:**
- Modify: `tests/rendered-html.test.mjs`
- Modify: `README.md`
- Create: `.env.example`

**Interfaces:**
- Consumes: complete UI, routes, migration, and environment configuration.
- Produces: documented local setup and release-level verification evidence.

- [ ] **Step 1: Replace stale starter smoke assertions with application assertions**

Assert the production render returns 200 and includes `Parts Cabinet`, `Identify a part`, `Inventory`, and the privacy disclosure, while excluding the disposable starter skeleton copy.

- [ ] **Step 2: Run the full test command and verify any remaining integration failures**

Run: `npm test`

Expected before final fixes: the build or smoke test reports any unresolved application integration issue; do not weaken assertions to hide failures.

- [ ] **Step 3: Document exact environment and database setup**

Add `.env.example` with blank `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.1-flash-lite`, and `CONFIRMATION_TOKEN_SECRET`. Document creating a Gemini API key, generating/applying D1 migrations, free-tier data-use disclosure, supported formats, 10 MiB limit, and the fact that images are not stored by the application.

- [ ] **Step 4: Fix only issues exposed by release verification**

Apply focused fixes for actual build, route, migration, accessibility, or smoke-test failures. Add a regression assertion for every code correction.

- [ ] **Step 5: Run final verification**

Run: `npm run test:unit`, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `git diff --check`.

Expected: every command exits 0 with no test failures or whitespace errors.

- [ ] **Step 6: Perform optional live-provider verification**

When `GEMINI_API_KEY` is available, upload a representative multi-component JPG and verify that the response has multiple editable items, confirmation increments matching quantities once, audit rows match accepted detections, replay does not increment again, and no image data exists in D1. If no key is available, record this check as not run rather than simulating success.

- [ ] **Step 7: Commit documentation and release verification**

```bash
git add .env.example README.md tests/rendered-html.test.mjs
git commit -m "docs: explain Gemini identification setup"
```
