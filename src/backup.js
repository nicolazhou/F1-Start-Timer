/* Portable reaction-history backup: schema validation and best-effort atomic restore. */
(function (root) {
  "use strict";
  const options = root.F1StartTimerOptions;
  const training = root.F1StartTimerTraining;
  const FORMAT = "f1-start-timer-backup";
  const VERSION = 1;
  const MAX_BYTES = 512 * 1024;
  const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  const validDate = (value) => typeof value === "string" && DATE.test(value) && Number.isFinite(Date.parse(value));

  function validate(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        data.format !== FORMAT || data.version !== VERSION || !validDate(data.exportedAt) ||
        !Array.isArray(data.history) || !Array.isArray(data.trainingSessions) ||
        data.history.length > options.MAX_HISTORY || data.trainingSessions.length > training.MAX_SESSIONS) {
      throw new Error("invalid-backup");
    }
    const history = data.history.map((entry) => {
      if (!options.validAttempt(entry)) throw new Error("invalid-backup");
      return entry.sessionId ? { at: entry.at, ms: entry.ms, sessionId: entry.sessionId } : { at: entry.at, ms: entry.ms };
    });
    const sessions = data.trainingSessions.map((entry) => {
      const session = training.normalizeSession(entry);
      if (!session?.endedAt || !session.attempts.length) throw new Error("invalid-backup");
      return session;
    });
    return { history, trainingSessions: sessions };
  }

  function create(history, trainingSessions, at = new Date().toISOString()) {
    const content = { format: FORMAT, version: VERSION, exportedAt: at, history, trainingSessions };
    const normalized = validate(content);
    const text = JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: at, ...normalized }, null, 2) + "\n";
    if (text.length > MAX_BYTES) throw new Error("backup-too-large");
    return text;
  }

  function parse(text) {
    if (typeof text !== "string" || text.length > MAX_BYTES) throw new Error("backup-too-large");
    let object;
    try { object = JSON.parse(text); }
    catch { throw new Error("invalid-backup"); }
    return validate(object);
  }

  // Validate both sections before writing. If a storage operation fails, restore
  // the previous keys so a partially imported backup is not left behind.
  function restore(data, storage) {
    const normalized = validate({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), ...data });
    const keys = [options.HISTORY_KEY, training.STORAGE_KEY];
    const values = [normalized.history, normalized.trainingSessions];
    let previous;
    let store;
    try {
      store = storage === undefined ? root.localStorage : storage;
      previous = keys.map((key) => store.getItem(key));
      keys.forEach((key, i) => store.setItem(key, JSON.stringify(values[i])));
      return true;
    } catch {
      if (previous) {
        keys.forEach((key, i) => {
          try {
            if (previous[i] === null) store.removeItem(key);
            else store.setItem(key, previous[i]);
          } catch { /* Storage may remain unavailable; never claim success. */ }
        });
      }
      return false;
    }
  }
  root.F1StartTimerBackup = Object.freeze({ FORMAT, VERSION, MAX_BYTES, create, parse, restore });
})(globalThis);
