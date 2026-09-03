import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_OWNER_ID, OwnerRequiredError, resolveOwnerId, resolveOwnerLabel } from "../../lib/auth/owner.ts";

const headers = (values = {}) => new Headers(values);

test("the signed-in user wins over any configured fallback", () => {
  const owner = resolveOwnerId(headers({ "oai-authenticated-user-id": "user-9" }), { ANONYMOUS_OWNER_ID: "local-dev" });
  assert.equal(owner, "user-9");
});

test("the configured anonymous owner covers local development", () => {
  assert.equal(resolveOwnerId(headers(), { ANONYMOUS_OWNER_ID: "local-dev" }), "local-dev");
});

test("an unidentified request without a fallback is refused", () => {
  assert.throws(() => resolveOwnerId(headers()), (error) => error instanceof OwnerRequiredError && error.code === "OWNER_REQUIRED");
  assert.throws(() => resolveOwnerId(headers(), { ANONYMOUS_OWNER_ID: "   " }), OwnerRequiredError);
});

test("no request can resolve to the legacy owner on either path", () => {
  assert.throws(() => resolveOwnerId(headers({ "oai-authenticated-user-id": LEGACY_OWNER_ID })), OwnerRequiredError);
  assert.throws(() => resolveOwnerId(headers(), { ANONYMOUS_OWNER_ID: LEGACY_OWNER_ID }), OwnerRequiredError);
});

test("an absurdly long identity is refused rather than stored", () => {
  assert.throws(() => resolveOwnerId(headers({ "oai-authenticated-user-id": "u".repeat(201) })), OwnerRequiredError);
});

test("surrounding whitespace never creates a second cabinet", () => {
  assert.equal(resolveOwnerId(headers({ "oai-authenticated-user-id": "  user-9  " })), "user-9");
});

test("the display label prefers email and falls back to the id", () => {
  assert.equal(resolveOwnerLabel(headers({ "oai-authenticated-user-email": "a@b.c", "oai-authenticated-user-id": "user-9" })), "a@b.c");
  assert.equal(resolveOwnerLabel(headers({ "oai-authenticated-user-id": "user-9" })), "user-9");
  assert.equal(resolveOwnerLabel(headers()), null);
});
