import assert from "node:assert/strict";
import test from "node:test";
import "../src/options.js";
import "../src/game.js";
const p = globalThis.F1StartTimerOptions;
const game = globalThis.F1StartTimerGame;

function store(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("settings default to silent, classic styling and normal text", () => {
  assert.deepEqual(p.loadSettings(store()), { sound: false, highContrast: false, reduceMotion: false, textScale: 100 });
  const bad = { sound: "yes", highContrast: true, reduceMotion: 1, textScale: 999 };
  assert.deepEqual(p.normalizeSettings(bad), { sound: false, highContrast: true, reduceMotion: false, textScale: 100 });
});

test("settings round-trip and tolerate corrupted / blocked localStorage", () => {
  const storage = store();
  const settings = { sound: true, highContrast: true, reduceMotion: true, textScale: 150 };
  assert.equal(p.saveSettings(settings, storage), true);
  assert.deepEqual(p.loadSettings(storage), settings);
  storage.values.set(p.SETTINGS_KEY, "{bad json");
  assert.equal(p.loadSettings(storage).sound, false);
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.equal(p.saveSettings(settings, blocked), false);
  assert.equal(p.loadSettings(blocked).textScale, 100);
});

test("results persist newest-first and stay limited to 50 plausible entries", () => {
  const storage = store();
  let history = [];
  for (let i = 0; i < 80; i++) {
    history = p.recordAttempt(history, i + 100, "2026-10-11T15:00:00.000Z", storage);
  }
  assert.equal(history.length, 50);
  assert.equal(history[0].ms, 179);
  assert.equal(history[49].ms, 130);
  assert.deepEqual(p.loadHistory(storage), history);
  const unchanged = p.recordAttempt(history, Number.POSITIVE_INFINITY, undefined, storage);
  assert.deepEqual(unchanged, history);
});

test("malformed history entries cannot break startup or CSV export", () => {
  const storage = store({ [p.HISTORY_KEY]: JSON.stringify([
    { at: "2026-10-11T15:00:00.000Z", ms: 250.4 },
    { at: "formula,inject", ms: 120 },
    { at: "2026-10-11T15:00:00.000Z", ms: "=HYPERLINK" },
    null,
  ]) });
  const history = p.loadHistory(storage);
  assert.equal(history.length, 1);
  const csv = p.csvForHistory(history, game.isValidRecord);
  assert.match(csv, /^timestamp_utc,reaction_ms,reaction_seconds,eligible_for_best\r\n/);
  assert.match(csv, /2026-10-11T15:00:00.000Z,250.4,0.250,true/);
  assert.doesNotMatch(csv, /formula|HYPERLINK/);
  assert.equal(p.loadHistory(store({ [p.HISTORY_KEY]: "not json" })).length, 0);
});

test("sharing uses formatted recent result and personal best", () => {
  assert.equal(p.shareText(235, 210, game.formatTime),
    "My F1 Start Timer reaction: 00.235 s. Personal best: 00.210 s.");
  assert.match(p.shareText(240, null, game.formatTime), /no personal best yet/);
});
