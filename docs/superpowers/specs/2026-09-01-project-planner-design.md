# Project Planner Design

## Purpose

Turn the Projects tab from a hardcoded mockup into a working planner. A project
declares the parts a build needs; the planner matches those requirements against
what is actually in the cabinet, and reports what is ready, what is missing, and
what to buy next.

The catalogue already knows how to decide whether two parts are the same thing —
confirmation merges a scanned part into an existing row using a normalized
identity. The planner reuses that same identity function so that "you own this"
means exactly what "this merged into that row" means. No second matching rule.

This design also establishes the ownership model the rest of the application
depends on: every row in the system belongs to an owner, and no query crosses an
owner boundary.

## Success Criteria

- A signed-in user sees only their own parts, projects, and history.
- A project is a stored record with an editable list of required parts.
- Required quantities are matched against live inventory; owned and missing
  counts are computed, never stored.
- A requirement matches inventory by the same normalized identity that
  confirmation merges on, including the rule that a null model never matches a
  known model.
- A requirement can also be satisfied by category alone when no specific part is
  named, so "any 5 V servo" is expressible.
- Readiness is a per-project percentage derived from satisfied required units.
- The planner ranks projects by readiness, answering "what can I build now?".
- A shopping list aggregates every shortfall across selected projects, merging
  duplicate requirements.
- Deleting a project never touches inventory.
- Starter templates are available so a new cabinet's Projects tab is not empty.
- No planner read or write is possible without a resolved owner.

## Scope

### Included

- Ownership resolution and per-owner scoping of every table
- Project and project-requirement persistence
- Requirement-to-inventory matching by identity or by category
- Readiness, missing list, and shopping list computation
- Buildable-now ranking across a user's projects
- Project CRUD and requirement CRUD endpoints
- Starter project templates
- A Projects UI backed entirely by the API

### Excluded

- Reserving or allocating stock to a project (a part counted for two projects is
  counted for both; nothing is held)
- Build steps, wiring diagrams, or instructions
- Supplier pricing, availability, or purchase links
- Sharing a project between owners
- Automatic project suggestion from inventory contents

## Ownership Model

Every domain table carries `owner_id`. The owner is resolved per request:

1. `oai-authenticated-user-id`, when the Sites platform injects it.
2. Otherwise the `ANONYMOUS_OWNER_ID` binding, when configured. This exists so
   local development and a deliberately single-user private Site keep working
   without sign-in.
3. Otherwise the request is rejected with `401`.

The identity uniqueness constraint moves from `(normalized_name, model_key)` to
`(owner_id, normalized_name, model_key)`, so two owners may each hold their own
"ESP32-CAM" row without colliding.

Rows that predate the migration are assigned a fixed legacy owner constant. They
are not silently adopted by whoever signs in first; the operator claims them with
a documented one-line statement. Guessing here would hand one user another
user's cabinet.

Scoping is enforced in the persistence layer, not in the routes. Every statement
that reads or writes a domain row carries an `owner_id` predicate, so a route
that forgets to check returns nothing rather than someone else's data.

## Architecture

The planner is a read-mostly feature over two new tables and the existing
`inventory_parts`. Matching is a pure function over a project's requirements and
the owner's inventory rows, which keeps it directly testable without a database:

- `lib/projects/types.ts` — project, requirement, and readiness shapes.
- `lib/projects/matching.ts` — pure readiness, missing-list, and shopping-list
  computation. No SQL, no I/O.
- `lib/projects/persistence.ts` — owner-scoped CRUD and the one query that loads
  a project with its requirements.
- `lib/projects/templates.ts` — starter templates, seeded on demand.

Readiness is computed on read rather than denormalized onto the project row.
Inventory changes constantly — every scan, removal, and edit would otherwise have
to fan out and rewrite every project that mentions the part. A cabinet is small
enough that recomputing from the owner's parts is cheap, and it cannot go stale.

## Data Model

### `projects`

- `id`
- `owner_id`
- `name`
- `summary`
- `state`, one of `planned`, `building`, `built`, `shelved`
- `accent`, a display token
- `icon`, a short display label
- `next_step`, nullable
- `created_at`
- `updated_at`

Unique on `(owner_id, normalized_name)` so one cabinet cannot hold two projects
with the same name, while different owners can.

### `project_parts`

- `id`
- `project_id`
- `name`
- `normalized_name`
- `model`, nullable
- `model_key`
- `category`
- `quantity_required`
- `match_mode`, either `identity` or `category`
- `note`, nullable
- `position`, for stable ordering
- `created_at`

`project_parts` has no `owner_id` of its own; it inherits ownership through
`project_id`, and every query joins to `projects` under the owner predicate.

## Matching

For each requirement:

- **`identity` mode** matches inventory rows whose `(normalized_name, model_key)`
  equal the requirement's. This is the same key confirmation merges on, so a part
  scanned into the cabinet satisfies a requirement written the same way. A
  requirement with no model has `model_key = '__unknown__'` and therefore matches
  only other model-unknown rows — the same asymmetry the catalogue already has,
  kept deliberately so "ESP32-CAM" does not silently satisfy "ESP32-CAM (OV5640)".
- **`category` mode** matches any inventory row in the requirement's category, and
  sums their quantities. This covers "3 × any micro servo".

Per requirement the planner reports `required`, `owned` (capped at `required`,
so surplus stock cannot mask a different shortfall), and `missing`.

Project readiness weighs every requirement equally, whatever quantity it asks
for: each contributes one share, filled proportionally by what is owned. So the
percentage is `sum(min(owned/required, 1)) / requirement count`, floored — 199
of 200 screws reads 99%, never 100%.

Weighing units instead would let bulk items drown out the parts a build turns
on: 20 jumper wires and one ESP32-CAM would read 95% ready while nothing could
be assembled. Under requirement weighting that is 50%, and the board counts for
as much as the whole pile of wires. Credit stays proportional *inside* a
requirement, because the distortion was between requirements, not within one —
half the wires should still move the bar.

"Can I start" remains the separate `ready` flag, true only when every
requirement is fully met. The card reads "3 / 6 parts ready" against the same
requirement count the percentage uses, and ranking breaks ties on distinct parts
still short, so the blocking parts stay visible.

A project with no requirements is 0% ready, not 100%. An empty project is not a
finished one.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects` | Owner's projects with readiness, ranked |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects/:id` | One project with requirements and match detail |
| `PATCH` | `/api/projects/:id` | Update project fields |
| `DELETE` | `/api/projects/:id` | Delete a project and its requirements |
| `PUT` | `/api/projects/:id/parts` | Replace the requirement list |
| `GET` | `/api/projects/shopping-list` | Aggregated shortfall across projects |
| `POST` | `/api/projects/templates` | Seed starter templates |

Every route resolves the owner first and returns `401` when it cannot.

## Error Handling

- An unresolved owner returns `401` before any database access.
- A project id belonging to another owner returns `404`, not `403`, so the
  endpoint does not confirm that the id exists.
- Requirement payloads are validated with the same field validators the
  identification review uses; an invalid row names its index.
- A duplicate project name for the same owner returns `409`.
- Deleting an already-deleted project returns `404`.
- Template seeding is idempotent: re-running it skips templates whose names the
  owner already has, and reports what it skipped.

## Security and Privacy

- Owner scoping is applied in SQL, in the persistence layer, on every statement.
- Project and requirement strings are length-bounded on the same limits as
  inventory fields.
- Readiness responses expose only the requesting owner's inventory counts.
- The legacy owner constant is inert: no request can ever resolve to it.
