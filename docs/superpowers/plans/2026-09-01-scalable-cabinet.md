# Scalable cabinet: ownership, projects, and the surrounding build

## Problem

The catalogue half of the product was real; everything around it was not. The
Projects tab rendered five hardcoded objects with typed-in readiness numbers.
Parts could be scanned in and removed but never corrected. `chatgpt-auth.ts` was
dead code and every visitor shared one cabinet. The inventory list returned every
base64 thumbnail in one payload on every mutation, and `/api/identify` forwarded
unlimited 10 MB uploads to a paid API key with no throttle. There was no CI.

The brief was to build all of it, aiming for a system that scales.

## Decisions

1. **Multi-tenant, enforced in SQL.** Every domain table carries `owner_id`, and
   the persistence layer puts an owner predicate on every statement rather than
   trusting routes to check. The identity unique index becomes
   `(owner_id, normalized_name, model_key)`. Pre-migration rows go to a fixed
   legacy owner that no request can resolve to; the operator claims them
   explicitly. See the project planner design doc for the resolution order.

2. **Readiness is computed, never stored.** Denormalizing owned/missing counts
   onto projects would mean every scan, edit, and removal fans out across every
   project mentioning that part. Recomputing from the owner's inventory on read
   is cheap at cabinet scale and cannot go stale.

3. **Requirements match on the catalogue's own identity key.** The planner reuses
   `normalizeIdentity` and the `model_key` convention, so "you own this" is
   defined the same way as "this merged into that row". A category match mode
   covers requirements that name no specific part.

4. **Thumbnails leave the list payload.** `GET /api/inventory` no longer selects
   `image`; it returns `hasImage` plus `imageUpdatedAt`. Tiles are served as raw
   bytes from `GET /api/inventory/:id/photo` with a strong ETag and immutable
   caching, so the browser fetches each tile once instead of re-downloading every
   thumbnail after every mutation.

5. **The list is paginated and queried server-side.** Search, category filter,
   and sort move into SQL behind covering indexes, with a keyset cursor. The
   client no longer holds the whole cabinet in memory to filter it.

6. **Editing merges on collision.** A rename that lands on an existing identity
   folds the two rows together — quantities summed, an audit event recorded on
   both — rather than failing on the unique index. Silently refusing the edit
   would leave a user unable to fix a duplicate Gemini created.

7. **Rate limiting is per owner and per minute/hour/day, in D1.** No extra
   binding to provision, and the counters double as usage reporting.

## Shape

### Foundation

- `drizzle/0004_multi_tenant_ownership.sql` — `owner_id` columns, re-keyed
  identity index, legacy owner backfill.
- `lib/auth/owner.ts` — owner resolution from SIWC headers with the
  `ANONYMOUS_OWNER_ID` fallback and the `OwnerRequiredError`.
- `lib/http/respond.ts` — shared error-to-response mapping so every route
  reports `401`/`404`/`409` the same way.

### Inventory

- Covering indexes for the list query and its sorts, folded into `0004`.
- `lib/inventory/query.ts` — search/filter/sort/cursor parsing and SQL building.
- `app/api/inventory/[id]/photo/route.ts` — gains `GET` serving raw bytes with
  ETag; `POST` unchanged apart from owner scoping.
- `app/api/inventory/[id]/route.ts` — `PATCH` for edits, with identity-collision
  merge.

### Projects

- `drizzle/0005_project_planner.sql` — `projects`, `project_parts`, indexes.
- `lib/projects/{types,matching,persistence,templates,validation}.ts`
- `app/api/projects/**` — the endpoint table from the design doc.
- `app/components/ProjectsView.tsx`, `ProjectEditor.tsx` — the real UI.

### Surrounding work

- `.github/workflows/ci.yml` — lint, unit tests, build on PRs.
- `lib/identification/rate-limit.ts` + `drizzle/0006_rate_limits.sql`
- `lib/inventory/csv.ts` — export and import.
- `app/api/history/route.ts` + `HistoryView.tsx` over the existing audit tables.
- `lib/parts/datasheet.ts` — datasheet search links from a confirmed model.
- `public/manifest.webmanifest`, `public/sw.js` — installable, offline shell.

## Verification

- `npm run test:unit` (now globbed) covers owner resolution and its failure
  modes, the query builder including cursor round-trips, the edit-merge path,
  matching and readiness arithmetic, CSV round-trips, rate-limit windows, and
  real SQL executed against SQLite for each new migration.
- `npm test` builds and server-renders the app.
- CI runs all three on every pull request.

## Migration notes

Migrations `0004`–`0006` apply in order and are additive. After `0004`, existing
rows belong to `legacy-shared-cabinet`; claim them with:

```sql
UPDATE inventory_parts SET owner_id = '<your-user-id>' WHERE owner_id = 'legacy-shared-cabinet';
```

The same statement applies to `identification_scans`, `identification_events`,
and `inventory_adjustment_events`. The README documents this.
