import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import "../src/game.js";
const { formatTime } = globalThis.F1StartTimerGame;
const source = readFileSync("src/result-card.js", "utf8");
function createCardTest() {
  const draws = [];
  let imageType;
  const ctx = {
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect(...args) { draws.push(["rect", ...args]); },
    fillText(...args) { draws.push(["text", ...args]); },
    save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {},
    lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, arc() {},
  };
  const document = { createElement(name) {
    assert.equal(name, "canvas");
    return { width: 0, height: 0, getContext: (contextName) => contextName === "2d" ? ctx : null,
      toDataURL(type) { imageType = type; return "data:image/png;base64,aGVsbG8="; } };
  } };
  const sandbox = { globalThis: {}, document, File: class {
    constructor(parts, name, opts) { this.name = name; this.type = opts.type; this.size = parts[0].length; }
  }, Uint8Array, atob, Date, Math };
  runInNewContext(source, sandbox);
  return { api: sandbox.globalThis.F1StartTimerCard, draws, imageType: () => imageType };
}
test("result card renders a 1200x630 PNG with the current reaction and best", () => {
  const { api, draws, imageType } = createCardTest();
  const image = api.createCard({ ms: 245, bestMs: 220, formatTime, label: "Reaction time", bestLabel: "Personal best" });
  assert.ok(image.startsWith("data:image/png;base64,"));
  assert.equal(imageType(), "image/png");
  assert.equal(api.WIDTH, 1200);
  assert.equal(api.HEIGHT, 630);
  const text = draws.filter((d) => d[0] === "text").map((d) => d[1]);
  assert.ok(text.includes("00.245 s"));
  assert.ok(text.includes("00.220 s"));
  assert.ok(text.includes("F1 START TIMER"));
  const file = api.toFile(image, "reaction.png");
  assert.equal(file.name, "reaction.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 5);
  assert.throws(() => api.toFile("javascript:alert(1)", "x.png"), /Expected a PNG/);
  assert.throws(() => api.createCard({ ms: -1, formatTime }), /Invalid card time/);
});
