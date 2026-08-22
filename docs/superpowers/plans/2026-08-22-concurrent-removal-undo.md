# Concurrent Removal Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow removals for different components to be queued concurrently while each operation keeps an independent 10-second Undo window.

**Architecture:** Generalize the pending-removal controller from one operation to a keyed collection addressed by inventory item ID. The page renders one toast per pending operation, disables removal only for affected item IDs, and lets each operation commit, restore, fail, or undo independently.

**Tech Stack:** TypeScript, React 19, Vinext, Node test runner.

**Spec:** Approved in-chat design from 2026-08-22: different components may be pending concurrently; the same component cannot be queued twice; partial removals remain visible at reduced stock; full removals are hidden; Undo restores only its matching component.

## Global Constraints

- Each pending operation uses its own 10,000 ms timer.
- Inventory item ID is the pending-operation key.
- Scheduling an already-pending item returns `false` without applying a second optimistic update.
- Undo requires an item ID and affects only that item.
- `dispose()` cancels all timers without committing or restoring.
- Server payloads and stale-quantity behavior remain unchanged.

---

### Task 1: Keyed Pending-Removal Controller

**Files:**
- Modify: `lib/inventory/pending-removal.ts`
- Test: `tests/pending-removal.test.mjs`

**Interfaces:**
- Produces: `schedule(operation): boolean`, keyed by `operation.item.id`.
- Produces: `undo(itemId: string): boolean`.
- Produces: `hasPending(itemId?: string): boolean`.
- Produces: `pendingIds(): string[]`.
- Produces: `dispose(): void`.

- [ ] **Step 1: Write failing independent-operation tests**

Add tests that schedule `part-1` and `part-2`, Undo only `part-1`, then advance timers and assert that only `part-2` commits. Add a second test asserting duplicate scheduling of `part-1` returns `false`, while `part-2` returns `true`. Update disposal coverage to assert every queued timer is cancelled.

- [ ] **Step 2: Run the controller test and verify RED**

Run: `node --experimental-strip-types --test tests/pending-removal.test.mjs`

Expected: FAIL because the controller rejects the second operation and `undo()` cannot target an item ID.

- [ ] **Step 3: Implement a keyed controller**

Replace the nullable `pending` field with `Map<string, { operation, timeout }>`. Timer callbacks delete their own key before awaiting commit. `undo(itemId)` clears and restores only that entry. `dispose()` clears every timeout and empties the map.

- [ ] **Step 4: Run the controller test and verify GREEN**

Run: `node --experimental-strip-types --test tests/pending-removal.test.mjs`

Expected: all controller tests PASS.

### Task 2: Concurrent Removal UI

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: keyed controller from Task 1.
- Produces: `pendingRemovals: Array<{ item, quantity, deadline }>`.
- Produces: stacked `PendingRemovalToast` elements with item-specific Undo callbacks.

- [ ] **Step 1: Add failing UI contract assertions**

Assert page source uses `pendingRemovals`, computes pending state per `part.id`, and renders toasts with `undoRemoval(pending.item.id)` rather than one global pending operation.

- [ ] **Step 2: Run rendered tests and verify RED**

Run: `npm test`

Expected: FAIL because the page still has singular `pendingRemoval` state and disables all Remove buttons.

- [ ] **Step 3: Implement keyed page state**

Replace singular state with an array. On schedule, append the operation. On commit/error/Undo, remove only its item ID. Disable a card button with `pendingRemovals.some(pending => pending.item.id === part.id)`. Preserve current optimistic partial/full behavior and rollback snapshots.

- [ ] **Step 4: Stack multiple toasts**

Wrap toasts in `.removal-toast-stack`; keep the toast component positioning relative inside the stack. Render one toast per pending item with stable `key={pending.item.id}`.

- [ ] **Step 5: Run full verification**

Run: `npm run test:unit && npm test`

Expected: controller, migration, persistence, API, build, and rendered tests all PASS.

### Task 3: Review and Branch Checkpoint

**Files:**
- Modify only files above if review exposes a defect.

**Interfaces:**
- Verifies keyed timer isolation, item-specific rollback, duplicate prevention, disposal, UI button state, and toast accessibility.

- [ ] **Step 1: Run targeted lint and diff checks**

Run: `npx eslint app/page.tsx app/components lib/inventory tests/pending-removal.test.mjs tests/rendered-html.test.mjs` and `git diff --check`.

Expected: zero errors.

- [ ] **Step 2: Request independent review**

Review the implementation against the approved design and fix every Critical or Important finding.

- [ ] **Step 3: Run fresh final verification**

Run: `npm run test:unit && npm test`.

Expected: zero failures and successful production build.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-22-concurrent-removal-undo.md lib/inventory/pending-removal.ts app/page.tsx app/globals.css tests/pending-removal.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: allow concurrent undoable removals"
```
