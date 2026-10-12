import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { SITE_FILES } from "../scripts/site-files.mjs";

const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
const workerSource = readFileSync("sw.js", "utf8");

test("PWA manifest has standalone launch, relative GitHub Pages scope and real PNG icons", () => {
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.equal(manifest.icons.every((icon) => icon.src.startsWith("./")), true);
  for (const icon of manifest.icons) {
    const path = icon.src.slice(2);
    assert.ok(SITE_FILES.has(path));
    const bytes = readFileSync(path);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.equal(bytes.readUInt32BE(16), w);
    assert.equal(bytes.readUInt32BE(20), h);
    assert.ok(statSync(path).size > 1000);
  }
});

function fakeWorker(scope) {
  const listeners = {};
  const storage = new Map();
  const log = { cacheRequests: [], deletes: [], network: [], activated: false };
  const mockCache = {
    async addAll(paths) {
      log.cacheRequests.push(...paths);
      for (const path of paths) storage.set(path, { status: 200, offline: true, url: path });
    },
    async match(path) { return storage.get(path.url || path); },
  };
  const cacheTable = new Map();
  const caches = {
    async open(key) { cacheTable.set(key, mockCache); return mockCache; },
    async keys() { return ["other-app-v3", ...cacheTable.keys(), "f1-start-timer-old-app-v1"]; },
    async delete(key) { log.deletes.push(key); return true; },
    async match(request) { return mockCache.match(request); },
  };
  const self = {
    registration: { scope },
    addEventListener(name, fn) { listeners[name] = fn; },
    async skipWaiting() {}, clients: { async claim() { log.activated = true; } },
  };
  const fetch = async (request) => {
    log.network.push(request.url || request);
    throw new Error("offline");
  };
  runInNewContext(workerSource, { self, caches, fetch, URL, Set, Response });
  const trigger = async (type, request) => {
    let promise;
    listeners[type]({ request, waitUntil(value) { promise = value; }, respondWith(value) { promise = value; } });
    if (promise) return await promise;
    return undefined;
  };
  return { trigger, log, listeners, storage };
}

test("offline shell is cached in root and nested Pages scopes, and offline navigation loads index", async () => {
  for (const scope of ["https://example.com/", "https://example.com/F1-Start-Timer/"]) {
    const worker = fakeWorker(scope);
    await worker.trigger("install");
    assert.ok(worker.log.cacheRequests.includes(new URL("./src/game.js", scope).href));
    assert.ok(worker.log.cacheRequests.includes(new URL("./manifest.webmanifest", scope).href));
    assert.ok(worker.log.cacheRequests.includes(new URL("./src/result-card.js", scope).href));
    const page = await worker.trigger("fetch", { method: "GET", mode: "navigate", url: scope });
    assert.equal(page.offline, true);
    assert.equal(page.url, new URL("./index.html", scope).href);
    const game = await worker.trigger("fetch", { method: "GET", mode: "same-origin", url: new URL("./src/game.js", scope).href });
    assert.equal(game.status, 200);
    await worker.trigger("activate");
    assert.equal(worker.log.activated, true);
    assert.equal(worker.log.deletes.length, 0, "unrelated caches must remain intact");
    assert.equal(await worker.trigger("fetch", { method: "GET", mode: "same-origin", url: "https://other.test/x" }), undefined);
  }
});


test("install control appears only after a browser install prompt; SW registers on secure origins", async () => {
  const events = {};
  const button = { hidden: true, onClick: null, addEventListener(type, fn) { this.onClick = fn; } };
  const registrations = [];
  const browser = {
    addEventListener(type, callback) { events[type] = callback; },
    matchMedia() { return { matches: false }; },
  };
  const context = {
    globalThis: browser,
    document: { getElementById() { return button; } },
    location: { protocol: "https:", hostname: "example.com" },
    navigator: { serviceWorker: { async register(...args) { registrations.push(args); } } },
    console,
  };
  runInNewContext(readFileSync("src/pwa.js", "utf8"), context);
  assert.equal(button.hidden, true);
  assert.equal(registrations.length, 0, "SW registration waits for page load");
  events.load();
  await Promise.resolve();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], "./sw.js");
  assert.equal(registrations[0][1].scope, "./");
  let prompted = 0;
  let canceledNativePrompt = 0;
  events.beforeinstallprompt({ preventDefault() { canceledNativePrompt++; },
    async prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: "accepted" }) });
  assert.equal(button.hidden, false);
  assert.equal(canceledNativePrompt, 1);
  await button.onClick();
  assert.equal(prompted, 1);
  assert.equal(button.hidden, true);
  await button.onClick();
  assert.equal(prompted, 1, "one prompt is consumed once");
  events.appinstalled();
  assert.equal(button.hidden, true);
});
