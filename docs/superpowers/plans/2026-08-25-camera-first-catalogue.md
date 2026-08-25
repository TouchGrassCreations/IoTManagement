# Camera-first catalogue with part photos

## Problem

Camera identification was the most capable part of the product but was reached
through a small card in the category sidebar, while the primary "Add component"
button opened an unrelated manual form. The two paths wrote through different
endpoints, and inventory cards showed a three-letter tile instead of the part.

## Decisions

1. **Camera identification is the catalogue.** The header, hero, toolbar, and
   empty state all open the identification workspace. The standalone
   add-component modal and `POST /api/inventory` are removed; manual entry is a
   blank row inside the review list, saved through `/api/identify/confirm` with
   the rest of the batch.
2. **Photos are cropped thumbnails stored in D1** (`inventory_parts.image`) as
   data URLs, because the project has no R2 binding (`.openai/hosting.json` sets
   `"r2": null`). Cropping happens in the browser from the detection's bounding
   box; the full photo is never uploaded to the database.
3. **Photoless parts keep the lettered tile** and gain an optional photo: manual
   rows take one during review, and existing parts take one from the card
   through `POST /api/inventory/:id/photo`.

## Shape

- `lib/identification/image.ts` — crop geometry, thumbnail sizing, and data-URL
  validation shared by the browser and the routes.
- `lib/identification/crop-client.ts` — canvas cropping and the quality ladder
  that keeps a tile inside the per-part budget.
- `drizzle/0003_inventory_part_photos.sql` — `inventory_parts.image` and
  `identification_events.captured_image`.
- Confirmation now also persists the storage location and a card code derived
  from the confirmed model, and a rescan without a photo keeps the stored one.

## Verification

- `npm run test:unit` covers crop geometry, photo validation, the routes, and a
  round trip of the real SQL against SQLite.
- A browser pass with a synthetic quadrant photo confirmed each detection is
  cropped from its own region, and that a confirmed scan reaches the inventory
  card as a photo.
