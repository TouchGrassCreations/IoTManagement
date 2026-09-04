import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_OWNER_ID, OwnerRequiredError } from "../../lib/auth/owner.ts";
import { CabinetNotVisibleError, ensureCabinet, getCabinet, setCabinetVisibility } from "../../lib/cabinet/persistence.ts";
import { resolveReadScope } from "../../lib/cabinet/scope.ts";
import { accessFor, isCabinetVisibility } from "../../lib/cabinet/types.ts";
import { createDatabase } from "../helpers/sqlite-d1.mjs";

const OWNER = "owner-1";
const scopeOver = (adapter) => (target, viewerId) =>
  resolveReadScope({ target, viewerId, loadCabinet: (ownerId) => getCabinet(ownerId, adapter) });

test("only the owner edits, and only a shared cabinet opens to anyone else", () => {
  const cabinet = { ownerId: OWNER, visibility: "private" };
  assert.deepEqual(accessFor(cabinet, OWNER), { canView: true, canEdit: true });
  assert.deepEqual(accessFor(cabinet, "owner-2"), { canView: false, canEdit: false });
  assert.deepEqual(accessFor(cabinet, null), { canView: false, canEdit: false });

  const shared = { ...cabinet, visibility: "public" };
  assert.deepEqual(accessFor(shared, "owner-2"), { canView: true, canEdit: false });
  assert.deepEqual(accessFor(shared, null), { canView: true, canEdit: false });
  assert.deepEqual(accessFor(shared, OWNER), { canView: true, canEdit: true });
  assert.deepEqual(accessFor(null, OWNER), { canView: false, canEdit: false });
});

test("visibility accepts only the two states", () => {
  assert.ok(isCabinetVisibility("private"));
  assert.ok(isCabinetVisibility("public"));
  assert.ok(!isCabinetVisibility("unlisted"));
  assert.ok(!isCabinetVisibility(undefined));
});

test("a cabinet starts private and toggles both ways", async () => {
  const { adapter } = createDatabase();
  const created = await ensureCabinet(OWNER, "ada@example.com", adapter);
  assert.deepEqual(created, { ownerId: OWNER, label: "ada@example.com", visibility: "private" });

  const shared = await setCabinetVisibility(OWNER, "public", "ada@example.com", adapter);
  assert.equal(shared.visibility, "public");
  assert.equal((await ensureCabinet(OWNER, "ada@example.com", adapter)).visibility, "public", "an existing cabinet is never reset");
  assert.equal((await setCabinetVisibility(OWNER, "private", null, adapter)).visibility, "private");
});

test("sharing can be turned on for an owner who has no cabinet row yet", async () => {
  const { adapter } = createDatabase();
  const shared = await setCabinetVisibility("owner-9", "public", null, adapter);
  assert.equal(shared.visibility, "public");
});

test("a read without an owner needs a signed-in visitor", async () => {
  const { adapter } = createDatabase();
  const scope = scopeOver(adapter);
  assert.deepEqual(await scope(null, OWNER), { ownerId: OWNER, canEdit: true });
  await assert.rejects(scope(null, null), (error) => error instanceof OwnerRequiredError);
});

test("a private cabinet stays closed to everyone but its owner", async () => {
  const { adapter } = createDatabase();
  await ensureCabinet(OWNER, null, adapter);
  const scope = scopeOver(adapter);
  await assert.rejects(scope(OWNER, null), (error) => error instanceof CabinetNotVisibleError);
  await assert.rejects(scope(OWNER, "owner-2"), (error) => error instanceof CabinetNotVisibleError);
  assert.deepEqual(await scope(OWNER, OWNER), { ownerId: OWNER, canEdit: true }, "the owner still edits their own");
});

test("a shared cabinet opens read-only, and closes again when made private", async () => {
  const { adapter } = createDatabase();
  await setCabinetVisibility(OWNER, "public", null, adapter);
  const scope = scopeOver(adapter);
  assert.deepEqual(await scope(OWNER, null), { ownerId: OWNER, canEdit: false });
  assert.deepEqual(await scope(OWNER, "owner-2"), { ownerId: OWNER, canEdit: false });
  assert.deepEqual(await scope(OWNER, OWNER), { ownerId: OWNER, canEdit: true });

  await setCabinetVisibility(OWNER, "private", null, adapter);
  await assert.rejects(scope(OWNER, "owner-2"), (error) => error instanceof CabinetNotVisibleError);
});

test("an owner nobody has claimed is never readable", async () => {
  const { adapter } = createDatabase();
  const scope = scopeOver(adapter);
  await assert.rejects(scope("owner-absent", "owner-2"), (error) => error instanceof CabinetNotVisibleError);
  await assert.rejects(scope(LEGACY_OWNER_ID, "owner-2"), (error) => error instanceof CabinetNotVisibleError);
  assert.equal(await getCabinet(LEGACY_OWNER_ID, adapter), null, "the legacy owner has no cabinet even if a row exists");
});

test("a blank owner parameter falls back to your own cabinet", async () => {
  const { adapter } = createDatabase();
  assert.deepEqual(await scopeOver(adapter)("   ", OWNER), { ownerId: OWNER, canEdit: true });
});
