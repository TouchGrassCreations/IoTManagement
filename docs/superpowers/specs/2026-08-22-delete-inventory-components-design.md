# Delete Inventory Components Design

## Goal

Let users remove some or all units of any inventory component with explicit confirmation and a 10-second undo window. Full removal permanently deletes the inventory record and all of its history. Built-in and camera-added components must share the same persistent behavior.

## Decisions

- D1 is the single inventory source.
- The nine current built-in components are seeded into D1 with stable IDs.
- Users choose a removal quantity between one and current stock.
- Confirmation and Undo are both required.
- Deletion is delayed until the Undo window expires.
- Partial removal records an adjustment audit event.
- Removing all remaining units permanently deletes the component and every associated identification and adjustment event.
- Only one removal may be pending in the UI at a time.
- Closing or refreshing during the Undo window cancels the pending operation because no server mutation has occurred.

## Data Model

### Inventory

`inventory_parts` remains authoritative. The migration inserts the nine demo components with deterministic IDs using `INSERT OR IGNORE`, so existing rows are never overwritten.

### Adjustment audit

Add `inventory_adjustment_events`:

- `id` — UUID primary key
- `inventory_part_id` — associated part ID
- `event_type` — `quantity_removed`
- `quantity_before`
- `quantity_removed`
- `quantity_after`
- `created_at`

Partial removals insert one event in the same D1 batch as the quantity update. Full deletion removes both identification and adjustment events before deleting the inventory row.

## Server API

### `GET /api/inventory`

Returns the current inventory ordered predictably by category and name. It parses stored JSON tags and exposes the existing inventory result shape plus location/code fields needed by the current cards.

### `POST /api/inventory/:id/remove`

Request:

```json
{
  "quantity": 2,
  "expectedCurrentQuantity": 5
}
```

The server validates integer bounds, loads the current part, and compares the expected quantity to prevent stale-tab updates.

- For a partial removal, it atomically decreases quantity and inserts an adjustment event.
- For full removal, it deletes identification events, adjustment events, and the inventory row in one ordered D1 batch.
- Removing more than current stock is rejected.
- A stale expected quantity returns `409` with the latest inventory state.
- Missing parts return `404`.

The endpoint returns the updated part for partial removal or `{ "deleted": true, "id": "..." }` for full removal.

## Client Experience

The page loads inventory from D1 instead of initializing from a hard-coded array. Loading and recoverable API failure states are shown without discarding the last known inventory.

Each inventory card includes a Delete/adjust quantity action. Activating it opens an accessible confirmation dialog containing:

- name and model;
- current stock;
- numeric quantity-to-remove input;
- a clear permanent-history warning when the chosen quantity equals current stock;
- Cancel and Confirm removal buttons.

After confirmation, the client optimistically updates the item and starts a 10-second timer. A live-region toast describes the exact pending operation and offers Undo. Delete controls remain disabled until the pending operation resolves.

- Undo clears the timer and restores the previous client state.
- Timer expiry sends the server request.
- Server failure restores the item and shows a specific error.
- A `409` restores the item, replaces inventory with the latest state, and explains that stock changed elsewhere.
- Cancel and Undo return keyboard focus to the originating card when it still exists.

## Persistence and Migration

The migration:

1. creates `inventory_adjustment_events` and an index on `inventory_part_id`;
2. extends inventory fields only where required by the existing UI;
3. inserts the nine built-in records with stable IDs and current taxonomy labels;
4. registers itself in Drizzle's migration journal.

Local and hosted D1 use the same checked-in migration. No browser storage is authoritative.

## Safety and Consistency

- Confirmation explicitly distinguishes quantity reduction from permanent deletion.
- No database mutation occurs until Undo expires.
- Server-side quantity and expected-state validation is authoritative.
- D1 batch ordering prevents an inventory row from being removed while its history remains.
- Full deletion is intentionally irreversible after the Undo window.
- No deletion endpoint accepts names or broad filters; it targets one exact part ID.

## Testing

Automated coverage includes:

- deterministic built-in seeding without overwriting existing records;
- inventory listing and JSON parsing;
- valid partial removal and adjustment audit creation;
- full removal and deletion of both audit types;
- invalid, zero, fractional, negative, and excessive quantities;
- missing records and stale expected quantities;
- Undo preventing any API request;
- optimistic rollback on network/database failure;
- one-pending-removal behavior;
- confirmation messaging for partial versus full deletion;
- production build and existing identification regression suites.

## Out of Scope

- Restoring a deletion after the 10-second Undo window;
- bulk or category-wide deletion;
- scheduled cleanup jobs;
- multi-user authorization, until application authentication exists;
- storage-location management.
