import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Dependency-free project-specific lint: syntax, unsafe DOM APIs,
// formatting, valid static HTML references and accessible controls.
const scripts = [
  "src/game.js", "src/options.js", "src/main.js", "scripts/build.mjs", "scripts/site-files.mjs", "scripts/verify-build.mjs",
  "scripts/serve.mjs", "scripts/check-source.mjs", "scripts/browser-test.mjs",
  "tests/reactionGame.test.js", "tests/storage.test.js", "tests/server.test.js",
  "tests/uiRecord.test.js", "tests/options.test.js",
];
for (const script of scripts) {
  execFileSync(process.execPath, ["--check", script], { stdio: "pipe" });
  const source = readFileSync(script, "utf8");
  assert.ok(!/(?:^|\n)[^\n]*[ \t]+\r?\n/.test(source), `${script}: trailing whitespace`);
  assert.ok(!/\beval\s*\(|\bnew\s+Function\s*\(|\.innerHTML\s*=|document\.write\s*\(/.test(source),
    `${script}: disallowed dynamic code/HTML API`);
}
const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/style.css", "utf8");
const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, "Duplicate HTML IDs");
assert.equal((html.match(/<h1\b/g) || []).length, 1, "Exactly one H1 is required");
assert.doesNotMatch(html, /(?:href|src)="https?:\/\//, "Avoid external assets");
assert.doesNotMatch(css, /@import\b/i, "Avoid external stylesheets");
for (const [, id] of html.matchAll(/aria-describedby="([\w-]+)"/g)) {
  assert.ok(ids.includes(id), `Missing aria-describedby target: ${id}`);
}
console.log(`Lint passed: ${scripts.length} JS files and HTML/CSS invariants.`);
