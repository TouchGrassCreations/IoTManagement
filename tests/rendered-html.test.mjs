import assert from "node:assert/strict";
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

test("renders the persistent inventory and removal contracts", async () => {
  const html = await (await render()).text();
  assert.doesNotMatch(html, /Arduino Uno R3/);
  const dialogSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../app/components/RemoveInventoryDialog.tsx", import.meta.url), "utf8"));
  assert.match(dialogSource, /Quantity to remove/);
  assert.match(dialogSource, /Confirm removal/);
  assert.match(dialogSource, /permanently deletes all/);
});

test("does not render the disposable starter preview", async () => {
  const html = await (await render()).text();
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
  assert.doesNotMatch(html, /codex-preview/);
});
