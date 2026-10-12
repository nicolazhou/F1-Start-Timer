/* Shared browser / Node game engine: no dependencies or bundler. */
(function (root) {
"use strict";
/** Pure game logic. Timers, animation frames and the clock can be injected in tests. */
const PHASE = Object.freeze({
  IDLE: "idle",
  LIGHTING: "lighting",
  READY: "ready",
  RESULT: "result",
  FALSE_START: "false-start",
  INTERRUPTED: "interrupted",
});

const DEFAULT_TIMING = Object.freeze({
  lightIntervalMs: 1000,
  lightsOutMinMs: 200,
  lightsOutMaxMs: 3000,
});

function createReactionGame({
  onChange = () => {},
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  unschedule = (id) => clearTimeout(id),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  random = Math.random,
  timing = DEFAULT_TIMING,
} = {}) {
  if (
    !Number.isFinite(timing.lightIntervalMs) || timing.lightIntervalMs <= 0 ||
    !Number.isFinite(timing.lightsOutMinMs) || timing.lightsOutMinMs < 0 ||
    !Number.isFinite(timing.lightsOutMaxMs) ||
    timing.lightsOutMaxMs < timing.lightsOutMinMs
  ) {
    throw new RangeError("Invalid timing configuration");
  }

  let snapshot = { phase: PHASE.IDLE, litCount: 0, resultMs: null };
  let pendingTimer = null;
  let pendingFrame = null;
  let reactionStart = null;
  let generation = 0;
  let disposed = false;

  function publish(changes) {
    snapshot = { ...snapshot, ...changes };
    onChange({ ...snapshot });
  }

  // Generation tokens also invalidate callbacks that have already been queued.
  function cancelPending() {
    generation += 1;
    if (pendingTimer !== null) {
      unschedule(pendingTimer);
      pendingTimer = null;
    }
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }
  }

  function scheduleNextLight(token) {
    pendingTimer = schedule(() => {
      pendingTimer = null;
      if (disposed || token !== generation) return;

      const litCount = snapshot.litCount + 1;
      publish({ litCount });
      if (litCount < 5) {
        scheduleNextLight(token);
      } else {
        // Start the randomized wait immediately after the fifth light.
        const delay = timing.lightsOutMinMs +
          Math.min(Math.max(random(), 0), 1) *
            (timing.lightsOutMaxMs - timing.lightsOutMinMs);

        pendingTimer = schedule(() => {
          pendingTimer = null;
          if (disposed || token !== generation) return;

          // Commit the visual change on a rendering frame. The timestamp is a
          // best-effort browser approximation, not an exact photon-on-screen time.
          pendingFrame = requestFrame(() => {
            pendingFrame = null;
            if (disposed || token !== generation) return;
            reactionStart = now();
            publish({ phase: PHASE.READY, litCount: 0 });
          });
        }, delay);
      }
    }, timing.lightIntervalMs);
  }

  function start() {
    if (disposed || snapshot.phase === PHASE.LIGHTING || snapshot.phase === PHASE.READY) {
      return false;
    }
    cancelPending();
    reactionStart = null;
    publish({ phase: PHASE.LIGHTING, litCount: 1, resultMs: null });
    scheduleNextLight(generation);
    return true;
  }

  /** User action is performed on pointerdown (or keyboard-generated click). */
  function activate() {
    if (disposed) return { type: "ignored" };

    if (snapshot.phase === PHASE.LIGHTING) {
      cancelPending();
      reactionStart = null;
      publish({ phase: PHASE.FALSE_START, litCount: 0, resultMs: null });
      return { type: "false-start" };
    }

    if (snapshot.phase === PHASE.READY) {
      const resultMs = Math.max(0, now() - reactionStart);
      cancelPending();
      reactionStart = null;
      publish({ phase: PHASE.RESULT, litCount: 0, resultMs });
      return { type: "result", resultMs };
    }

    return { type: start() ? "started" : "ignored" };
  }

  function interrupt() {
    if (disposed || ![PHASE.LIGHTING, PHASE.READY].includes(snapshot.phase)) {
      return false;
    }
    cancelPending();
    reactionStart = null;
    publish({ phase: PHASE.INTERRUPTED, litCount: 0, resultMs: null });
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPending();
    reactionStart = null;
  }

  return {
    activate,
    start,
    interrupt,
    dispose,
    getState: () => ({ ...snapshot }),
    // UI-only readout, sampled from the same monotonic clock as the final result.
    getElapsedMs: () => !disposed && snapshot.phase === PHASE.READY && reactionStart !== null
      ? Math.max(0, now() - reactionStart) : null,
  };
}

const BEST_KEY = "f1-start-timer:best";
const LEGACY_BEST_KEY = "best";
// A stored best that rounds to 00.000 or exceeds one minute is not useful.
// Extreme reaction times may still be shown after a round, but not saved as a record.
const MIN_RECORD_MS = 0.5;
const MAX_RECORD_MS = 60_000;

function resolveStorage(storage) {
  return storage === undefined ? globalThis.localStorage : storage;
}

function isValidRecord(value) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= MIN_RECORD_MS && value <= MAX_RECORD_MS;
}

function parseBest(raw) {
  if (raw === null || raw === "" || raw === undefined) return null;
  const value = Number(raw);
  return isValidRecord(value) ? value : null;
}

/** Read the current key first, falling back to earlier project versions. */
function loadBest(storage) {
  try {
    const store = resolveStorage(storage);
    for (const key of [BEST_KEY, LEGACY_BEST_KEY]) {
      const record = parseBest(store.getItem(key));
      if (record !== null) return record;
    }
    return null;
  } catch {
    // Private browsing and restricted browser contexts can reject storage.
    return null;
  }
}

function saveBest(value, storage) {
  if (!isValidRecord(value)) return false;
  try {
    resolveStorage(storage).setItem(BEST_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

function formatTime(ms) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  // Round while still in milliseconds to avoid binary float .toFixed() ties.
  return (Math.round(ms) / 1000).toFixed(3).padStart(6, "0");
}

root.F1StartTimerGame = Object.freeze({ PHASE, createReactionGame, loadBest, saveBest, formatTime, isValidRecord });
})(globalThis);
