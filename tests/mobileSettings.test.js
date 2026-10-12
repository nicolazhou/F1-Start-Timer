import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync("src/style.css", "utf8");
const history = readFileSync("src/history.js", "utf8");
const main = readFileSync("src/main.js", "utf8");

test("mobile settings: independent scrolling, fixed tabs and safe areas", () => {
  const mobile = css.slice(css.indexOf("/* v1.7.4 — touch-first Settings bottom sheet."));
  assert.ok(mobile.startsWith("/* v1.7.4"));
  assert.match(mobile, /@media \(max-width: 600px\)/);
  assert.match(mobile, /height: min\(92dvh, 820px\)/);
  assert.match(mobile, /env\(safe-area-inset-bottom/);
  assert.match(mobile, /\.settings-body \{[\s\S]*?overflow-y: auto/);
  assert.match(mobile, /\.settings-head \{[\s\S]*?flex: 0 0 auto/);
  assert.match(mobile, /#panel-preferences \.setting-select \{[\s\S]*?flex-direction: column/);
  assert.match(mobile, /#panel-preferences \.setting-select select,[\s\S]*?font-size: 16px/);
  assert.match(mobile, /#panel-preferences \.result-actions \{[\s\S]*?display: grid/);
  assert.match(history, /querySelector\("\.settings-body"\)\.scrollTop = 0/);
  assert.match(main, /mobileSettingsBody\.scrollTop = 0/);
});
