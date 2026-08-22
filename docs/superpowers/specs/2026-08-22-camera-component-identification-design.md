# Camera Component Identification Design

## Purpose

Add a camera and image-upload workflow that identifies multiple IoT components in one photo using the Gemini API free tier. Recognition results are provisional: users review and edit every detected component before any inventory or audit data is saved.

Storage-location assignment and persistent source-image storage are outside this version's scope.

## Success Criteria

- A user can capture a photo on a supported mobile browser or upload a JPG, PNG, or WebP image.
- Gemini returns zero or more structured component candidates from one image.
- Each candidate includes a region, likely identity, quantity, confidence, visible markings, and alternatives.
- Users can edit candidates, reject false detections, and add missed components.
- Exact models are used when supported by visible evidence. Otherwise, the component can be confirmed with a null model and displayed as, for example, `PIR motion sensor — model unknown`.
- No inventory data changes before explicit batch confirmation.
- Confirmed components either increment an existing matching item or create a new item.
- Every accepted detection produces an immutable audit event.
- Recognition failures and invalid responses produce no inventory or audit writes.

## Scope

### Included

- Camera capture and image-file upload
- Multiple-component recognition from one image
- One full-image Gemini request per recognition attempt
- Strict validation of Gemini's structured response
- Editable batch review and per-candidate rejection
- Manual addition of candidates missed by Gemini
- Inventory insertion and quantity merging
- Scan-level and detection-level audit history
- Duplicate-confirmation protection
- Clear setup, validation, quota, network, and retry states

### Excluded

- Permanent image or image-location storage
- Storage-bin assignment
- Automatic saving without review
- Product web search or external catalogue lookup
- Local vision inference
- Custom object-detector training
- A second recognition pass over cropped image regions

## Architecture

The existing **Identify a part** action opens a client-side camera/upload modal. The selected image is previewed locally and submitted to a server-side recognition endpoint. That endpoint validates the file, performs bounded image preprocessing when required, calls Gemini, validates the response against the application schema, and returns provisional detections. It does not write to the database.

The client displays the uploaded photo and editable detection cards. Each card corresponds to a normalized image bounding box and can be corrected, rejected, or retained. The user may also add a missing component manually.

A separate confirmation endpoint accepts the reviewed batch and a single-use confirmation token. It revalidates all fields and performs inventory merges and audit insertion atomically in Cloudflare D1. The original image is discarded after recognition and is never included in the confirmation payload.

The recognition provider is isolated behind a small server-side interface. The initial implementation uses a single Gemini full-image request, but a future two-pass crop workflow can replace it without changing the review or persistence interfaces.

## Components

### Identification Modal

- Opens from the existing mystery-part action.
- Supports `capture="environment"` for mobile camera capture and ordinary file selection.
- Accepts JPG, PNG, and WebP.
- Shows local image preview, validation errors, upload progress, and recognition progress.
- Does not imply that an image has been saved.

### Recognition Endpoint

- Accepts one authenticated or anonymous-compatible image according to the site's existing access policy.
- Enforces configured byte-size, MIME-type, decoded-image, and dimension limits.
- Rejects empty, corrupt, unsupported, or excessively large images.
- Calls Gemini only from the server so the API key is not exposed to the browser.
- Requests structured JSON and treats all model output as untrusted input.
- Returns provisional detections and a server-issued confirmation token.
- Performs no database writes.

### Gemini Recognition Adapter

The adapter accepts image bytes and returns provider-independent detections. The request instructs Gemini to inspect every visibly distinct component, group visually identical repeated items when appropriate, and avoid inventing an exact model when markings do not support one.

Each returned detection contains:

- `name`: likely canonical component name
- `model`: exact model string or `null`
- `category`: inventory category
- `quantity`: positive integer
- `boundingBox`: normalized top, left, width, and height values
- `confidence`: normalized value from 0 through 1
- `visibleMarkings`: strings actually readable in the image
- `alternatives`: up to three alternative name/model candidates
- `description`: short technical description
- `tags`: concise searchable characteristics

The server rejects responses with missing required fields, invalid coordinates, invalid quantities, excessive list sizes, or values beyond configured length limits. Unknown extra fields are discarded.

### Review Screen

- Presents the image beside or above editable detection cards depending on viewport width.
- Visually associates cards with detected regions.
- Allows editing name, model, category, quantity, description, and tags.
- Displays confidence, visible markings, and alternatives as review evidence.
- Highlights low-confidence and null-model candidates.
- Allows users to reject individual detections.
- Allows manual candidates to be added with no fabricated confidence value.
- Requires at least one accepted, valid candidate before confirmation.

### Confirmation Service

- Accepts only reviewed candidate fields, scan metadata, and the single-use confirmation token.
- Never accepts Gemini output as implicitly trusted.
- Normalizes names and models for matching while preserving confirmed display values.
- Executes the complete batch in one D1 transaction.
- Returns the affected inventory entries and scan identifier.

## Data Model

### `inventory_parts`

- `id`
- `name`
- `normalized_name`
- `model`, nullable
- `normalized_model`, nullable
- `category`
- `quantity`
- `description`
- `tags`
- `created_at`
- `updated_at`

The logical matching key is `normalized_name + normalized_model`. A null model only matches another null model with the same normalized name. It never merges into a known model variant.

Normalization trims whitespace, uses Unicode normalization, collapses repeated whitespace, and applies case-insensitive comparison. It does not remove meaningful letters, digits, hyphens, or model punctuation.

### `identification_scans`

- `id`
- `confirmation_token_hash`, unique
- `user_id`, nullable when anonymous use is permitted
- `provider`
- `provider_model`
- `accepted_detection_count`
- `created_at`

No image bytes, local path, or remote image URL are stored.

### `identification_events`

- `id`
- `scan_id`
- `inventory_part_id`
- `source`, either `gemini` or `manual`
- `detected_name`, nullable for manual candidates
- `detected_model`, nullable
- `confirmed_name`
- `confirmed_model`, nullable
- `quantity_added`
- `confidence`, nullable
- `visible_markings`
- `bounding_box`, nullable for manual candidates
- `alternatives`
- `was_edited`
- `created_at`

Event fields capture what was detected and what was ultimately confirmed. Audit events are append-only in this feature.

## Confirmation and Merge Flow

1. Validate the confirmation token and candidate payload.
2. Reject an expired, previously consumed, or invalid token.
3. Begin a D1 transaction.
4. Create the `identification_scans` record.
5. For each accepted candidate, normalize its confirmed name and model.
6. Find the matching inventory item using the normalized identity.
7. Increment the existing quantity or create a new inventory item.
8. Insert an `identification_events` record linked to the resulting inventory item.
9. Mark the confirmation token as consumed through its unique scan record.
10. Commit the transaction and return updated inventory entries.

Any failure rolls back the entire batch. A retry using a token whose transaction already committed returns an already-confirmed response and does not increment quantities again.

## Error Handling

- A missing Gemini API key returns a configuration error with no provider call.
- Unsupported, corrupt, empty, or oversized files are rejected before recognition.
- Gemini authentication, quota, timeout, network, and service errors return a retryable or non-retryable error as appropriate.
- Malformed or schema-invalid Gemini output is never shown as a successful recognition result.
- Empty valid recognition results explain that no components were found and allow a new photo; they do not create confirmation data.
- Confirmation payload errors preserve the client-side review state where possible.
- Database failure rolls back all inventory and audit changes.
- Logs must not include image bytes, API secrets, or unnecessarily detailed user-provided content.

The first version does not silently substitute demo recognition results or open an empty manual form after an API failure. It shows a clear setup or retry state.

## Security and Privacy

- `GEMINI_API_KEY` remains a server-side environment secret.
- File signatures and decoded image properties are checked rather than trusting browser-provided MIME types.
- Request and response sizes are bounded.
- Model-produced strings and arrays are length-limited and escaped by normal React rendering.
- Confirmation endpoints enforce the same identity and access policy as inventory writes.
- Confirmation tokens are unpredictable, expire after a short period, and are stored only as hashes when persisted.
- Source images are processed transiently and not intentionally retained by the application. Gemini free-tier provider data-use terms must be disclosed to users before upload.

## Testing

### Unit Tests

- Gemini response schema acceptance and rejection
- Bounding-box and confidence validation
- Name and model normalization
- Known-model, unknown-model, and distinct-model matching
- Edit detection for audit records
- Confirmation-token validation and replay prevention

### Integration Tests

- Existing-item quantity increment with audit insertion
- New-item creation with audit insertion
- Mixed batches containing new and existing items
- Rejected detections excluded from writes
- Manual candidates recorded with nullable recognition fields
- Full transaction rollback on an intermediate failure
- Missing key, provider failure, malformed output, and empty-result behavior

### UI Tests

- Camera/upload controls and accepted formats
- Multi-item editable review
- Low-confidence and unknown-model warnings
- Per-item rejection and manual item addition
- Confirmation disabled for invalid or empty accepted batches
- Retry states that do not mutate inventory
- Double-submit protection

### Release Verification

- Run lint, focused automated tests, the full test suite, and a production build.
- Exercise a real Gemini free-tier request with a representative multi-component photo when an API key is available.
- Verify the rendered flow at mobile and desktop viewport sizes.
- Confirm through database inspection that the application stores no source image data.

## Future Extensions

- Optional second-pass Gemini analysis over low-confidence crops
- External component-catalogue verification
- Storage-bin assignment after confirmation
- Optional retained image storage with an explicit privacy and lifecycle design
- Custom local detector for improved counting and region isolation
