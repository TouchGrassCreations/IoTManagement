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

test("without a configured proxy secret the platform header is authoritative", () => {
  // The Sites path is unchanged: the dispatcher is the only thing that can
  // reach the app, so there is nothing to prove.
  assert.equal(resolveOwnerId(headers({ "oai-authenticated-user-id": "user-9" }), {}), "user-9");
});

test("a configured proxy secret makes an unproven identity count for nothing", () => {
  const env = { TRUSTED_PROXY_SECRET: "proxy-secret-value" };
  const spoofed = headers({ "oai-authenticated-user-id": "somebody-elses-cabinet" });

  // This is the whole point: a request that reaches the container's port
  // directly, carrying a header it wrote itself, must not become that owner.
  assert.throws(() => resolveOwnerId(spoofed, env), OwnerRequiredError);
  assert.throws(() => resolveOwnerId(headers({
    "oai-authenticated-user-id": "somebody-elses-cabinet",
    "x-cabinet-proxy-secret": "wrong-secret-value",
  }), env), OwnerRequiredError);
});

test("the proxy's own identity is honoured when it proves itself", () => {
  const owner = resolveOwnerId(headers({
    "oai-authenticated-user-id": "user-9",
    "x-cabinet-proxy-secret": "proxy-secret-value",
  }), { TRUSTED_PROXY_SECRET: "proxy-secret-value" });

  assert.equal(owner, "user-9");
});

test("a near-miss secret is refused, prefix or length", () => {
  const env = { TRUSTED_PROXY_SECRET: "proxy-secret-value" };
  for (const supplied of ["proxy-secret-valu", "proxy-secret-values", "", "PROXY-SECRET-VALUE"]) {
    assert.throws(
      () => resolveOwnerId(headers({ "oai-authenticated-user-id": "user-9", "x-cabinet-proxy-secret": supplied }), env),
      OwnerRequiredError,
      `"${supplied}" should not pass`,
    );
  }
});

test("an untrusted identity falls through to the anonymous owner rather than erroring", () => {
  const owner = resolveOwnerId(headers({ "oai-authenticated-user-id": "somebody-else" }), {
    TRUSTED_PROXY_SECRET: "proxy-secret-value",
    ANONYMOUS_OWNER_ID: "shared-cabinet",
  });

  assert.equal(owner, "shared-cabinet", "an unproven header is no header, not a different owner");
});

test("an unproven email is never rendered as the signed-in name", () => {
  const claimed = headers({ "oai-authenticated-user-email": "victim@example.com" });

  assert.equal(resolveOwnerLabel(claimed, { TRUSTED_PROXY_SECRET: "proxy-secret-value" }), null);
  assert.equal(resolveOwnerLabel(claimed), "victim@example.com", "unset secret keeps the platform behaviour");
});
