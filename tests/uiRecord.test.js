import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import "../src/game.js";

const { PHASE, isValidRecord } = globalThis.F1StartTimerGame;

function createUI() {
  const saved = [];
  let publish;
  const makeElement = () => ({ textContent: "", setAttribute() {}, addEventListener() {} });
  const root = makeElement();
  const bulbs = Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ({
    classList: { toggle() {} },
  })));
  root.querySelectorAll = () => bulbs.map((lights) => ({ querySelectorAll: () => lights }));
  const elements = new Map([
    ["game-control", root],
    ["result", makeElement()],
    ["best", makeElement()],
    ["lights-container", makeElement()],
    ["announcement", makeElement()],
    ["credits", { hidden: true }],
    ["creator-link", makeElement()],
  ]);
  const context = {
    globalThis: {
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
    document: { getElementById: (id) => elements.get(id), addEventListener() {} },
    window: { addEventListener() {} },
    console,
  };
  runInNewContext(readFileSync("src/main.js", "utf8"), context);
  const result = (time) => publish({ phase: PHASE.RESULT, litCount: 0, resultMs: time });
  return { result, elements, saved };
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
