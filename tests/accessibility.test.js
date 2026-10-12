import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/style.css", "utf8");
const main = readFileSync("src/main.js", "utf8");
const history = readFileSync("src/history.js", "utf8");
const training = readFileSync("src/training-ui.js", "utf8");

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrastRatio(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("audit: text foregrounds and danger button pass 4.5:1 on their backgrounds", () => {
  assert.match(css, /history-explainer, \.history-sessions,[\s\S]*?color: #555d66;/);
  for (const [foreground, background, purpose] of [
    ["555d66", "ffffff", "small text"],
    ["555d66", "fdfdfd", "stat cards"],
    ["ffffff", "e10600", "brand buttons"],
    ["ffffff", "d20b06", "delete button"],
    ["ffffff", "aa0904", "delete button hover"],
  ]) {
    assert.ok(contrastRatio(foreground, background) >= 4.5, purpose);
  }
});

test("audit: all static ARIA ID references resolve to real HTML nodes", () => {
  const ids = new Set([...html.matchAll(/\bid="([a-z0-9-]+)"/g)].map((match) => match[1]));
  for (const [, attribute, raw] of html.matchAll(/\b(aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of raw.split(/\s+/)) {
      assert.ok(ids.has(id), `${attribute} points to missing #${id}`);
    }
  }
});

test("audit: results and charts are described without flooding screen readers", () => {
  const buttonEnd = html.indexOf('id="game-control"');
  const announcement = html.indexOf('id="announcement"');
  const credits = html.indexOf('id="credits"');
  assert.ok(announcement > buttonEnd && announcement < credits);
  assert.match(html, /id="announcement" role="status" aria-live="polite"/);
  assert.match(html, /id="result" aria-live="off"/);
  for (const name of ["history", "training"]) {
    assert.match(html, new RegExp(`id="${name}-chart"[^>]*aria-describedby="${name}-chart-summary"`));
    assert.match(html, new RegExp(`id="${name}-chart-summary" class="visually-hidden"`));
  }
  assert.match(history, /chartA11yValues/);
  assert.match(training, /trainingChartValues/);
  assert.match(main, /time: formatTime\(next\.resultMs\)/);
});

test("audit: modal backgrounds are inert and keyboard/touch affordances are visible", () => {
  assert.match(main, /element\.inert = settingsDetails\.open/);
  assert.match(main, /settingsTrigger\.tabIndex = settingsDetails\.open \? -1 : 0/);
  assert.match(training, /\$\("app"\)\.inert = true/);
  assert.match(training, /\$\("app"\)\.inert = false/);
  assert.match(html, /id="training-progressbar" role="progressbar"/);
  assert.match(training, /progress\.setAttribute\("aria-valuenow", String\(done\)\)/);
  assert.match(css, /#game-control\.tab-navigation \.help p[\s\S]*?outline: 2px solid #1457b8/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?min-height: 44px/);
});

test("audit: live timer screen painting is throttled, final result remains independent", () => {
  assert.match(main, /const LIVE_PAINT_INTERVAL_MS = 40/);
  assert.match(main, /liveTimerDelay = setTimeout/);
  assert.match(main, /const display = formatTime\(elapsed\)/);
  assert.match(main, /next\.phase === PHASE\.RESULT\) score\.textContent = formatTime\(next\.resultMs\)/);
});
