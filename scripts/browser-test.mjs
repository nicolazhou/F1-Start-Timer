/* Zero-npm-dependency Chromium/Chrome end-to-end smoke test via DevTools Protocol.
 * Runs against the actual static production build at both / and a Pages-style subpath.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

// Ask the operating system for an unused port instead of relying on Chrome's
// DevToolsActivePort file. Some CI Chrome builds never write that file even
// though the HTTP DevTools endpoint is available.
async function reserveDebugPort() {
  const reservation = createServer();
  try {
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    return reservation.address().port;
  } finally {
    await new Promise((resolve) => reservation.close(resolve));
  }
}

async function waitForDebugging(port, proc, getLaunchError, getChromeLogs) {
  const deadline = Date.now() + 20_000;
  let lastError = "not listening yet";
  while (Date.now() < deadline) {
    if (getLaunchError()) throw new Error(`Could not launch Chrome: ${getLaunchError().message}`);
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready (exit=${proc.exitCode}, signal=${proc.signalCode}).\n${getChromeLogs()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(800),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const pages = await response.json();
      if (Array.isArray(pages) && pages.some((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
        return pages;
      }
      lastError = "DevTools has no page WebSocket target yet";
    } catch (error) {
      lastError = error.cause?.code || error.message;
    }
    await sleep(150);
  }
  throw new Error(`Chrome DevTools did not start on localhost:${port} within 20 seconds (${lastError}).\n` +
    `Chrome exit=${proc.exitCode}, signal=${proc.signalCode}.\n${getChromeLogs()}`);
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
    const debuggingPort = await reserveDebugPort();
    let restrictedBrowser = false;
    const args = ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
      "--lang=en-US", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${dir}`, "about:blank"];
    // Preserve stderr for meaningful GitHub Actions diagnostics if startup fails.
    // Never suppress a failure or mark the smoke test as successful without Chrome.
    let chromeLogs = "";
    let launchError = null;
    proc = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.on("error", (error) => { launchError = error; });
    proc.stderr.on("data", (chunk) => { chromeLogs = (chromeLogs + chunk.toString()).slice(-12_000); });
    const pages = await waitForDebugging(debuggingPort, proc, () => launchError, () => chromeLogs);
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    assert.ok(page, "Chromium has no page target");
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "Math.random = () => 0; Object.defineProperty(navigator, 'languages', {get: () => ['en-US']}); Object.defineProperty(navigator, 'language', {get: () => 'en-US'});" });

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
        await cdp.evaluate(await readFile("dist/src/options.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/i18n.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/history.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/training.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/backup.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/training-ui.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/result-card.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/main.js", "utf8"));
        await cdp.evaluate(await readFile("dist/src/pwa.js", "utf8"));
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
      assert.ok(await cdp.evaluate("document.getElementById('extras') !== null"));
      assert.equal(await cdp.evaluate("document.getElementById('tab-history')?.getAttribute('aria-selected')"), "true");
      assert.equal(await cdp.evaluate("document.getElementById('trials-stat')?.textContent"), "0");
      assert.equal(await cdp.evaluate("document.getElementById('history-period')?.value"), "all");
      assert.equal(await cdp.evaluate("document.getElementById('median-stat')?.textContent"), "—");
      assert.equal(await cdp.evaluate("document.getElementById('consistency-stat')?.textContent"), "—");
      assert.equal(await cdp.evaluate("document.getElementById('export-history')?.disabled"), true);
      assert.equal(await cdp.evaluate("document.getElementById('setting-sound').checked"), false);
      assert.equal(await cdp.evaluate("document.getElementById('setting-green-lights').checked"), false);
      assert.equal(await cdp.evaluate("document.getElementById('setting-live-timer').checked"), false);
      assert.equal(await cdp.evaluate("document.getElementById('setting-color-vision').value"), "standard");
      assert.equal(await cdp.evaluate("document.getElementById('download-card').disabled"), true);
      assert.ok(await cdp.evaluate("document.querySelector('link[rel=manifest]') !== null"));
      assert.ok(await cdp.evaluate("typeof globalThis.F1StartTimerCard?.createCard === 'function'"));
      assert.equal(await cdp.evaluate("document.getElementById('result').getAttribute('aria-live')"), "off");
      assert.equal(await cdp.evaluate("document.querySelectorAll('.light.green').length"), 0);
      assert.equal(await cdp.evaluate("document.getElementById('setting-language').value"), "auto");
      assert.equal(await cdp.evaluate("document.documentElement.lang"), "en");
      assert.equal(await cdp.evaluate("document.getElementById('copy-result').disabled"), true);
      assert.equal(await cdp.evaluate("document.getElementById('export-results').disabled"), true);
      assert.deepEqual(cdp.errors, [], `Startup errors on ${path}`);
      console.log(`Browser boot check passed: ${path}`);
    }

    for (const [width, height] of [[320, 700], [360, 780], [375, 667], [568, 320], [600, 350], [768, 1024], [1280, 720]]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 601 });
      assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), `Horizontal overflow at ${width}x${height}`);
    }

    // Mockup settings: real native disclosure -> modal with accessible gear,
    // scrolling lock, focus containment, keyboard dismissal and focus return.
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open && document.activeElement?.id === 'close-settings'");
    assert.equal(await cdp.evaluate("document.querySelector('.extras-content').getAttribute('role')"), "dialog");
    assert.equal(await cdp.evaluate("document.querySelector('.extras-content').getAttribute('aria-modal')"), "true");
    assert.equal(await cdp.evaluate("document.querySelector('.settings-gear')?.tagName === 'IMG' && document.querySelector('.settings-gear').getAttribute('src') === './public/icons/gear.svg'"), true);
    // Restricted local sandbox navigation falls back to injected HTML where
    // relative images cannot load; CI exercises the actual SVG over HTTP.
    if (!restrictedBrowser) await cdp.until("document.querySelector('.settings-gear')?.complete && document.querySelector('.settings-gear')?.naturalWidth === 16");
    assert.equal(await cdp.evaluate("document.documentElement.classList.contains('settings-open')"), true);
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('settings-backdrop')).display"), "block");
    await cdp.evaluate("document.getElementById('close-settings').click()");
    await cdp.until("!document.getElementById('extras').open && document.activeElement?.id === 'game-control'");
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open");
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    await cdp.until("!document.getElementById('extras').open");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), "Start reaction time test");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open");
    // Mobile bottom sheet: sticky tab header, independent scrolling, full-width
    // selectors and unobstructed actions across narrow/tall phone viewports.
    for (const [width, height] of [[320, 700], [390, 844], [430, 932], [568, 320]]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
      const geometry = await cdp.evaluate(`(() => {
        const sheet = document.querySelector('.extras-content');
        const head = document.querySelector('.settings-head');
        const body = document.querySelector('.settings-body');
        const box = sheet.getBoundingClientRect();
        return { left: box.left, right: box.right, bottom: box.bottom,
          width: innerWidth, height: innerHeight, bodyScroll: body.scrollHeight > body.clientHeight,
          headBottom: head.getBoundingClientRect().bottom,
          bodyTop: body.getBoundingClientRect().top,
          overflow: document.documentElement.scrollWidth - innerWidth };
      })()`);
      assert.ok(Math.abs(geometry.left) <= 1 && Math.abs(geometry.right - geometry.width) <= 1,
        `Settings should span the ${width}px phone width: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.bottom <= geometry.height + 1 && geometry.bottom >= geometry.height - 1,
        `Settings should rest on the bottom edge: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.bodyScroll, `The ${width}px settings sheet must scroll independently`);
      assert.ok(geometry.headBottom <= geometry.bodyTop + 2,
        `Header must stay outside the scrolling area: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.overflow <= 1, `${width}px settings must not overflow horizontally`);
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.evaluate("document.getElementById('tab-preferences').click()");
    const preferenceLayout = await cdp.evaluate(`(() => {
      const body = document.querySelector('.settings-body');
      const row = document.querySelector('#setting-color-vision').closest('.setting-select');
      const select = document.getElementById('setting-color-vision');
      const buttons = [...document.querySelectorAll('#panel-preferences .result-actions button')];
      return { rowWidth: row.getBoundingClientRect().width,
        selectWidth: select.getBoundingClientRect().width,
        selectHeight: select.getBoundingClientRect().height,
        buttonMinHeight: Math.min(...buttons.map((item) => item.getBoundingClientRect().height)),
        bodyOverflow: body.scrollWidth - body.clientWidth };
    })()`);
    assert.ok(preferenceLayout.selectWidth >= preferenceLayout.rowWidth - 30,
      `Mobile select should have its own wide row: ${JSON.stringify(preferenceLayout)}`);
    assert.ok(preferenceLayout.selectHeight >= 44 && preferenceLayout.buttonMinHeight >= 44,
      `Touch fields and buttons must have 44px targets: ${JSON.stringify(preferenceLayout)}`);
    assert.ok(preferenceLayout.bodyOverflow <= 1, "Preferences must not have horizontal overflow");
    if (process.env.F1_MOBILE_SETTINGS_SCREENSHOT) {
      // Local preview in Italian, then restore the automatic browser language.
      await cdp.evaluate(`(() => {
        const language = document.getElementById('setting-language');
        language.value = 'it';
        language.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('tab-history').click();
        document.getElementById('tab-preferences').click();
      })()`);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(process.env.F1_MOBILE_SETTINGS_SCREENSHOT, Buffer.from(shot.data, "base64"));
      await cdp.evaluate(`(() => {
        const language = document.getElementById('setting-language');
        language.value = 'auto';
        language.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    }
    await cdp.evaluate(`(() => { document.querySelector('.settings-body').scrollTop = 300;
      document.getElementById('tab-history').click(); })()`);
    assert.equal(await cdp.evaluate("document.querySelector('.settings-body').scrollTop"), 0,
      "Changing tabs should restore the top of the new tab");
    await cdp.evaluate("document.getElementById('settings-backdrop').click()");
    await cdp.until("!document.getElementById('extras').open");

    // The creator link must remain independent from gameplay.
    await cdp.evaluate("document.getElementById('creator-link').href='https://github.com/example-user'; document.getElementById('creator-link').textContent='@example-user'; document.getElementById('credits').hidden=false");
    const phaseBeforeCreatorPress = await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')");
    await cdp.evaluate("document.getElementById('creator-link').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), phaseBeforeCreatorPress, "Creator link must not start the clock");

    // Settings are separate from gameplay, are saved locally and must never
    // count as a false start. Check extreme text scaling at phone widths.
    await cdp.evaluate(`(() => {
      const setting = document.getElementById('setting-contrast');
      setting.dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}));
      setting.checked = true;
      setting.dispatchEvent(new Event('change', {bubbles:true}));
      const scale = document.getElementById('setting-scale');
      scale.value = '150';
      scale.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), "Start reaction time test", "Settings interaction must not begin a game");
    assert.equal(await cdp.evaluate("document.documentElement.dataset.highContrast"), "true");
    assert.equal(await cdp.evaluate("document.documentElement.dataset.textScale"), "150");
    await cdp.evaluate(`(() => {
      const sound = document.getElementById('setting-sound');
      sound.checked = true;
      sound.dispatchEvent(new Event('change', {bubbles:true}));
      sound.checked = false;
      sound.dispatchEvent(new Event('change', {bubbles:true}));
      const motion = document.getElementById('setting-motion');
      motion.checked = true;
      motion.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    assert.equal(await cdp.evaluate("document.documentElement.dataset.reduceMotion"), "true");
    assert.equal(await cdp.evaluate("document.getElementById('setting-sound').checked"), false);
    if (!restrictedBrowser) assert.equal(await cdp.evaluate("JSON.parse(localStorage.getItem('f1-start-timer:settings')).textScale"), 150);

    // Switching language must update every UI surface without starting a round.
    await cdp.evaluate(`(() => {
      const language = document.getElementById('setting-language');
      language.value = 'it';
      language.dispatchEvent(new Event('change', {bubbles:true}));
      document.getElementById('extras').open = true;
    })()`);
    assert.equal(await cdp.evaluate("document.documentElement.lang"), "it");
    assert.match(await cdp.evaluate("document.getElementById('instructions').textContent"), /Clicca o tocca/);
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), "Inizia il test dei riflessi");
    assert.equal(await cdp.evaluate("document.getElementById('best').textContent"), "Il tuo record: —");
    assert.equal(await cdp.evaluate("document.getElementById('copy-result').textContent"), "Copia il risultato");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), "Inizia il test dei riflessi");
    for (const language of ['it', 'es', 'fr', 'de', 'en']) {
      await cdp.evaluate(`(() => {
        const select = document.getElementById('setting-language');
        select.value = ${JSON.stringify(language)};
        select.dispatchEvent(new Event('change', {bubbles:true}));
      })()`);
      for (const width of [320, 375, 600, 1280]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: width < 601 });
        assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
          `Horizontal overflow with ${language} at ${width}px`);
      }
    }
    assert.equal(await cdp.evaluate("document.documentElement.lang"), "en");
    assert.equal(await cdp.evaluate("document.getElementById('setting-language').value"), "en");
    if (!restrictedBrowser) assert.equal(await cdp.evaluate("JSON.parse(localStorage.getItem('f1-start-timer:settings')).language"), "en");
    await cdp.evaluate("document.getElementById('extras').open = false");

    // Only a Tab navigation into the game may show the subtle underline.
    // FocusEvent simulates Tab's focus transition in restricted headless Chrome.
    await cdp.evaluate(`(() => {
      const game = document.getElementById('game-control');
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true}));
      game.dispatchEvent(new FocusEvent('focus'));
      document.dispatchEvent(new KeyboardEvent('keyup', {key:'Tab', bubbles:true}));
    })()`);
    assert.equal(await cdp.evaluate("document.getElementById('game-control').classList.contains('tab-navigation')"), true,
      "Tab navigation should enable the subtle focus hint");
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('instructions')).textDecorationLine"), "underline",
      "Tab-focused game should underline the instructions");
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('instructions')).textDecorationLine"), "none",
      "Any other keyboard command must clear the Tab-only underline");
    await cdp.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true}));
      document.getElementById('game-control').dispatchEvent(new FocusEvent('focus'));
      document.getElementById('extras').dispatchEvent(new PointerEvent('pointerdown', {button:0,isPrimary:true,bubbles:true}));
    })()`);
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('instructions')).textDecorationLine"), "none",
      "Pointer interaction must clear the hint without starting a game");
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new FocusEvent('blur'))");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').classList.contains('tab-navigation')"), false,
      "Focus hint must clear on blur");

    // Opening settings must abort an ongoing round rather than allowing the
    // hidden countdown to continue or recording an accidental false start.
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 2);
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open && document.activeElement?.id === 'close-settings'");
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "INTERRUPTED");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on, .light.green').length"), 0);
    await sleep(1200);
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "INTERRUPTED", "Settings must cancel queued light timers");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 0);
    assert.equal(await cdp.evaluate("document.getElementById('export-results').disabled"), true, "An interrupted attempt must not be saved");
    await cdp.evaluate("document.getElementById('close-settings').click()");
    await cdp.until("!document.getElementById('extras').open && document.activeElement?.id === 'game-control'");
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "INTERRUPTED", "Dismissal must not resume the game");

    // Keyboard + pointer interactions at 320px, false start and full round.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile horizontal overflow");
    await cdp.evaluate("document.getElementById('game-control').focus(); document.getElementById('game-control').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));");
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('game-control')).outlineStyle"), "none", "Keyboard input must not draw a blue frame around the game");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 2);
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new KeyboardEvent('keydown', {key:' ', bubbles:true}));");
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "JUMP START!");
    assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Jump-start message overflows mobile screen");
    // Enable the opt-in GO indicator via the same checkbox users click.
    await cdp.evaluate(`(() => {
      const green = document.getElementById('setting-green-lights');
      green.checked = true;
      green.dispatchEvent(new Event('change', { bubbles: true }));
      const live = document.getElementById('setting-live-timer');
      live.checked = true;
      live.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    assert.equal(await cdp.evaluate("document.getElementById('setting-green-lights').checked"), true);
    assert.equal(await cdp.evaluate("document.getElementById('setting-live-timer').checked"), true);
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown', {button:0, isPrimary:true, bubbles:true}));");
    await cdp.until("document.querySelectorAll('.light.on').length === 10", 5500);
    await cdp.until("document.getElementById('game-control').getAttribute('aria-label') === 'Stop the reaction time clock'", 3500);
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.green').length"), 10, "Only upper two rows illuminate green at GO");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 0, "Red lights are off at GO");
    await sleep(120);
    const inProgress = await cdp.evaluate("document.getElementById('result').textContent");
    assert.match(inProgress, /^\d{2}\.\d{3}$/);
    assert.notEqual(inProgress, "00.000", "Live timer should count up after lights-out");
    await cdp.evaluate(`(() => {
      globalThis.__liveDomWrites = 0;
      globalThis.__liveObserver = new MutationObserver((mutations) => { globalThis.__liveDomWrites += mutations.length; });
      globalThis.__liveObserver.observe(document.getElementById('result'), { childList:true, characterData:true, subtree:true });
    })()`);
    await sleep(430);
    const writes = await cdp.evaluate("globalThis.__liveObserver.disconnect(); globalThis.__liveDomWrites");
    assert.ok(writes >= 2 && writes <= 14, `Mobile-friendly live readout should paint ~20fps, got ${writes} DOM writes in 430ms`);
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown', {button:0, isPrimary:true, bubbles:true}));");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.green').length"), 0, "Green lights switch off after reaction");
    const score = await cdp.evaluate("document.getElementById('result').textContent");
    assert.match(score, /^\d{2}\.\d{3}$/);
    await sleep(55);
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), score,
      "Live timer should freeze at the final measured result");
    assert.notEqual(await cdp.evaluate("document.getElementById('best').textContent"), "Your best: —");
    // Results are rendered lazily while the modal is closed to spare mobile CPUs.
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open && document.activeElement?.id === 'close-settings'");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').inert"), true,
      "An open modal must hide background gameplay from the accessibility tree");
    assert.equal(await cdp.evaluate("document.getElementById('training-launch').inert"), true);
    assert.equal(await cdp.evaluate("document.querySelector('#extras summary').tabIndex"), -1);
    assert.match(await cdp.evaluate("document.getElementById('announcement').textContent"), /Reaction time \d/);
    assert.match(await cdp.evaluate("document.getElementById('history-chart-summary').textContent"), /milliseconds/);
    // The history panel must reflect actual completed rounds without demo data.
    assert.equal(await cdp.evaluate("document.getElementById('trials-stat').textContent"), "1");
    assert.equal(await cdp.evaluate("document.querySelectorAll('#attempt-list .history-attempt').length"), 1);
    assert.equal(await cdp.evaluate("document.getElementById('export-history').disabled"), false);
    assert.equal(await cdp.evaluate("document.querySelectorAll('#history-chart circle').length"), 1);
    assert.equal(await cdp.evaluate("document.querySelectorAll('.history-session-heading').length"), 1);
    assert.equal(await cdp.evaluate("document.getElementById('session-count').textContent"), "1 session");
    assert.equal(await cdp.evaluate("document.getElementById('consistency-stat').textContent.trim()"), "0 ms");
    assert.equal(await cdp.evaluate("document.getElementById('median-stat').textContent"),
      await cdp.evaluate("document.getElementById('avg-stat').textContent"));
    await cdp.evaluate(`(() => {
      const select = document.getElementById('history-period');
      select.value = 'session'; select.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    assert.equal(await cdp.evaluate("document.getElementById('trials-stat').textContent"), "1");
    await cdp.evaluate(`(() => {
      const select = document.getElementById('history-period');
      select.value = '7d'; select.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    assert.equal(await cdp.evaluate("document.getElementById('trials-stat').textContent"), "1");
    assert.equal(await cdp.evaluate("document.getElementById('tab-history').getAttribute('aria-selected')"), "true");
    await cdp.evaluate("document.getElementById('tab-preferences').click()");
    assert.equal(await cdp.evaluate("document.getElementById('panel-history').hidden"), true);
    assert.equal(await cdp.evaluate("document.getElementById('panel-preferences').hidden"), false);
    await cdp.evaluate("document.getElementById('tab-history').click()");
    // The select controls use a shared, locally bundled Bootstrap chevron.
    for (const id of ["setting-scale", "setting-language", "history-filter", "history-period"]) {
      const selector = await cdp.evaluate(`(() => {
        const styles = getComputedStyle(document.getElementById(${JSON.stringify(id)}));
        return { appearance: styles.appearance, image: styles.backgroundImage,
          paddingRight: parseFloat(styles.paddingRight) };
      })()`);
      assert.equal(selector.appearance, "none", `${id}: native arrow should be hidden`);
      assert.match(selector.image, /chevron-down\.svg/, `${id}: Bootstrap icon must be used`);
      assert.ok(selector.paddingRight >= 30, `${id}: arrow must have enough breathing room`);
    }
    // Backup UI accepts a real browser File, validates it and asks for confirmation.
    assert.equal(await cdp.evaluate("document.getElementById('export-backup').disabled"), false);
    await cdp.evaluate(`(() => {
      const text = F1StartTimerBackup.create([{at:new Date().toISOString(),ms:215}], []);
      globalThis.__testBackup = text;
      const input = document.getElementById('backup-file');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'test-backup.json', {type:'application/json'}));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await cdp.until("!document.getElementById('backup-confirm').hidden");
    assert.match(await cdp.evaluate("document.getElementById('backup-confirm-description').textContent"), /1 reactions and 0 training sessions/);
    await cdp.evaluate("document.getElementById('cancel-backup').click()");
    assert.equal(await cdp.evaluate("document.getElementById('backup-confirm').hidden"), true);
    if (!restrictedBrowser) {
    await cdp.evaluate(`(() => {
      const input = document.getElementById('backup-file');
      const transfer = new DataTransfer();
      transfer.items.add(new File([globalThis.__testBackup], 'test-backup.json', {type:'application/json'}));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await cdp.until("!document.getElementById('backup-confirm').hidden");
    await cdp.evaluate("document.getElementById('confirm-backup').click()");
    assert.equal(await cdp.evaluate("document.getElementById('trials-stat').textContent"), "1");
    assert.match(await cdp.evaluate("document.getElementById('extras-status').textContent"), /Restored 1 reactions and 0 training sessions/);
    }
    await cdp.evaluate("document.getElementById('clear-history').click()");
    assert.equal(await cdp.evaluate("document.getElementById('history-confirm').hidden"), false);
    // Regression: the generic button hover must not wash out the red text/button.
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('confirm-clear')).backgroundColor"), "rgb(210, 11, 6)");
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const dom = await cdp.send("DOM.getDocument");
    const danger = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: "#confirm-clear" });
    await cdp.send("CSS.forcePseudoState", { nodeId: danger.nodeId, forcedPseudoClasses: ["hover"] });
    await sleep(200);
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('confirm-clear')).backgroundColor"), "rgb(170, 9, 4)");
    assert.equal(await cdp.evaluate("getComputedStyle(document.getElementById('confirm-clear')).color"), "rgb(255, 255, 255)");
    await cdp.send("CSS.forcePseudoState", { nodeId: danger.nodeId, forcedPseudoClasses: [] });
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    assert.equal(await cdp.evaluate("document.getElementById('history-confirm').hidden"), true);
    assert.equal(await cdp.evaluate("document.getElementById('extras').open"), true);
    // Export feedback is temporary, not a permanent label at the modal bottom.
    await cdp.evaluate("document.getElementById('export-history').click()");
    assert.match(await cdp.evaluate("document.getElementById('extras-status').textContent"), /Exported 1 result as CSV/);
    await cdp.until("document.getElementById('extras-status').textContent === ''", 5500);
    await cdp.evaluate("document.getElementById('export-history').click()");
    assert.match(await cdp.evaluate("document.getElementById('extras-status').textContent"), /Exported 1 result as CSV/);
    await cdp.evaluate("document.getElementById('close-settings').click()");
    await cdp.until("!document.getElementById('extras').open");
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open");
    assert.equal(await cdp.evaluate("document.getElementById('extras-status').textContent"), "", "Reopening must not show stale notifications");
    await cdp.evaluate("document.getElementById('close-settings').click()");
    await cdp.until("!document.getElementById('extras').open");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').inert"), false);
    assert.equal(await cdp.evaluate("document.querySelector('#extras summary').tabIndex"), 0);
    assert.equal(await cdp.evaluate("document.getElementById('copy-result').disabled"), false);
    assert.equal(await cdp.evaluate("document.getElementById('share-result').disabled"), false);
    assert.equal(await cdp.evaluate("document.getElementById('export-results').disabled"), false);
    if (!restrictedBrowser) assert.match(await cdp.evaluate("localStorage.getItem('f1-start-timer:history')"), /at|ms/);
    await cdp.evaluate(`(() => {
      Object.defineProperty(navigator, 'share', {
        configurable:true, value: async (data) => { globalThis.__sharedResult = data; },
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable:true, value: { writeText: async (value) => { globalThis.__copiedResult = value; } },
      });
      document.getElementById('share-result').click();
      document.getElementById('copy-result').click();
    })()`);
    await cdp.until("typeof globalThis.__sharedResult?.text === 'string' && typeof globalThis.__copiedResult === 'string'");
    assert.match(await cdp.evaluate("globalThis.__sharedResult.text"), /My F1 Start Timer reaction:/);
    assert.equal(await cdp.evaluate("globalThis.__sharedResult.text === globalThis.__copiedResult"), true);
    // A completed time and copy/share payload must translate without resetting the record.
    const resultBeforeTranslation = await cdp.evaluate("document.getElementById('result').textContent");
    await cdp.evaluate(`(() => {
      const lang = document.getElementById('setting-language');
      lang.value = 'fr';
      lang.dispatchEvent(new Event('change', {bubbles: true}));
      document.getElementById('share-result').click();
    })()`);
    await cdp.until("globalThis.__sharedResult?.text?.startsWith('Mon temps de réaction')");
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), resultBeforeTranslation);
    assert.match(await cdp.evaluate("document.getElementById('best').textContent"), /^Votre record/);
    assert.equal(await cdp.evaluate("document.documentElement.lang"), "fr");
    await cdp.evaluate(`(() => {
      const lang = document.getElementById('setting-language');
      lang.value = 'en';
      lang.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await cdp.evaluate("document.getElementById('export-results').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
    assert.equal(await cdp.evaluate("document.getElementById('game-control').getAttribute('aria-label')"), "Start another test", "Export control must not start another round");

    // v1.5: Training is a distinct dialog, never another Settings tab.
    await cdp.evaluate("document.getElementById('training-launch').click()");
    await cdp.until("!document.getElementById('training-dialog').hidden");
    assert.equal(await cdp.evaluate("document.getElementById('tab-training')"), null);
    assert.equal(await cdp.evaluate("document.getElementById('training-dialog').getAttribute('aria-modal')"), "true");
    assert.equal(await cdp.evaluate("document.getElementById('app').inert"), true,
      "Training dialog should isolate main content from screen readers");
    assert.equal(await cdp.evaluate("document.getElementById('setting-volume').value"), "75");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    assert.ok(await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
    await cdp.evaluate("document.querySelector('.training-mode[data-count=\"5\"]').click()");
    await cdp.evaluate("document.getElementById('training-start').click()");
    assert.equal(await cdp.evaluate("document.getElementById('training-banner').hidden"), false);
    assert.equal(await cdp.evaluate("document.getElementById('app').inert"), false);
    assert.equal(await cdp.evaluate("document.getElementById('training-progressbar').getAttribute('aria-valuemax')"), "5");
    assert.equal(await cdp.evaluate("document.getElementById('training-progressbar').getAttribute('aria-valuenow')"), "0");
    assert.equal(await cdp.evaluate("document.getElementById('training-dialog').hidden"), true);
    assert.equal(await cdp.evaluate("document.activeElement?.id"), "game-control");
    // Opening settings during training cancels only the current light sequence;
    // the training session stays active and does not gain a false start.
    await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 2);
    await cdp.evaluate("document.querySelector('#extras summary').click()");
    await cdp.until("document.getElementById('extras').open");
    assert.equal(await cdp.evaluate("document.getElementById('result').textContent"), "INTERRUPTED");
    assert.match(await cdp.evaluate("document.getElementById('training-banner-progress').textContent"), /0 of 5/);
    await cdp.evaluate("document.getElementById('close-settings').click()");
    await cdp.until("!document.getElementById('extras').open");
    // Five immediate false starts are counted, even though they are not in reaction history.
    for (let i = 0; i < 5; i++) {
      await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
      await cdp.evaluate("document.getElementById('game-control').dispatchEvent(new PointerEvent('pointerdown',{button:0,isPrimary:true,bubbles:true}))");
    }
    await cdp.until("!document.getElementById('training-dialog').hidden", 4000);
    assert.equal(await cdp.evaluate("document.getElementById('app').inert"), true);
    assert.equal(await cdp.evaluate("document.getElementById('training-progressbar').getAttribute('aria-valuenow')"), "5");
    assert.equal(await cdp.evaluate("document.getElementById('training-summary').hidden"), false);
    assert.match(await cdp.evaluate("document.getElementById('training-summary-false').textContent"), /5 \(100%\)/);
    if (!restrictedBrowser) assert.equal(await cdp.evaluate("JSON.parse(localStorage.getItem('f1-start-timer:training-sessions')).length"), 1);
    await cdp.evaluate("document.getElementById('training-close').click()");
    assert.equal(await cdp.evaluate("document.getElementById('app').inert"), false);
    assert.equal(await cdp.evaluate("document.activeElement?.id"), "game-control");
    assert.equal(await cdp.evaluate("document.getElementById('extras').open"), false);
    // Regression: Space after dismissing a dialog must start the game, not reopen Settings.
    await cdp.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))");
    assert.equal(await cdp.evaluate("document.getElementById('extras').open"), false);
    assert.equal(await cdp.evaluate("document.querySelectorAll('.light.on').length"), 2);
    await cdp.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))");
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
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill("SIGTERM");
      await Promise.race([exited, sleep(1500)]);
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}
await run();
