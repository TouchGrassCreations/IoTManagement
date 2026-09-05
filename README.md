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
- **Open camera** runs a viewfinder in the page itself, with a shutter and a
  switch between front and back lenses. The frame is captured to a JPEG at most
  1920 px on its long edge — enough to read chip markings, small enough to
  upload — and drops straight into the review list. Choosing an existing photo
  still works alongside it, and the camera is released the moment the shot is
  taken.
- Browsers only expose a camera on a **secure origin**. Over HTTPS or on
  `localhost` the button appears; anywhere else it is replaced by a line
  explaining that HTTPS is needed, and choosing a photo still works. See
  [Docker](#docker) — a container reached at a bare `http://192.168.x.x` has no
  camera until it is served over TLS.
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
  refusing the edit and leaving you with a duplicate. Only fields you actually
  edited cross over, so a rename never moves the surviving part to a different
  bin.
- **Removal** is undoable for ten seconds, and several removals can be pending
  at once. Removing the last unit deletes the part and its history.
- **Datasheets** are one click from a part card. The link is a search on the
  confirmed model, falling back to the part name — a guessed vendor URL built
  from a model number 404s as often as it resolves.
- **CSV export and import** give the data somewhere to live besides D1. Import
  upserts on the same identity the catalogue merges on, so a restore updates the
  row already there rather than creating a duplicate, and sets each quantity to
  the file's value — restoring the same backup twice leaves the same stock as
  restoring it once. A file with one unreadable row imports nothing and reports
  every problem against the row it came from.

## Projects

A project declares the parts a build needs; the planner matches those
requirements against live inventory and reports what is ready, what is missing,
and what to buy. Readiness is computed on read, so it cannot go stale as parts
are scanned, edited or removed.

Requirements match either on identity — the same `normalized_name + model_key`
the catalogue merges on — or on category alone, which covers "20 × any jumper
wire". Readiness weighs every requirement equally rather than counting units, so
a pile of jumper wires cannot make a build look nearly done while the board it
needs is missing; progress inside a single requirement still counts
proportionally. The separate ready flag answers "can I start". Five starter
templates seed a new cabinet so the tab is not empty.

## History

Every scan, confirmation, edit, merge and stock adjustment is already recorded.
The History tab reads that trail back as a reverse-chronological timeline,
owner-scoped and cursor-paginated.

## Offline

The app installs as a PWA and keeps its shell available without a signal. The
service worker caches build assets by content hash and the app shell
network-first; it never caches anything under `/api`, because inventory served
from an old visit and presented as current is worse than an error.

## Deploying

The app runs on two targets from one build. Which one it is on is decided at
runtime, not at build time: `lib/http/context.ts` asks for `cloudflare:workers`
and takes the answer, or falls back to the process environment and a local
SQLite file when that module does not exist.

### Cloudflare, through the Sites platform

`.openai/hosting.json` binds this repository to a Site, and `npm run build`
packages `dist/.openai/` — the hosting config and every migration in `drizzle/`
— for the platform to apply. Deploy from the Site, not from here. This is the
only target where ChatGPT sign-in works, because the platform's dispatcher is
what injects the identity headers `lib/auth/owner.ts` reads.

### Docker

```bash
cp .env.example .env          # CONFIRMATION_TOKEN_SECRET, GEMINI_API_KEY, ANONYMOUS_OWNER_ID
docker compose up --build
```

The image is a two-stage build: the toolchain compiles `output: "standalone"`
and is discarded, leaving a Node server, its dependencies and `drizzle/`. The
database is a SQLite file on the `cabinet-data` volume, opened on the first
query and migrated before it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `/data/cabinet.db` in the image | Where the SQLite file lives. |
| `MIGRATIONS_DIR` | `/app/drizzle` in the image | Migrations to apply on startup. |
| `PORT` | `3000` | Listen port. The server binds `0.0.0.0`. |

Migrations are journalled in a `_migrations` table, so a container restarting
against an existing volume applies only what is new. Pointing a fresh container
at a database that already has the schema but no journal fails on the first
migration rather than guessing which ones ran; migrate that file by recording
the applied filenames in `_migrations` yourself.

**Back up the volume.** Part photos are stored in the database rather than in
object storage, so `/data` is the whole cabinet, and it grows with every
confirmed scan.

**Serve it over TLS if you want the in-page camera.** Browsers expose
`getUserMedia` only on a secure origin, so a cabinet reached at
`http://192.168.1.10:3000` falls back to choosing a photo. A reverse proxy
terminating TLS — which you likely want anyway for the authentication below —
restores the viewfinder.

#### Secrets

`GEMINI_API_KEY` and `CONFIRMATION_TOKEN_SECRET` reach the container through
the environment and are never baked into the image, so the image stays safe to
rebuild and share. Keep the values in a `.env` file beside `docker-compose.yml`
— already ignored by git — owned by the deploying user and `chmod 600`. Use a
different Gemini key for development than for the deployment, so revoking one
does not take out the other, and restrict each key to the Generative Language
API in Google AI Studio. The key never reaches the browser: identification runs
in a route handler, so only the server ever holds it.

#### Authentication is yours to supply

Off the Sites platform nothing injects `oai-authenticated-user-id`, so owner
resolution falls to `ANONYMOUS_OWNER_ID` — one cabinet shared by everyone who
can reach the port — or refuses with a `401`. That is correct for a private,
single-user deployment behind a firewall or a VPN, and wrong anywhere else.

For real accounts, put an authenticating proxy in front (oauth2-proxy,
Authelia, Cloudflare Access, Tailscale) and have it set
`oai-authenticated-user-id` to a stable per-user id, leaving `ANONYMOUS_OWNER_ID`
unset. The proxy **must strip any copy of that header it receives from the
client**, or a visitor can send it themselves and read anyone's cabinet.

### A plain Node process

`npm run build && npm start` serves the same standalone output on port 3000
with the same SQLite fallback, which is how to reproduce a container locally
without building one. `DATABASE_PATH` defaults to `./data/cabinet.db`.

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
