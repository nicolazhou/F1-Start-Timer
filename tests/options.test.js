import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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
  assert.deepEqual(p.loadSettings(store()), { sound: false, highContrast: false, reduceMotion: false, greenLights: false, liveTimer: false, textScale: 100, language: "auto" });
  const bad = { sound: "yes", highContrast: true, reduceMotion: 1, textScale: 999 };
  assert.deepEqual(p.normalizeSettings(bad), { sound: false, highContrast: true, reduceMotion: false, greenLights: false, liveTimer: false, textScale: 100, language: "auto" });
});

test("settings round-trip and tolerate corrupted / blocked localStorage", () => {
  const storage = store();
  const settings = { sound: true, highContrast: true, reduceMotion: true, greenLights: true, liveTimer: true, textScale: 150, language: "fr" };
  assert.equal(p.saveSettings(settings, storage), true);
  assert.deepEqual(p.loadSettings(storage), settings);
  storage.values.set(p.SETTINGS_KEY, "{bad json");
  assert.equal(p.loadSettings(storage).sound, false);
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.equal(p.saveSettings(settings, blocked), false);
  assert.equal(p.loadSettings(blocked).textScale, 100);
  // Existing users keep the classic red-only look after upgrading.
  assert.equal(p.normalizeSettings({ sound: true, language: "it" }).greenLights, false);
  assert.equal(p.normalizeSettings({ sound: true, language: "it" }).liveTimer, false);
  assert.equal(p.normalizeSettings({ liveTimer: "yes" }).liveTimer, false);
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
  const csv = p.csvForHistory(history);
  assert.match(csv, /^timestamp_utc,reaction_ms,reaction_seconds\r\n/);
  assert.match(csv, /2026-10-11T15:00:00.000Z,250.4,0.250\r\n/);
  assert.doesNotMatch(csv, /eligible_for_best|,true|,false/);
  assert.doesNotMatch(csv, /formula|HYPERLINK/);
  assert.equal(p.loadHistory(store({ [p.HISTORY_KEY]: "not json" })).length, 0);
});

test("sharing uses formatted recent result and personal best", () => {
  assert.equal(p.shareText(235, 210, game.formatTime),
    "My F1 Start Timer reaction: 00.235 s. Personal best: 00.210 s.");
  assert.match(p.shareText(240, null, game.formatTime), /no personal best yet/);
});

test("history statistics use saved valid entries and clear leaves personal best untouched", () => {
  const initial = [
    { at: "2026-10-11T15:00:00.000Z", ms: 184 },
    { at: "2026-10-11T14:00:00.000Z", ms: 242 },
    { at: "2026-10-11T13:00:00.000Z", ms: 205 },
    { at: "invalid-date", ms: 20 },
  ];
  assert.deepEqual({ ...p.historyStats(initial), consistencyMs: 0 }, {
    count: 3, averageMs: (184 + 242 + 205) / 3, fastestMs: 184,
    medianMs: 205, slowestMs: 242, consistencyMs: 0, sessions: 0,
  });
  assert.ok(Math.abs(p.historyStats(initial).consistencyMs - 23.97684068) < 0.00001);
  const empty = { count: 0, averageMs: null, medianMs: null, slowestMs: null,
    fastestMs: null, consistencyMs: null, sessions: 0 };
  assert.deepEqual(p.historyStats([]), empty);
  assert.deepEqual(p.historyStats(null), empty);
  const storage = store({ [p.HISTORY_KEY]: JSON.stringify(initial), "f1-start-timer:best": "184" });
  assert.equal(p.clearHistory(storage), true);
  assert.deepEqual(p.loadHistory(storage), []);
  assert.equal(game.loadBest(storage), 184, "clearing history must never clear best time");
});

test("history clearing fails safely when storage is restricted", () => {
  assert.equal(p.clearHistory({ removeItem() { throw new Error("blocked"); } }), false);
});


test("v1.4 median, slowest and consistency are correct for even, odd and single samples", () => {
  const at = "2026-10-12T12:00:00.000Z";
  const history = [100, 200, 300, 400].map((ms) => ({ at, ms, sessionId: "test_a" }));
  const stats = p.historyStats(history);
  assert.equal(stats.count, 4);
  assert.equal(stats.medianMs, 250);
  assert.equal(stats.averageMs, 250);
  assert.equal(stats.fastestMs, 100);
  assert.equal(stats.slowestMs, 400);
  assert.ok(Math.abs(stats.consistencyMs - Math.sqrt(12500)) < 0.0000001);
  assert.equal(stats.sessions, 1);
  assert.equal(p.historyStats(history.slice(0, 3)).medianMs, 200);
  assert.equal(p.historyStats(history.slice(0, 1)).consistencyMs, 0);
});

test("v1.4 filtering uses the requested period and never mutates the source", () => {
  const now = Date.parse("2026-10-12T12:00:00.000Z");
  const make = (days, sessionId, ms) => ({ at: new Date(now - days * 86400000).toISOString(), ms, sessionId });
  const history = [make(0, "s_current", 150), make(6, "s_older", 210), make(20, "s_older", 240), make(45, "s_oldest", 300),
    { at: new Date(now - 2 * 86400000).toISOString(), ms: 330 }];
  assert.equal(p.filterHistory(history, "all", "s_current", now).length, 5);
  assert.deepEqual(p.filterHistory(history, "session", "s_current", now).map((entry) => entry.ms), [150]);
  assert.deepEqual(p.filterHistory(history, "7d", "s_current", now).map((entry) => entry.ms), [150, 210, 330]);
  assert.deepEqual(p.filterHistory(history, "30d", "s_current", now).map((entry) => entry.ms), [150, 210, 240, 330]);
  assert.equal(p.historyStats(history).sessions, 3, "unknown legacy sessions must not be counted");
  assert.equal(p.sessionFor(history[4]), "legacy");
  assert.equal(history.length, 5);
});

test("v1.4 records session metadata while preserving legacy storage and CSV format", () => {
  const storage = store({ [p.HISTORY_KEY]: JSON.stringify([
    { at: "2026-10-11T12:00:00.000Z", ms: 200 },
    { at: "2026-10-11T12:00:00.000Z", ms: 210, sessionId: "session-A" },
    { at: "2026-10-11T12:00:00.000Z", ms: 230, sessionId: "bad session!" },
  ]) });
  const initial = p.loadHistory(storage);
  assert.equal(initial.length, 2, "legacy rows kept, corrupt session ids rejected");
  assert.deepEqual(initial[0], { at: "2026-10-11T12:00:00.000Z", ms: 200 });
  const next = p.recordAttempt(initial, 190, "2026-10-12T12:00:00.000Z", storage, "session-B");
  assert.equal(next[0].sessionId, "session-B");
  assert.equal(p.historyStats(next).sessions, 2);
  assert.equal(p.filterHistory(p.loadHistory(storage), "session", "session-B").length, 1);
  const csv = p.csvForHistory(next);
  assert.equal(csv.split("\r\n")[0], "timestamp_utc,reaction_ms,reaction_seconds");
  assert.doesNotMatch(csv, /sessionId|eligible_for_best/);
});


test("v1.4 session id survives reload and gracefully degrades if storage is unavailable", () => {
  const file = readFileSync("src/options.js", "utf8");
  const sessionStorage = store();
  const page = () => {
    const context = { sessionStorage };
    runInNewContext(file, context);
    return context.F1StartTimerOptions;
  };
  const first = page().currentSessionId();
  assert.match(first, /^s_[a-z0-9]+_[a-z0-9]+$/);
  assert.equal(sessionStorage.getItem(p.SESSION_KEY), first);
  assert.equal(page().currentSessionId(), first, "page reload reuses the tab session");
  const blocked = { sessionStorage: { getItem() { throw Error("denied"); } } };
  runInNewContext(file, blocked);
  const fallback = blocked.F1StartTimerOptions.currentSessionId();
  assert.equal(blocked.F1StartTimerOptions.currentSessionId(), fallback);
});
