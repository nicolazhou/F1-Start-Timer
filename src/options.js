/* Preferences and private, on-device reaction history; no external dependencies. */
(function (root) {
  "use strict";
  const SETTINGS_KEY = "f1-start-timer:settings";
  const HISTORY_KEY = "f1-start-timer:history";
  const MAX_HISTORY = 50;
  const defaults = Object.freeze({ sound: false, highContrast: false, reduceMotion: false, greenLights: false, textScale: 100, language: "auto" });

  function getStorage(storage) {
    return storage === undefined ? root.localStorage : storage;
  }
  function normalizeSettings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults };
    return {
      sound: value.sound === true,
      highContrast: value.highContrast === true,
      reduceMotion: value.reduceMotion === true,
      greenLights: value.greenLights === true,
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
  function validAttempt(value) {
    return value && typeof value === "object" &&
      typeof value.ms === "number" && Number.isFinite(value.ms) && value.ms >= 0 && value.ms <= 3_600_000 &&
      typeof value.at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at) &&
      Number.isFinite(Date.parse(value.at));
  }
  function loadHistory(storage) {
    try {
      const value = JSON.parse(getStorage(storage).getItem(HISTORY_KEY));
      return Array.isArray(value) ? value.filter(validAttempt).slice(0, MAX_HISTORY).map(({ at, ms }) => ({ at, ms })) : [];
    } catch { return []; }
  }
  function recordAttempt(history, ms, at = new Date().toISOString(), storage) {
    const item = { at, ms };
    if (!validAttempt(item)) return Array.isArray(history) ? history : [];
    const entries = [item, ...(Array.isArray(history) ? history.filter(validAttempt) : [])].slice(0, MAX_HISTORY);
    try { getStorage(storage).setItem(HISTORY_KEY, JSON.stringify(entries)); } catch { /* Session still works. */ }
    return entries;
  }
  function clearHistory(storage) {
    try { getStorage(storage).removeItem(HISTORY_KEY); return true; }
    catch { return false; }
  }
  function historyStats(history) {
    const entries = Array.isArray(history) ? history.filter(validAttempt).slice(0, MAX_HISTORY) : [];
    return {
      count: entries.length,
      averageMs: entries.length ? entries.reduce((total, entry) => total + entry.ms, 0) / entries.length : null,
      fastestMs: entries.length ? Math.min(...entries.map((entry) => entry.ms)) : null,
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
    SETTINGS_KEY, HISTORY_KEY, MAX_HISTORY, normalizeSettings, loadSettings, saveSettings,
    loadHistory, recordAttempt, clearHistory, historyStats, csvForHistory, shareText,
  });
})(globalThis);
