# Parts Cabinet

Know what electronics you have, and what you can build with it.

Photograph a handful of components; one Gemini call identifies every board,
sensor and mystery module in the frame, crops a picture of each one, and files
them in your cabinet after you have reviewed every row. Projects are then
matched against what you actually own, so your next shopping list stays short.

Built on [vinext](https://github.com/cloudflare/vinext) and running on
Cloudflare Workers with D1.

## Prerequisites

- Node.js `>=22.13.0`

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev
```

### Configuration

| Binding | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Key from Google AI Studio; used for identification. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.1-flash-lite`. |
| `CONFIRMATION_TOKEN_SECRET` | yes | At least 16 characters. Signs the token that makes a confirmed scan idempotent. |
| `ANONYMOUS_OWNER_ID` | no | Owner used when no signed-in identity is present. See below. |
| `IDENTIFY_RATE_LIMIT_PER_MINUTE` | no | Identification budget per owner. Defaults to 10. |
| `IDENTIFY_RATE_LIMIT_PER_HOUR` | no | Defaults to 60. |
| `IDENTIFY_RATE_LIMIT_PER_DAY` | no | Defaults to 200. |

Apply the migrations in `drizzle/` to the D1 database, in order, before
confirming a scan.

## Who owns what

Every row — parts, projects, scans, audit events — belongs to an owner. The
owner is resolved once per request:

1. The `oai-authenticated-user-id` header, injected by the Sites platform for a
   signed-in visitor.
2. Otherwise `ANONYMOUS_OWNER_ID`, if configured.
3. Otherwise the request is refused with `401`.

Set `ANONYMOUS_OWNER_ID` for local development and for a deliberately
single-user private Site. **Leave it unset anywhere anonymous visitors can
reach**, or every stranger shares one cabinet.

Scoping is enforced in the persistence layer rather than in the routes, so a
handler that forgets to check returns nothing instead of somebody else's data.

### Claiming rows that predate multi-tenancy

Migration `0004` parks every pre-existing row on `legacy-shared-cabinet`, an
owner no request can ever resolve to. Nothing is lost, and nothing is handed to
whoever signs in first. Claim them deliberately:

```sql
UPDATE inventory_parts            SET owner_id = '<your-user-id>' WHERE owner_id = 'legacy-shared-cabinet';
UPDATE identification_scans       SET owner_id = '<your-user-id>' WHERE owner_id = 'legacy-shared-cabinet';
UPDATE identification_events      SET owner_id = '<your-user-id>' WHERE owner_id = 'legacy-shared-cabinet';
UPDATE inventory_adjustment_events SET owner_id = '<your-user-id>' WHERE owner_id = 'legacy-shared-cabinet';
```

## Camera identification

Identification is how parts enter the cabinet. One photo identifies several
components at once, and each confirmed part is filed with a cropped picture of
itself taken from that photo.

- **Identify with camera** is the primary action in the header, hero, toolbar
  and empty state.
- Gemini returns likely names, models, counts, confidence, visible markings and
  alternatives, each with a bounding box drawn over the photo.
- Every detection is cropped in the browser and shown beside its row, so the
  picture is reviewed together with the name.
- **Add a part by hand instead** appends a blank row to the same review list,
  saved through the same confirmation. There is no separate add-a-component
  form.
- Nothing is written until the reviewed batch is confirmed, and confirming the
  same batch twice does not double the stock.

### Part photos

Confirmed parts store a cropped thumbnail as a data URL in
`inventory_parts.image`:

- Cropping, downscaling and encoding happen in the browser. Tiles are at most
  320 px on the long edge and are re-encoded down a quality ladder until they
  fit a 160 KB per-part budget, well below D1's value limit.
- The full uploaded photo is never stored and its bytes never reach the
  database — only the confirmed crops do.
- Thumbnails are **not** part of the inventory list payload. The list returns
  `hasImage`, and each tile is fetched from
  `GET /api/inventory/:id/photo?v=<updatedAt>` as real bytes, with an ETag and
  an immutable cache. A changed photo changes `updatedAt`, which busts the URL.
- Parts without a photo keep the lettered tile and offer **Add photo**.

The prototype accepts images up to 10 MiB and sends them to the Gemini API for
processing; review Google's data-use terms before enabling uploads for other
people.

Identification costs money on every call, so each owner has a per-minute,
per-hour and per-day budget counted in D1. The budget is charged before the
upload is read, so a refused request costs neither bandwidth nor a Gemini call,
and the `429` carries a `Retry-After`.

## Working with the cabinet

- **Search, filter and sort** run in SQL behind covering indexes. The list pages
  with a keyset cursor rather than loading the whole cabinet into the browser.
- **Bins** group parts by storage location, so the physical cabinet is findable.
- **Editing** a part corrects anything identification got wrong — name, model,
  category, bin, description, tags — and adjusts stock you bought or used.
  Renaming a part onto an identity you already hold folds the two rows into one
  and adds their stock together, moving history onto the survivor, rather than
  refusing the edit and leaving you with a duplicate.
- **Removal** is undoable for ten seconds, and several removals can be pending
  at once. Removing the last unit deletes the part and its history.
- **Datasheets** are one click from a part card. The link is a search on the
  confirmed model, falling back to the part name — a guessed vendor URL built
  from a model number 404s as often as it resolves.
- **CSV export and import** give the data somewhere to live besides D1. Import
  upserts on the same identity the catalogue merges on, so re-importing adds
  stock to the row already there rather than creating a duplicate. A file with
  one unreadable row imports nothing and reports every problem against the row
  it came from.

## Projects

A project declares the parts a build needs; the planner matches those
requirements against live inventory and reports what is ready, what is missing,
and what to buy. Readiness is computed on read, so it cannot go stale as parts
are scanned, edited or removed.

Requirements match either on identity — the same `normalized_name + model_key`
the catalogue merges on — or on category alone, which covers "20 × any jumper
wire". Readiness is `sum(owned units) / sum(required units)`; it answers "how
much of the shopping list is done", while the separate ready flag answers "can I
start". Five starter templates seed a new cabinet so the tab is not empty.

## History

Every scan, confirmation, edit, merge and stock adjustment is already recorded.
The History tab reads that trail back as a reverse-chronological timeline,
owner-scoped and cursor-paginated.

## Offline

The app installs as a PWA and keeps its shell available without a signal. The
service worker caches build assets by content hash and the app shell
network-first; it never caches anything under `/api`, because inventory served
from an old visit and presented as current is worse than an error.

## Data model

| Table | Holds |
| --- | --- |
| `inventory_parts` | One row per distinct part per owner, keyed by `(owner_id, normalized_name, model_key)`. |
| `identification_scans` | One row per confirmed batch, deduplicated by a hash of the confirmation token. |
| `identification_events` | What was detected versus what was confirmed, per accepted row. |
| `inventory_adjustment_events` | Stock removals, edits and merges. |
| `projects`, `project_parts` | A build and the parts it needs. |

The matching key is `normalized_name + model_key`. A part with no model uses
`__unknown__` and therefore only matches other model-unknown parts — an
`ESP32-CAM` never silently merges into an `ESP32-CAM (OV5640)`.

## Commands

- `npm run dev` — start local development
- `npm run build` — verify the build output
- `npm run typecheck` — `tsc --noEmit`; the build strips types without checking them
- `npm run test:unit` — unit and persistence tests (real SQL against SQLite)
- `npm test` — build, then server-render the app and assert on the HTML
- `npm run lint` — eslint
- `npm run db:generate` — regenerate Drizzle migrations after a schema change

Continuous integration runs lint, typecheck, unit tests and the build on every
pull request.

## Design docs

Decisions live in `docs/superpowers/`: `specs/` for designs, `plans/` for how
they were built. Start with
`specs/2026-09-01-project-planner-design.md` and
`plans/2026-09-01-scalable-cabinet.md`.

## Platform notes

`.openai/hosting.json` declares the optional Sites D1 and R2 bindings, and
`vite.config.ts` simulates them for local development. This project uses D1 and
no R2, which is why thumbnails live in the database rather than object storage.
`examples/d1/` keeps the starter's original D1 example surface for reference.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection; do not implement app routes for
those paths. Signing in establishes identity only — it does not prove workspace
membership. Use the hosting platform's access policy for workspace-wide
restrictions.

Helpers for optional ChatGPT sign-in live in `app/chatgpt-auth.ts`
(`getChatGPTUser`, `requireChatGPTUser`, `chatGPTSignInPath`,
`chatGPTSignOutPath`). Pages that depend on per-request identity need
`export const dynamic = "force-dynamic"`.

## Learn more

- [vinext documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 guide](https://orm.drizzle.team/docs/get-started/d1-new)
