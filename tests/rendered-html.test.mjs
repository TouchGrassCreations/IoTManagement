import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("server-renders the Parts Cabinet application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Parts Cabinet — IoT Inventory &amp; Project Planner<\/title>/i);
  assert.match(html, />Parts Cabinet</);
  assert.match(html, />Inventory</);
  assert.match(html, /Identify a part/);
  assert.match(html, /Loading inventory/);
});

test("leads the catalogue with camera identification", async () => {
  const html = await (await render()).text();
  assert.match(html, /Identify with camera/);
  assert.match(html, /Identify &amp;? ?catalogue/);
  assert.doesNotMatch(html, /Add component/);

  const inventorySource = await source("app/components/InventoryView.tsx");
  assert.doesNotMatch(inventorySource, /handleInventoryCreate|isAdding/);
  assert.match(inventorySource, /attach-photo-button/);
  assert.match(inventorySource, /part\.hasImage \? <img src=\{partPhotoUrl\(part, owner\)\}/);

  const workspaceSource = await source("app/components/IdentificationWorkspace.tsx");
  assert.match(workspaceSource, /cropDetections/);
  assert.match(workspaceSource, /Add a part by hand instead/);
});

test("a part photo can be removed, and a shared cabinet cannot be edited", async () => {
  const inventorySource = await source("app/components/InventoryView.tsx");
  assert.match(inventorySource, /Remove photo/);
  assert.match(inventorySource, /savePartPhoto\(id, null\)/);
  // Every mutating control is behind the owner check.
  for (const control of [/canEdit && <button className="add-button"/, /\{canEdit && \(part\.hasImage/, /canEdit && <div className="file-controls"/]) {
    assert.match(inventorySource, control);
  }
  const projectsSource = await source("app/components/ProjectsView.tsx");
  assert.match(projectsSource, /canEdit && <div className="projects-actions"/);
  const sharedSource = await source("app/components/SharedCabinetView.tsx");
  assert.match(sharedSource, /canEdit=\{false\}/);
});

test("the camera suggests projects for what it identifies", async () => {
  const workspaceSource = await source("app/components/IdentificationWorkspace.tsx");
  assert.match(workspaceSource, /projectIdeas/);
  assert.match(workspaceSource, /New project of my own/);
  assert.match(workspaceSource, /fetchProjects/);
  // The cabinet's project names reach Gemini from the server, never the client.
  const routeSource = await source("app/api/identify/route.ts");
  assert.match(routeSource, /listProjectPlans/);
  assert.doesNotMatch(workspaceSource, /promptFor/);
});

test("renders the persistent inventory and removal contracts", async () => {
  const html = await (await render()).text();
  assert.doesNotMatch(html, /Arduino Uno R3/);
  const dialogSource = await source("app/components/RemoveInventoryDialog.tsx");
  assert.match(dialogSource, /Quantity to remove/);
  assert.match(dialogSource, /Confirm removal/);
  assert.match(dialogSource, /permanently deletes all/);
});

test("supports concurrent pending removals per component", async () => {
  const inventorySource = await source("app/components/InventoryView.tsx");
  assert.match(inventorySource, /pendingRemovals/);
  assert.match(inventorySource, /pending\.item\.id === part\.id/);
  assert.match(inventorySource, /undoRemoval\(pending\.item\.id\)/);
  assert.match(inventorySource, /removal-toast-stack/);
  assert.match(inventorySource, /responseGuard\.current\.recordMutation\(\)/);
  // A conflicting write hands back the server's row so the card can resynchronise.
  assert.match(inventorySource, /failure\.status === 409[\s\S]*replaceItem\(failure\.item\)/);
  const clientSource = await source("lib/inventory/client.ts");
  assert.match(clientSource, /class ApiError[\s\S]*item\?: InventoryItem/);
});

test("a confirmed scan reloads the catalogue from the server", async () => {
  const pageSource = await source("app/page.tsx");
  assert.match(pageSource, /onConfirmed=\{\(\) => setRefreshToken/);
  assert.match(pageSource, /<InventoryView refreshToken=\{refreshToken\}/);
});

test("the list payload and the thumbnail endpoint stay separate", async () => {
  const persistenceSource = await source("lib/inventory/persistence.ts");
  // Selecting `image` here would put base64 back into every list response.
  assert.doesNotMatch(persistenceSource, /const SELECT_COLUMNS =[^;]*,image[,"]/);
  assert.match(persistenceSource, /\(image IS NOT NULL\) AS has_image/);
});

test("does not render the disposable starter preview", async () => {
  const html = await (await render()).text();
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
  assert.doesNotMatch(html, /codex-preview/);
});
