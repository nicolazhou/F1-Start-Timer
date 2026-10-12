/* Training mode model: local-only sessions, no dependencies or remote services. */
(function (root) {
  "use strict";
  const STORAGE_KEY = "f1-start-timer:training-sessions";
  const ACTIVE_KEY = "f1-start-timer:training-active";
  const MAX_SESSIONS = 30;
  const TARGETS = Object.freeze([5, 10, 20]);
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  }
  function validAttempt(item) {
    return item && validDate(item.at) && (item.ms === null ||
      (typeof item.ms === "number" && Number.isFinite(item.ms) && item.ms >= 0 && item.ms <= 3_600_000));
  }
  function normalizeSession(value) {
    if (!value || !TARGETS.includes(value.target) || !validDate(value.startedAt) ||
        !Array.isArray(value.attempts) || value.attempts.length > value.target ||
        !value.attempts.every(validAttempt)) return null;
    if (value.endedAt !== undefined && !validDate(value.endedAt)) return null;
    return {
      startedAt: value.startedAt, target: value.target,
      attempts: value.attempts.map(({ at, ms }) => ({ at, ms })),
      ...(value.endedAt ? { endedAt: value.endedAt } : {}),
    };
  }
  function loadSessions(storage) {
    try {
      storage = storage === undefined ? root.localStorage : storage;
      const rows = JSON.parse(storage.getItem(STORAGE_KEY));
      return Array.isArray(rows) ? rows.map(normalizeSession).filter((row) => row && row.endedAt).slice(0, MAX_SESSIONS) : [];
    } catch { return []; }
  }
  function saveSession(session, storage) {
    const normalized = normalizeSession(session);
    if (!normalized?.endedAt || normalized.attempts.length === 0) return false;
    try {
      storage = storage === undefined ? root.localStorage : storage;
      storage.setItem(STORAGE_KEY, JSON.stringify([normalized, ...loadSessions(storage)].slice(0, MAX_SESSIONS)));
      return true;
    } catch { return false; }
  }
  function loadActive(storage) {
    try {
      storage = storage === undefined ? root.sessionStorage : storage;
      const normalized = normalizeSession(JSON.parse(storage.getItem(ACTIVE_KEY)));
      return normalized && !normalized.endedAt && normalized.attempts.length <= normalized.target ? normalized : null;
    } catch { return null; }
  }
  function persistActive(session, storage) {
    try {
      storage = storage === undefined ? root.sessionStorage : storage;
      if (session) storage.setItem(ACTIVE_KEY, JSON.stringify(normalizeSession(session)));
      else storage.removeItem(ACTIVE_KEY);
      return true;
    } catch { return false; }
  }
  function newSession(target, now = new Date().toISOString()) {
    if (!TARGETS.includes(target) || !validDate(now)) throw new RangeError("Invalid training session");
    return { startedAt: now, target, attempts: [] };
  }
  function addAttempt(session, ms, at = new Date().toISOString()) {
    const normalized = normalizeSession(session);
    const attempt = { ms, at };
    if (!normalized || normalized.endedAt || normalized.attempts.length >= normalized.target || !validAttempt(attempt)) return null;
    return { ...normalized, attempts: [...normalized.attempts, attempt] };
  }
  function statsFor(session) {
    const attempts = normalizeSession(session)?.attempts || [];
    const valid = attempts.filter(({ ms }) => ms !== null).map(({ ms }) => ms);
    const average = valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
    const deviation = valid.length > 1 ? Math.sqrt(valid.reduce((sum, value) => sum + (value - average) ** 2, 0) / valid.length) : null;
    // Score is meaningful only with at least two valid results. 100 = identical times.
    const consistency = deviation === null ? null : Math.max(0, Math.min(100, Math.round(100 * (1 - deviation / Math.max(average, 1)))));
    const falseStarts = attempts.length - valid.length;
    return {
      completed: attempts.length, valid: valid.length, falseStarts,
      falseStartPercent: attempts.length ? Math.round(falseStarts / attempts.length * 100) : 0,
      averageMs: average, bestMs: valid.length ? Math.min(...valid) : null,
      consistency,
    };
  }
  root.F1StartTimerTraining = Object.freeze({ STORAGE_KEY, ACTIVE_KEY, TARGETS, MAX_SESSIONS,
    normalizeSession, loadSessions, saveSession, loadActive, persistActive, newSession, addAttempt, statsFor });
})(globalThis);
