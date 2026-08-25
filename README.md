# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Camera component identification

Camera identification is the way parts enter the cabinet. One photo identifies
several electronics components at once, and each confirmed part is filed with a
cropped picture of itself taken from that photo.

1. Copy `.env.example` to `.env.local`.
2. Set `GEMINI_API_KEY` to a key created in Google AI Studio.
3. Set `CONFIRMATION_TOKEN_SECRET` to a random secret of at least 16 characters.
4. Apply the migrations in `drizzle/` to the D1 database in order before
   confirming a scan.

The flow:

- **Identify with camera** is the primary action in the header, the hero, the
  toolbar, and the empty state. It opens the review workspace.
- Gemini returns likely names, models, counts, confidence, visible markings, and
  alternatives, each with a bounding box drawn over the photo.
- Every detection is cropped from that photo in the browser and shown beside the
  row, so the picture is reviewed together with the name.
- **Add a part by hand instead** appends a blank row to the same review list.
  Manual rows carry the same fields, take an optional photo, and are saved
  through the same confirmation. There is no separate add-a-component form.
- Nothing is written until the reviewed batch is confirmed.

### Part photos

Confirmed parts store a cropped thumbnail as a data URL in `inventory_parts.image`:

- Cropping, downscaling, and encoding happen in the browser. Tiles are at most
  320 px on the long edge and are re-encoded down a quality ladder until they fit
  the 160 KB per-part budget, so they stay far below D1's value limit.
- The full uploaded photo is still never stored, and its bytes never reach the
  database — only the confirmed crops do.
- Parts without a photo keep the lettered tile and offer **Add photo** on the
  card, which crops and stores an image the same way through
  `POST /api/inventory/:id/photo`.
- Re-scanning a part that already has a photo keeps the existing crop unless the
  new scan supplies one.

The prototype defaults to `gemini-3.1-flash-lite`, accepts images up to 10 MiB,
and sends them to the Gemini API for processing; review Google's free-tier
data-use terms before enabling uploads for users.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
