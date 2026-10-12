/* Preferences and private, on-device reaction history; no external dependencies. */
(function (root) {
  "use strict";
  const SETTINGS_KEY = "f1-start-timer:settings";
  const HISTORY_KEY = "f1-start-timer:history";
  const MAX_HISTORY = 50;
  const SESSION_KEY = "f1-start-timer:session";
  const VALID_SESSION = /^[a-zA-Z0-9_-]{1,80}$/;
  let fallbackSession = null;
  const defaults = Object.freeze({ sound: false, soundVolume: 75, highContrast: false, reduceMotion: false, greenLights: false, liveTimer: false, textScale: 100, language: "auto" });

  function getStorage(storage) {
    return storage === undefined ? root.localStorage : storage;
  }
  function normalizeSettings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults };
    return {
      sound: value.sound === true,
      soundVolume: typeof value.soundVolume === "number" && Number.isFinite(value.soundVolume) ? Math.min(100, Math.max(0, Math.round(value.soundVolume))) : 75,
      highContrast: value.highContrast === true,
      reduceMotion: value.reduceMotion === true,
      greenLights: value.greenLights === true,
      liveTimer: value.liveTimer === true,
      textScale: [100, 125, 150].includes(value.textScale) ? value.textScale : 100,
      language: ["auto", "en", "it", "es", "fr", "de"].includes(value.language) ? value.language : "auto",
    };
  }
  function loadSettings(storage) {
    try { return normalizeSettings(JSON.parse(getStorage(storage).getItem(SETTINGS_KEY))); }
    catch { return { ...defaults }; }
  }
  function saveSettings(settings, storage) {
    try { getStorage(storage).setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))); return true; }
    catch { return false; }
  }
  // A session lasts for the lifetime of a browser tab, including page reloads.
  // If sessionStorage is unavailable (private/restricted contexts), use an
  // in-memory id for the current page instead of preventing gameplay.
  function currentSessionId(storage) {
    if (fallbackSession) return fallbackSession;
    try {
      const store = storage === undefined ? root.sessionStorage : storage;
      const saved = store.getItem(SESSION_KEY);
      if (VALID_SESSION.test(saved || "")) return (fallbackSession = saved);
      const value = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      store.setItem(SESSION_KEY, value);
      return (fallbackSession = value);
    } catch {
      return (fallbackSession = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`);
    }
  }
  function validAttempt(value) {
    return value && typeof value === "object" &&
      typeof value.ms === "number" && Number.isFinite(value.ms) && value.ms >= 0 && value.ms <= 3_600_000 &&
      typeof value.at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at) &&
      Number.isFinite(Date.parse(value.at)) &&
      (value.sessionId === undefined || (typeof value.sessionId === "string" && VALID_SESSION.test(value.sessionId)));
  }
  function loadHistory(storage) {
    try {
      const value = JSON.parse(getStorage(storage).getItem(HISTORY_KEY));
      return Array.isArray(value) ? value.filter(validAttempt).slice(0, MAX_HISTORY).map(({ at, ms, sessionId }) => sessionId ? { at, ms, sessionId } : { at, ms }) : [];
    } catch { return []; }
  }
  function recordAttempt(history, ms, at = new Date().toISOString(), storage, sessionId = currentSessionId()) {
    const item = { at, ms, sessionId };
    if (!validAttempt(item)) return Array.isArray(history) ? history : [];
    const entries = [item, ...(Array.isArray(history) ? history.filter(validAttempt) : [])].slice(0, MAX_HISTORY);
    try { getStorage(storage).setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* Session still works. */ }
    return entries;
  }
  function clearHistory(storage) {
    try { getStorage(storage).removeItem(HISTORY_KEY); return true; }
    catch { return false; }
  }
  // For old stored rows without a session ID, keep them as "earlier attempts".
  const sessionFor = (entry) => entry.sessionId || "legacy";
  function filterHistory(history, period = "all", sessionId = currentSessionId(), now = Date.now()) {
    const entries = Array.isArray(history) ? history.filter(validAttempt).slice(0, MAX_HISTORY) : [];
    if (period === "session") return entries.filter((entry) => entry.sessionId === sessionId);
    const days = period === "7d" ? 7 : period === "30d" ? 30 : null;
    if (days === null) return entries;
    const cutoff = now - days * 86400000;
    return entries.filter((entry) => Date.parse(entry.at) >= cutoff && Date.parse(entry.at) <= now);
  }
  function historyStats(history) {
    const entries = Array.isArray(history) ? history.filter(validAttempt).slice(0, MAX_HISTORY) : [];
    const ordered = entries.map((entry) => entry.ms).sort((a, b) => a - b);
    const count = ordered.length;
    const averageMs = count ? ordered.reduce((total, ms) => total + ms, 0) / count : null;
    const middle = Math.floor(count / 2);
    const medianMs = count ? (count % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2) : null;
    // Population standard deviation (ms); lower values mean more consistency.
    const consistencyMs = count ? Math.sqrt(ordered.reduce((sum, ms) => sum + (ms - averageMs) ** 2, 0) / count) : null;
    return {
      count,
      averageMs,
      medianMs,
      slowestMs: count ? ordered[count - 1] : null,
      fastestMs: count ? ordered[0] : null,
      consistencyMs,
      sessions: new Set(entries.filter((entry) => entry.sessionId).map((entry) => entry.sessionId)).size,
    };
  }
  function csvForHistory(history) {
    const rows = ["timestamp_utc,reaction_ms,reaction_seconds"];
    for (const entry of history) {
      if (!validAttempt(entry)) continue;
      rows.push(`${entry.at},${entry.ms},${(Math.round(entry.ms) / 1000).toFixed(3)}`);
    }
    return rows.join("\r\n") + "\r\n";
  }
  function shareText(ms, bestMs, formatTime) {
    const best = bestMs === null ? "no personal best yet" : `${formatTime(bestMs)} s`;
    return `My F1 Start Timer reaction: ${formatTime(ms)} s. Personal best: ${best}.`;
  }
  root.F1StartTimerOptions = Object.freeze({
    SETTINGS_KEY, HISTORY_KEY, SESSION_KEY, MAX_HISTORY, normalizeSettings, loadSettings, saveSettings,
    loadHistory, recordAttempt, clearHistory, historyStats, filterHistory, currentSessionId, sessionFor, csvForHistory, shareText,
  });
})(globalThis);
