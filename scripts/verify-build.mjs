import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_FILES } from "./site-files.mjs";

const html = readFileSync("dist/index.html", "utf8");
const urls = [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map((match) => match[1]);
for (const url of urls) {
  const path = url.slice(2);
  assert.ok(SITE_FILES.has(path), `Unexpected HTML asset: ${url}`);
  assert.ok(existsSync(resolve("dist", path)), `Missing deployed asset: ${url}`);
}
for (const path of SITE_FILES.keys()) {
  assert.ok(existsSync(resolve("dist", path)), `Missing published file: ${path}`);
}
// CSS background icons are relative to the CSS file, not the HTML base URL.
const css = readFileSync("dist/src/style.css", "utf8");
for (const [, iconPath] of css.matchAll(/url\(["']?(\.\.\/public\/icons\/[\w-]+\.svg)["']?\)/g)) {
  assert.ok(existsSync(resolve("dist/src", iconPath)), `Missing CSS background icon: ${iconPath}`);
}
assert.ok(existsSync("dist/.nojekyll"), "GitHub Pages .nojekyll marker missing");
assert.doesNotMatch(html, /%BASE_URL%|startup-diagnostic|src="\/src\//);
const published = [];
function walk(dir, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${path}/`);
    else published.push(path);
  }
}
walk("dist");
assert.deepEqual(published.sort(), [...SITE_FILES.keys(), ".nojekyll"].sort(), "Unexpected file in deploy");
console.log(`Verified ${urls.length} relative resources and ${published.length} deploy files.`);
