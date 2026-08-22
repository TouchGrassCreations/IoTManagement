# Delete Inventory Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all inventory in D1 and let users remove a chosen quantity with confirmation, a 10-second Undo window, partial-removal auditing, and permanent full deletion.

**Architecture:** D1 becomes the sole inventory source through focused inventory persistence functions and two API routes. The client uses a testable pending-removal controller to delay mutations, optimistically update state, restore on Undo/error, and serialize removals one at a time.

**Tech Stack:** TypeScript, Vinext/React 19, Cloudflare Workers, D1/SQLite, Node test runner, Drizzle migrations.

**Spec:** `docs/superpowers/specs/2026-08-22-delete-inventory-components-design.md`

## Global Constraints

- D1 is authoritative; browser storage is not an inventory source.
- Seed the nine built-in parts with deterministic IDs and `INSERT OR IGNORE`.
- Accept integer removal quantities from `1` through current stock only.
- Delay server mutation for 10 seconds and allow only one pending removal.
- Full removal deletes the part and every associated identification and adjustment event.
- Partial removal updates quantity and inserts one adjustment event atomically.
- Storage-location management and authentication remain out of scope.

---

### Task 1: Inventory Schema, Seed Data, and Persistence

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0002_inventory_deletion.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `lib/inventory/types.ts`
- Create: `lib/inventory/persistence.ts`
- Create: `tests/inventory-persistence.test.mjs`

**Interfaces:**
- Produces: `listInventory(db: D1Like): Promise<InventoryItem[]>`
- Produces: `removeInventoryQuantity(input: RemoveInventoryInput, db: D1Like): Promise<RemoveInventoryResult>`
- `RemoveInventoryInput = { id: string; quantity: number; expectedCurrentQuantity: number }`
- `RemoveInventoryResult = { deleted: true; id: string } | { deleted: false; item: InventoryItem }`

- [ ] **Step 1: Write failing persistence tests**

Add tests using a recording D1 fake that assert:

```js
test("partial removal updates quantity and writes one audit event", async () => {
  const result = await removeInventoryQuantity(
    { id: "part-1", quantity: 2, expectedCurrentQuantity: 5 }, dbWithPart({ id: "part-1", quantity: 5 })
  );
  assert.equal(result.item.quantity, 3);
  assert.match(recordedSql.join("\n"), /UPDATE inventory_parts/);
  assert.match(recordedSql.join("\n"), /INSERT INTO inventory_adjustment_events/);
});

test("full removal deletes both audit types before the part", async () => {
  await removeInventoryQuantity(
    { id: "part-1", quantity: 5, expectedCurrentQuantity: 5 }, dbWithPart({ id: "part-1", quantity: 5 })
  );
  assert.deepEqual(deleteOrder, ["identification_events", "inventory_adjustment_events", "inventory_parts"]);
});

test("stale quantity throws a typed conflict containing current inventory", async () => {
  await assert.rejects(
    removeInventoryQuantity({ id: "part-1", quantity: 2, expectedCurrentQuantity: 5 }, dbWithPart({ id: "part-1", quantity: 4 })),
    error => error.code === "STALE_QUANTITY" && error.item.quantity === 4
  );
});
```

- [ ] **Step 2: Run persistence tests and verify RED**

Run: `node --experimental-strip-types --test tests/inventory-persistence.test.mjs`

Expected: FAIL because `lib/inventory/persistence.ts` does not exist.

- [ ] **Step 3: Add schema and migration**

Add `location TEXT NOT NULL DEFAULT 'Unsorted'` and `code TEXT NOT NULL DEFAULT 'MODEL-UNKNOWN'` to inventory through migration-safe `ALTER TABLE` statements. Create:

```sql
CREATE TABLE inventory_adjustment_events (
  id TEXT PRIMARY KEY NOT NULL,
  inventory_part_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_removed INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_inventory_adjustment_events_part_id
ON inventory_adjustment_events(inventory_part_id);
```

Insert all nine existing sample parts with stable IDs `seed-arduino-uno-r3` through `seed-mini-breadboard` using `INSERT OR IGNORE`. Register migration index `2` in the Drizzle journal.

- [ ] **Step 4: Implement focused persistence functions**

Implement exact ID lookup, JSON tag parsing, typed `InventoryNotFoundError`, `InventoryQuantityConflictError`, and `InvalidRemovalQuantityError`. Use one D1 `batch()` for partial update plus audit insert and another ordered `batch()` for full audit/history deletion plus part deletion.

- [ ] **Step 5: Run persistence tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/inventory-persistence.test.mjs`

Expected: all persistence tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add db/schema.ts drizzle/0002_inventory_deletion.sql drizzle/meta/_journal.json lib/inventory tests/inventory-persistence.test.mjs
git commit -m "feat: add persistent inventory removal"
```

### Task 2: Inventory List and Removal API

**Files:**
- Create: `app/api/inventory/route.ts`
- Create: `app/api/inventory/[id]/remove/route.ts`
- Create: `tests/inventory-routes.test.mjs`

**Interfaces:**
- Consumes: `listInventory`, `removeInventoryQuantity`, and typed persistence errors from Task 1.
- Produces: `GET /api/inventory` and `POST /api/inventory/:id/remove`.

- [ ] **Step 1: Write failing route tests**

```js
test("GET returns current inventory", async () => {
  const response = await handleInventoryList({ list: async () => [sampleItem] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { inventory: [sampleItem] });
});

test("remove maps stale stock to 409 with current inventory", async () => {
  const response = await handleInventoryRemoval(request({ quantity: 2, expectedCurrentQuantity: 5 }), {
    remove: async () => { throw staleError(sampleItem); }
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Inventory quantity changed.", item: sampleItem });
});
```

Also cover `400` invalid payload, `404` missing ID, partial `200`, and full-delete `200`.

- [ ] **Step 2: Run route tests and verify RED**

Run: `node --experimental-strip-types --test tests/inventory-routes.test.mjs`

Expected: FAIL because inventory route modules do not exist.

- [ ] **Step 3: Implement dependency-injected handlers and Worker bindings**

Export handler functions for tests. Route entrypoints import `env` from `cloudflare:workers`, pass `env.DB`, decode the path ID, validate JSON numbers without coercing blank strings, and map typed persistence errors to the specified statuses.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/inventory-routes.test.mjs`

Expected: all route tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add app/api/inventory tests/inventory-routes.test.mjs
git commit -m "feat: expose inventory removal API"
```

### Task 3: Delayed Removal Controller

**Files:**
- Create: `lib/inventory/pending-removal.ts`
- Create: `tests/pending-removal.test.mjs`

**Interfaces:**
- Produces: `createPendingRemoval(options)` with `schedule(operation)`, `undo()`, `hasPending()`, and `dispose()`.
- `operation` contains `{ item, quantity, commit, onOptimistic, onRestore, onCommitted, onError }`.

- [ ] **Step 1: Write failing fake-timer tests**

```js
test("undo restores state and prevents the commit request", async () => {
  const timer = fakeTimer();
  let commits = 0, restores = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  controller.schedule(operation({ commit: async () => commits++, onRestore: () => restores++ }));
  controller.undo();
  timer.advance(10_000);
  assert.equal(commits, 0);
  assert.equal(restores, 1);
});

test("timer expiry commits exactly once", async () => {
  const timer = fakeTimer();
  let commits = 0;
  const controller = createPendingRemoval({ delayMs: 10_000, timer });
  controller.schedule(operation({ commit: async () => commits++ }));
  await timer.advanceAsync(10_000);
  assert.equal(commits, 1);
  assert.equal(controller.hasPending(), false);
});
```

Also assert a second `schedule()` is rejected and `dispose()` cancels without committing.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `node --experimental-strip-types --test tests/pending-removal.test.mjs`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement the controller**

Inject `setTimeout`/`clearTimeout` through a small timer interface. Apply optimistic state synchronously, clear pending state before awaited commit callbacks, restore on commit failure, and make Undo/dispose idempotent.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/pending-removal.test.mjs`

Expected: all controller tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add lib/inventory/pending-removal.ts tests/pending-removal.test.mjs
git commit -m "feat: add undoable removal controller"
```

### Task 4: Persistent Inventory UI and Delete Experience

**Files:**
- Create: `app/components/RemoveInventoryDialog.tsx`
- Create: `app/components/PendingRemovalToast.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: inventory API routes and pending-removal controller.
- Produces: accessible quantity-removal dialog, optimistic card update, 10-second Undo toast, and rollback/error behavior.

- [ ] **Step 1: Add failing rendered-contract assertions**

Assert that rendered application source contains accessible inventory loading/error messaging and that the built-in array is no longer the authoritative initializer:

```js
assert.match(html, /Inventory/);
assert.doesNotMatch(html, /const initialParts/);
```

Add static component assertions for dialog labels `Quantity to remove`, `Confirm removal`, and the permanent-history warning.

- [ ] **Step 2: Run rendered test and verify RED**

Run: `npm test`

Expected: FAIL because `initialParts` remains and removal components do not exist.

- [ ] **Step 3: Build dialog and toast components**

The dialog clamps user input to `1..currentQuantity`, changes warning copy when removal equals stock, returns focus on Cancel, and exposes Cancel/Confirm buttons. The toast uses `role="status"`, states the exact quantity/name, shows a visible countdown label, and offers Undo.

- [ ] **Step 4: Replace client seed state with API loading**

Initialize `parts` to `[]`, fetch `/api/inventory` on mount, preserve the last successful array on refresh failure, and translate API items directly to the existing card shape. Keep camera confirmation results integrated by refreshing inventory after successful confirmation.

- [ ] **Step 5: Integrate delayed optimistic removal**

On confirmation, snapshot the item and focus target, optimistically subtract/remove it, schedule the controller, and disable all removal actions while pending. On expiry, POST exact ID/quantity/expected quantity. Undo restores the snapshot; errors restore and announce; `409` reloads inventory.

- [ ] **Step 6: Add responsive and accessible styles**

Style destructive actions distinctly, keep dialog controls usable at mobile widths, ensure visible keyboard focus, and place the toast above existing overlays without obscuring the confirmation button.

- [ ] **Step 7: Run tests and build**

Run: `npm run test:unit && npm test`

Expected: controller, persistence, route, identification, build, and rendered tests all PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add app/components/RemoveInventoryDialog.tsx app/components/PendingRemovalToast.tsx app/page.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add undoable component deletion UI"
```

### Task 5: Migration and End-to-End Verification

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Verifies all interfaces produced by Tasks 1–4.

- [ ] **Step 1: Inspect migration ordering and journal registration**

Run: `Get-Content drizzle/0002_inventory_deletion.sql` and `Get-Content drizzle/meta/_journal.json`.

Expected: migration `0002` is registered after `0001`, creates/indexes adjustment events, adds inventory fields, and seeds nine stable IDs.

- [ ] **Step 2: Run complete verification**

Run: `npm run test:unit && node --experimental-strip-types --test tests/inventory-persistence.test.mjs tests/inventory-routes.test.mjs tests/pending-removal.test.mjs && npm test`

Expected: zero failures and a successful production build.

- [ ] **Step 3: Inspect working tree scope**

Run: `git status --short` and `git diff --stat origin/main...HEAD`.

Expected: only planned source, migration, test, specification, and plan files are tracked; `.env.local`, `wrangler.local.jsonc`, and diagnostic logs remain untracked or ignored.

- [ ] **Step 4: Request pre-merge code review**

Review persistence safety, destructive target scoping, D1 batch ordering, timer cancellation, stale-state behavior, and accessibility. Fix every Critical or Important finding and rerun Step 2.

- [ ] **Step 5: Commit verification fixes if needed**

```bash
git add db/schema.ts drizzle lib/inventory app/api/inventory app/components app/page.tsx app/globals.css tests
git commit -m "fix: address inventory deletion review"
```
