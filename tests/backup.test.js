import assert from "node:assert/strict";
import test from "node:test";
import "../src/options.js";
import "../src/training.js";
import "../src/backup.js";
import "../src/game.js";
const backup = globalThis.F1StartTimerBackup;
const options = globalThis.F1StartTimerOptions;
const training = globalThis.F1StartTimerTraining;
const { loadBest, saveBest } = globalThis.F1StartTimerGame;
const at = "2026-10-12T12:00:00.000Z";
const later = "2026-10-12T12:00:01.000Z";
const item = { at, ms: 215.1, sessionId: "s_test_123" };
const oldItem = { at: later, ms: 310 };
const session = { startedAt: at, endedAt: later, target: 5, attempts: [{ at, ms: 215.1 }, { at: later, ms: null }] };
const fixture = (history = [item, oldItem], trainingSessions = [session]) => ({
  format: backup.FORMAT, version: backup.VERSION, exportedAt: at, history, trainingSessions,
});
const mockStorage = (seed = {}) => {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem(key) { return items.get(key) ?? null; },
    setItem(key, value) { items.set(key, value); },
    removeItem(key) { items.delete(key); },
  };
};

test("JSON backup round-trips legacy attempts, session IDs, and training false starts", () => {
  const json = backup.create([item, oldItem], [session], at);
  const file = JSON.parse(json);
  assert.equal(file.format, "f1-start-timer-backup");
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file), ["format", "version", "exportedAt", "history", "trainingSessions"]);
  assert.deepEqual(backup.parse(json), { history: [item, oldItem], trainingSessions: [session] });
  assert.equal(file.history[1].sessionId, undefined);
  assert.equal(file.trainingSessions[0].attempts[1].ms, null);
});

test("JSON backup restore replaces only histories and leaves settings and personal best", () => {
  const storage = mockStorage();
  assert.ok(saveBest(190, storage));
  assert.ok(options.saveSettings({ sound: true, language: "it" }, storage));
  storage.setItem(options.HISTORY_KEY, JSON.stringify([{ at, ms: 800 }]));
  assert.equal(backup.restore(backup.parse(backup.create([item], [session], at)), storage), true);
  assert.deepEqual(options.loadHistory(storage), [item]);
  assert.deepEqual(training.loadSessions(storage), [session]);
  assert.equal(loadBest(storage), 190);
  assert.equal(options.loadSettings(storage).language, "it");
  assert.equal(options.loadSettings(storage).sound, true);
});

test("backup rejects malformed JSON, schema changes and any invalid record without modifying storage", () => {
  const badCases = [
    "not-json", "[]", JSON.stringify({ ...fixture(), version: 2 }),
    JSON.stringify({ ...fixture(), format: "another-app" }),
    JSON.stringify({ ...fixture(), history: "not-an-array" }),
    JSON.stringify({ ...fixture(), exportedAt: "invalid" }),
    JSON.stringify({ ...fixture(), history: [item, { at, ms: -3 }] }),
    JSON.stringify({ ...fixture(), trainingSessions: [{ ...session, attempts: [{ at, ms: -2 }] }] }),
    JSON.stringify({ ...fixture(), history: Array(51).fill(item) }),
    JSON.stringify({ ...fixture(), trainingSessions: Array(31).fill(session) }),
    JSON.stringify({ ...fixture(), trainingSessions: [{ ...session, endedAt: undefined }] }),
  ];
  const store = mockStorage({ [options.HISTORY_KEY]: JSON.stringify([oldItem]) });
  for (const text of badCases) {
    assert.throws(() => backup.parse(text), /invalid-backup/, text.slice(0, 65));
    assert.deepEqual(options.loadHistory(store), [oldItem]);
  }
  assert.throws(() => backup.parse(" ".repeat(backup.MAX_BYTES + 1)), /backup-too-large/);
});

test("backup rollback restores both previous values if the second storage write fails", () => {
  const existingHistory = JSON.stringify([oldItem]);
  const existingTraining = JSON.stringify([session]);
  const store = mockStorage({ [options.HISTORY_KEY]: existingHistory, [training.STORAGE_KEY]: existingTraining });
  const setter = store.setItem.bind(store);
  let failed = false;
  store.setItem = (key, value) => {
    if (key === training.STORAGE_KEY && !failed) { failed = true; throw new Error("quota exceeded"); }
    setter(key, value);
  };
  assert.equal(backup.restore({ history: [item], trainingSessions: [] }, store), false);
  assert.equal(store.getItem(options.HISTORY_KEY), existingHistory);
  assert.equal(store.getItem(training.STORAGE_KEY), existingTraining);
});

test("empty backup is valid and the export doesn't include preferences or personal best", () => {
  const json = backup.create([], [], at);
  assert.deepEqual(backup.parse(json), { history: [], trainingSessions: [] });
  assert.ok(!json.includes("soundVolume"));
  assert.ok(!json.includes('"best"'));
  const store = mockStorage({ [options.HISTORY_KEY]: JSON.stringify([oldItem]) });
  assert.equal(backup.restore(backup.parse(json), store), true);
  assert.deepEqual(options.loadHistory(store), []);
});
