import assert from "node:assert/strict";
import test from "node:test";
import "../src/game.js";
const { formatTime, loadBest, saveBest } = globalThis.F1StartTimerGame;

function mockStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("old best is imported when the new key is missing", () => {
  const store = mockStorage({ best: "235.7" });
  assert.equal(loadBest(store), 235.7);
  assert.equal(saveBest(180.5, store), true);
  assert.equal(loadBest(store), 180.5);
  assert.equal(store.values.get("best"), "235.7");
  assert.equal(store.values.get("f1-start-timer:best"), "180.5");
});

test("corrupted, negative or zero scores are safely rejected", () => {
  for (const value of ["0", "-5", "NaN", "Infinity", "abc", "", " "]) {
    assert.equal(loadBest(mockStorage({ "f1-start-timer:best": value })), null);
  }
  assert.equal(loadBest(mockStorage()), null);
  assert.equal(saveBest(0, mockStorage()), false);
  assert.equal(saveBest(Infinity, mockStorage()), false);
  assert.equal(saveBest(0.00001, mockStorage()), false);
  assert.equal(saveBest(60_001, mockStorage()), false);
  assert.equal(saveBest(0.5, mockStorage()), true);
  assert.equal(saveBest("120", mockStorage()), false, "Storage API accepts only numeric reaction times");
});

test("invalid current record falls back to a valid older unprefixed record", () => {
  assert.equal(loadBest(mockStorage({ "f1-start-timer:best": "oops", best: "140" })), 140);
  assert.equal(loadBest(mockStorage({ "f1-start-timer:best": "0.00001", best: "150" })), 150);
  assert.equal(loadBest(mockStorage({ "f1-start-timer:best": "invalid", best: "225" })), 225);
});

test("restricted localStorage never crashes the app", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadBest(blocked), null);
  assert.equal(saveBest(152, blocked), false);
});

test("seconds format has consistent three-decimal precision", () => {
  assert.equal(formatTime(null), "—");
  assert.equal(formatTime(NaN), "—");
  assert.equal(formatTime(-5), "—");
  assert.equal(formatTime(0), "00.000");
  assert.equal(formatTime(250), "00.250");
  assert.equal(formatTime(350.5), "00.351");
  assert.equal(formatTime(1234.5), "01.235");
  assert.equal(formatTime(10000), "10.000");
});

