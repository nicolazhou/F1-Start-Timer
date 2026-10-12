import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import "../src/game.js";
import "../src/options.js";

const { PHASE, isValidRecord } = globalThis.F1StartTimerGame;

function createUI() {
  const saved = [];
  let publish;
  const makeElement = () => {
    const listeners = new Map();
    return { textContent: "", checked: false, value: "100", disabled: false,
      setAttribute() {}, addEventListener(type, callback) { listeners.set(type, callback); },
      fire(type) { listeners.get(type)?.(); } };
  };
  const root = makeElement();
  const bulbs = Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => {
    const classes = new Set();
    return { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) } };
  }));
  root.querySelectorAll = () => bulbs.map((lights) => ({ querySelectorAll: () => lights }));
  const elements = new Map([
    ["game-control", root],
    ["result", makeElement()],
    ["best", makeElement()],
    ["lights-container", makeElement()],
    ["announcement", makeElement()],
    ["credits", { hidden: true }],
    ["creator-link", makeElement()],
    ["extras-status", makeElement()],
    ["close-settings", makeElement()],
    ["settings-backdrop", makeElement()],
    ["setting-sound", makeElement()],
    ["setting-contrast", makeElement()],
    ["setting-motion", makeElement()],
    ["setting-green-lights", makeElement()],
    ["setting-scale", makeElement()],
    ["setting-language", makeElement()],
    ["copy-result", makeElement()],
    ["share-result", makeElement()],
    ["export-results", makeElement()],
  ]);
  const details = makeElement();
  const summary = makeElement();
  const panel = makeElement();
  details.querySelector = (selector) => selector === "summary" ? summary : panel;
  panel.querySelectorAll = () => [];
  panel.contains = () => false;
  elements.set("extras", details);
  const context = {
    globalThis: {
      F1StartTimerOptions: {
        ...globalThis.F1StartTimerOptions,
        loadSettings: () => ({ sound: false, highContrast: false, reduceMotion: false, textScale: 100 }),
        loadHistory: () => [],
        recordAttempt: (history, ms) => [{ at: "2026-10-11T12:00:00.000Z", ms }, ...history],
      },
      F1StartTimerGame: {
        ...globalThis.F1StartTimerGame,
        loadBest: () => null,
        saveBest: (time) => { saved.push(time); return true; },
        createReactionGame({ onChange }) {
          publish = onChange;
          return { activate() {}, interrupt() {} };
        },
      },
    },
    location: { hostname: "localhost" },
    navigator: { language: "en-US", languages: ["en-US"] },
    document: {
      getElementById: (id) => elements.get(id),
      querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
      documentElement: { dataset: {}, lang: "en", classList: { toggle() {} } },
    },
    window: { addEventListener() {} },
    console,
  };
  runInNewContext(readFileSync("src/i18n.js", "utf8"), context);
  runInNewContext(readFileSync("src/main.js", "utf8"), context);
  const result = (time) => publish({ phase: PHASE.RESULT, litCount: 0, resultMs: time });
  return { result, elements, saved, bulbs,
    phase: (phase, litCount = 0) => publish({ phase, litCount, resultMs: null }),
  };
}

test("invalid low reaction cannot poison the personal best", () => {
  const ui = createUI();
  ui.result(0.1);
  assert.equal(ui.elements.get("result").textContent, "00.000", "extreme round is still shown");
  assert.equal(ui.elements.get("best").textContent, "Your best: —");
  assert.deepEqual(ui.saved, []);
  ui.result(235);
  assert.equal(ui.elements.get("best").textContent, "Your best: 00.235");
  assert.deepEqual(ui.saved, [235]);
});

test("out-of-range high reaction never becomes a record", () => {
  const ui = createUI();
  ui.result(60001);
  assert.equal(ui.elements.get("best").textContent, "Your best: —");
  assert.deepEqual(ui.saved, []);
  ui.result(342);
  ui.result(70000);
  assert.equal(ui.elements.get("best").textContent, "Your best: 00.342");
  assert.deepEqual(ui.saved, [342]);
});

test("record eligibility is numeric and includes boundary values", () => {
  for (const valid of [0.5, 200, 60000]) assert.equal(isValidRecord(valid), true);
  for (const invalid of [0, 0.4999, -1, 60000.001, NaN, Infinity, "200", null]) {
    assert.equal(isValidRecord(invalid), false, `Should reject ${invalid}`);
  }
});


test("optional green lights use only upper rows during the GO window", () => {
  const ui = createUI();
  ui.phase(PHASE.LIGHTING, 5);
  assert.equal(ui.bulbs.flat().filter((bulb) => bulb.classList.contains("on")).length, 10);
  ui.phase(PHASE.READY);
  assert.equal(ui.bulbs.flat().filter((bulb) => bulb.classList.contains("green")).length, 0,
    "existing users should see the classic unlit GO signal");
  const control = ui.elements.get("setting-green-lights");
  control.checked = true;
  control.fire("change");
  assert.equal(ui.bulbs.flat().filter((bulb) => bulb.classList.contains("green")).length, 10);
  assert.equal(ui.bulbs.flat().filter((bulb) => bulb.classList.contains("on")).length, 0);
  for (const column of ui.bulbs) {
    assert.ok(column[0].classList.contains("green") && column[1].classList.contains("green"));
    assert.ok(!column[2].classList.contains("green") && !column[3].classList.contains("green"));
  }
  ui.result(250);
  assert.equal(ui.bulbs.flat().filter((bulb) => bulb.classList.contains("green")).length, 0,
    "green lights turn off after the player reacts");
  ui.phase(PHASE.FALSE_START);
  assert.equal(ui.bulbs.flat().filter((bulb) => bulb.classList.contains("green")).length, 0);
});
