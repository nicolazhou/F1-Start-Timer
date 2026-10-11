/* Zero-npm-dependency Chromium/Chrome end-to-end smoke test via DevTools Protocol.
 * Runs against the actual static production build at both / and a Pages-style subpath.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { SITE_FILES } from "./site-files.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findChrome() {
  for (const candidate of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) return candidate;
  }
  throw new Error("Chrome/Chromium not found. Set CHROME_BIN or run this on GitHub Actions.");
}

function createSiteServer() {
  return createServer(async (req, res) => {
    let route;
    try { route = new URL(req.url, "http://localhost").pathname; }
    catch { res.writeHead(400).end(); return; }
    route = route.replace(/^\/f1-start-timer\//, "/");
    const path = route === "/" ? "index.html" : route.slice(1);
    const type = SITE_FILES.get(path);
    if (!type) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(resolve("dist", path));
      res.writeHead(200, { "Content-Type": type }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
}

class Cdp {
  nextId = 0;
  promises = new Map();
  errors = [];
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.promises.get(message.id);
        if (pending) {
          this.promises.delete(message.id);
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
      } else if (message.method === "Runtime.exceptionThrown") {
        this.errors.push("JavaScript: " + (message.params.exceptionDetails.text || JSON.stringify(message.params)));
      } else if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        this.errors.push("HTTP " + message.params.response.status + ": " + message.params.response.url);
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return await new Promise((resolve, reject) => {
      this.promises.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + result.result?.description);
    return result.result.value;
  }
  async until(expression, timeoutMs = 9000) {
    const deadline = Date.now() + timeoutMs;
    do { if (await this.evaluate(expression)) return; await sleep(40); } while (Date.now() < deadline);
    const state = await this.evaluate("({url: location.href, ready: document.readyState, html: document.documentElement.outerHTML.slice(0, 700), label: document.getElementById('game-control')?.getAttribute('aria-label')})");
    throw new Error(`Browser timed out waiting for: ${expression}; state=${JSON.stringify(state)}; errors=${JSON.stringify(this.errors)}`);
  }
  close() { this.ws.close(); }
}

async function run() {
  const chrome = findChrome();
  const dir = await mkdtemp(join(tmpdir(), "f1-chrome-"));
  const server = createSiteServer();
  let proc;
  let cdp;
  try {
    await new Promise((resolve, reject) => { server.listen(0, "127.0.0.1", resolve); server.once("error", reject); });
    const port = server.address().port;
    let restrictedBrowser = false;
    const args = ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"];
    proc = spawn(chrome, args, { stdio: "ignore" });
    let debuggingPort;
    for (let i = 0; i < 100; i++) {
      try {
        const contents = await readFile(join(dir, "DevToolsActivePort"), "utf8");
        debuggingPort = Number(contents.split("\n")[0]);
        break;
      } catch { if (proc.exitCode !== null) throw new Error(`Chrome exited (${proc.exitCode})`); await sleep(100); }
    }
    if (!debuggingPort) throw new Error("Chrome remote debugging port unavailable");
    const pages = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json();
    const page = pages.find((item) => item.type === "page");
    assert.ok(page, "Chromium has no page target");
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "Math.random = () => 0;" });

    for (const path of ["/", "/f1-start-timer/"]) {
      cdp.errors = [];
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      const navigation = restrictedBrowser ? { errorText: "net::ERR_BLOCKED_BY_ADMINISTRATOR" }
        : await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}${path}` });
      if (navigation.errorText === "net::ERR_BLOCKED_BY_ADMINISTRATOR") {
        // Some sandboxed environments prohibit all Chrome navigation. Still
        // exercise real DOM, rendering and game JS; CI tests actual HTTP paths.
        restrictedBrowser = true;
        await cdp.send("Page.navigate", { url: "about:blank" });
        const html = (await readFile("dist/index.html", "utf8"))
          .replace(/<link rel="stylesheet"[^>]*>/, "")
          .replace(/<script defer src="[^"]+"><\/script>/g, "");
        await cdp.evaluate(`document.open(); document['write'](${JSON.stringify(html)}); document.close();`);
        const css = await readFile("dist/src/style.css", "utf8");
        await cdp.evaluate(`document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));`);
        await cdp.evaluate(await readFile("dist/src/game.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/main.js", "utf8"));
      } else if (navigation.errorText) {
        throw new Error(`Navigation failed for ${path}: ${navigation.errorText}`);
      }
      // Check the destination too: an old document may still be visible while
      // Chrome processes Page.navigate, even when document.readyState is complete.
      const correctPath = restrictedBrowser ? "true" : `location.pathname === ${JSON.stringify(path)}`;
      await cdp.until(`${correctPath} && document.readyState === 'complete' && typeof globalThis.F1StartTimerGame?.createReactionGame === 'function' && document.getElementById('game-control')?.getAttribute('aria-label') === 'Start reaction time test'`);
      assert.equal(await cdp.evaluate("document.querySelectorAll('.light-container').length"), 5);
      assert.equal(await cdp.evaluate("document.querySelector('h1').textContent"), "F1 Start Timer");
      assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "00.000");
      assert.equal(await cdp.evaluate("getComputedStyle(document.documentElement).backgroundColor"), "rgb(255, 255, 255)");
      assert.equal(await cdp.evaluate("document.querySelector('#game-control').getAttribute('role')"), "button");
      assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('game-control')).cursor"), "default", "Game should show the arrow cursor");
      assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('creator-link')).cursor"), "pointer", "Creator link should show the hand cursor");
      assert.ok(await cdp.evaluate("document.getElementById('instructions')?.textContent.trim().length > 0"), "Play instructions must be present");
      assert.ok(await cdp.evaluate("document.querySelector('link[rel=icon]') !== null"));
      assert.ok(await cdp.evaluate("document.getElementById('credits') !== null"));
      assert.ok(await cdp.evaluate("document.getElementById('creator-link') !== null"));
      assert.ok(await cdp.evaluate("!document.getElementById('game-control').contains(document.getElementById('creator-link'))"));
      // The creator credit is optional: it is hidden with no username, but
      // deliberately visible in local previews after GITHUB_USERNAME is set.
      // Both configurations must pass CI; validate a visible link instead of
      // assuming that developers left the username blank.
      const creator = await cdp.evaluate(`(() => {
        const credits = document.getElementById('credits');
        const link = document.getElementById('creator-link');
        return {
          visible: !credits.hidden,
          href: link.getAttribute('href'),
          label: link.textContent.trim(),
        };
      })()`);
      if (creator.visible) {
        assert.match(creator.href || "", /^https:\/\/github\.com\/[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i,
          "Visible creator credit must link to a valid GitHub profile");
        const handle = new URL(creator.href).pathname.slice(1);
        assert.equal(creator.label, `@${handle}`, "Credit label must match its GitHub profile URL");
      } else {
        assert.equal(creator.href, null, "Hidden creator credit must not contain a stale profile link");
        assert.equal(creator.label, "", "Hidden creator credit must not show a placeholder username");
      }
      assert.deepEqual(cdp.errors, [], `Startup errors on ${path}`);
      console.log(`Browser boot check passed: ${path}`);
    }

    for (const [width, height] of [[320, 700], [360, 780], [375, 667], [568, 320], [600, 350], [768, 1024], [1280, 720]]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 601 });
      assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), `Horizontal overflow at ${width}x${height}`);
    }

    // The creator link must remain independent from gameplay.
    await cdp.evaluate("document.getElementById('creator-link').href='https://github.com/example-user'; document.getElementById('creator-link').textContent='@example-user'; document.getElementById('credits').hidden=false");
    const phaseBeforeCreatorPress = await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')");
    await cdp.evaluate("document.getElementById('creator-link').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), phaseBeforeCreatorPress, "Creator link must not start the clock");

    // Keyboard + pointer interactions at 320px, false start and full round.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile horizontal overflow");
    await cdp.evaluate("document.getElementById('game-control').focus(); document.getElementById('game-control').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 2);
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new KeyboardEvent('keydown', {key:' ', bubbles:true}));");
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "JUMP START!");
    assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Jump-start message overflows mobile screen");
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown', {button:0, isPrimary:true, bubbles:true}));");
    await cdp.until("document.querySelectorAll('.light.on').length === 10", 5500);
    await cdp.until("document.getElementById('game-control').getAttribute('aria-label') === 'Stop the reaction time clock'", 3500);
    await sleep(120);
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown', {button:0, isPrimary:true, bubbles:true}));");
    const score = await cdp.evaluate("document.getElementById('result').textContent");
    assert.match(score, /^\d{2}\.\d{3}$/);
    assert.notEqual(await cdp.evaluate("document.getElementById('best').textContent"), "Your best: —");
    if (!restrictedBrowser) {
      await cdp.send("Page.reload", { ignoreCache: true });
      await cdp.until("document.readyState === 'complete' && document.getElementById('best')?.textContent !== 'Your best: —'");
      assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "00.000");
    }
    assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
    assert.deepEqual(cdp.errors, [], "Browser JS errors/HTTP failures");
    console.log(restrictedBrowser
      ? "Browser DOM gameplay passed: keyboard, pointer, jump start, reaction, 320px (navigation restricted; CI will test HTTP/reload)"
      : "Browser gameplay passed: keyboard, pointer, jump start, reaction, record, reload, 320px");
  } finally {
    if (cdp) cdp.close();
    if (proc) proc.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}
await run();
