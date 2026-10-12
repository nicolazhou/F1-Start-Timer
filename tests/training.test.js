import assert from "node:assert/strict";
import test from "node:test";
import "../src/training.js";
import "../src/options.js";
const training = globalThis.F1StartTimerTraining;
const options = globalThis.F1StartTimerOptions;
const makeStore = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), data };
};
const at = "2026-10-12T12:00:00.000Z";

test("training mode supports only 5, 10 or 20 attempts and counts false starts", () => {
  assert.throws(() => training.newSession(12, at), RangeError);
  let session = training.newSession(5, at);
  for (const ms of [220, null, 240, 200, 220]) session = training.addAttempt(session, ms, at);
  assert.equal(session.attempts.length, 5);
  assert.equal(training.addAttempt(session, 230, at), null, "cannot exceed goal");
  const stats = training.statsFor(session);
  assert.equal(stats.completed, 5);
  assert.equal(stats.valid, 4);
  assert.equal(stats.falseStarts, 1);
  assert.equal(stats.falseStartPercent, 20);
  assert.equal(stats.bestMs, 200);
  assert.equal(stats.averageMs, 220);
  assert.equal(stats.consistency, 94);
});

test("no valid results or only one valid result yields no consistency score", () => {
  const start = training.newSession(5, at);
  assert.equal(training.statsFor(start).consistency, null);
  const early = training.addAttempt(start, null, at);
  assert.equal(training.statsFor(early).averageMs, null);
  assert.equal(training.statsFor(training.addAttempt(early, 220, at)).consistency, null);
});

test("training sessions are stored independently, capped at 30 and do not change CSV", () => {
  const storage = makeStore();
  let session = training.newSession(5, at);
  session = training.addAttempt(session, 220, at);
  assert.equal(training.saveSession({ ...session, endedAt: at }, storage), true);
  assert.equal(training.loadSessions(storage).length, 1);
  assert.equal(options.csvForHistory([{ at, ms: 220 }]), `timestamp_utc,reaction_ms,reaction_seconds\r\n${at},220,0.220\r\n`);
  assert.equal(storage.getItem(options.HISTORY_KEY), null);
  for (let i = 0; i < 35; i++) training.saveSession({ ...session, endedAt: at }, storage);
  assert.equal(training.loadSessions(storage).length, 30);
});

test("unfinished training resumes in tab storage and is removed upon completion", () => {
  const storage = makeStore();
  const start = training.addAttempt(training.newSession(10, at), null, at);
  assert.equal(training.persistActive(start, storage), true);
  assert.deepEqual(training.loadActive(storage), start);
  training.persistActive(null, storage);
  assert.equal(training.loadActive(storage), null);
});

test("training rejects malformed session data and handles blocked storage", () => {
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.deepEqual(training.loadSessions(blocked), []);
  assert.equal(training.loadActive(blocked), null);
  assert.equal(training.persistActive(null, blocked), false);
  assert.equal(training.saveSession({ ...training.addAttempt(training.newSession(5, at), 210, at), endedAt: at }, blocked), false);
  assert.equal(training.addAttempt(training.newSession(5, at), -10, at), null);
  assert.equal(training.normalizeSession({ startedAt: at, target: 5, attempts: [{ at, ms: "=CMD()" }] }), null);
});

test("sound is off by default, and volume is validated and persisted", () => {
  const settings = options.normalizeSettings({});
  assert.equal(settings.sound, false);
  assert.equal(settings.soundVolume, 75);
  assert.equal(options.normalizeSettings({ soundVolume: 135 }).soundVolume, 100);
  assert.equal(options.normalizeSettings({ soundVolume: -7 }).soundVolume, 0);
  assert.equal(options.normalizeSettings({ soundVolume: "loud" }).soundVolume, 75);
  const store = makeStore();
  assert.equal(options.saveSettings({ ...settings, soundVolume: 90 }, store), true);
  assert.equal(options.loadSettings(store).soundVolume, 90);
});
