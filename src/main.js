/* Browser UI. Original five-light board with opt-in accessibility and sharing. */
(function () {
  "use strict";
  const core = globalThis.F1StartTimerGame;
  const extras = globalThis.F1StartTimerOptions;
  const root = document.getElementById("game-control");
  if (!root || !core || !extras) {
    if (root) root.setAttribute("aria-label", "Game scripts failed to load");
    console.error("F1 Start Timer: required scripts were not loaded");
    return;
  }

  const { PHASE, createReactionGame, loadBest, saveBest, formatTime, isValidRecord } = core;
  const strips = [...root.querySelectorAll(".light-container")];
  const score = document.getElementById("result");
  const bestElement = document.getElementById("best");
  const lights = document.getElementById("lights-container");
  const announcement = document.getElementById("announcement");
  const status = document.getElementById("extras-status");
  const soundControl = document.getElementById("setting-sound");
  const contrastControl = document.getElementById("setting-contrast");
  const motionControl = document.getElementById("setting-motion");
  const scaleControl = document.getElementById("setting-scale");
  const copyButton = document.getElementById("copy-result");
  const shareButton = document.getElementById("share-result");
  const exportButton = document.getElementById("export-results");

  // Optional override for non-GitHub Pages domains.
  const GITHUB_USERNAME = "nicolazhou";
  const pagesOwner = /^([a-z\d-]+)\.github\.io$/i.exec(location.hostname)?.[1];
  const creatorUsername = (GITHUB_USERNAME || pagesOwner || "").trim();
  if (/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(creatorUsername)) {
    const creatorLink = document.getElementById("creator-link");
    creatorLink.href = `https://github.com/${creatorUsername}`;
    creatorLink.textContent = `@${creatorUsername}`;
    document.getElementById("credits").hidden = false;
  }

  let settings = extras.loadSettings();
  let history = extras.loadHistory();
  let latestResult = history[0]?.ms ?? null;
  let best = loadBest();
  let announcedPhase = PHASE.IDLE;
  let previousLitCount = 0;
  let audioContext = null;
  let audioUnavailable = false;
  bestElement.textContent = `Your best: ${formatTime(best)}`;

  function setStatus(message) { status.textContent = message; }
  function applySettings() {
    soundControl.checked = settings.sound;
    contrastControl.checked = settings.highContrast;
    motionControl.checked = settings.reduceMotion;
    scaleControl.value = String(settings.textScale);
    document.documentElement.dataset.highContrast = String(settings.highContrast);
    document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
    document.documentElement.dataset.textScale = String(settings.textScale);
  }
  function updateResultActions() {
    copyButton.disabled = latestResult === null;
    shareButton.disabled = latestResult === null;
    exportButton.disabled = history.length === 0;
  }
  applySettings();
  updateResultActions();

  // Generate sounds locally using Web Audio; never fetch external media.
  // A browser user gesture is required to unlock audio playback.
  function unlockAudio() {
    if (!settings.sound || audioUnavailable) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) { audioUnavailable = true; setStatus("Audio is unavailable in this browser."); return; }
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    } catch { audioUnavailable = true; setStatus("Audio is unavailable in this browser."); }
  }
  function beep(frequency, duration, offset = 0) {
    if (!settings.sound || !audioContext || audioContext.state !== "running") return;
    try {
      const start = audioContext.currentTime + offset;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.005);
    } catch { /* Some audio devices may become unavailable while playing. */ }
  }
  function playCue(kind) {
    if (kind === "light") beep(420, 0.075);
    else if (kind === "go") { beep(740, 0.11); beep(980, 0.14, 0.09); }
    else if (kind === "jump") beep(210, 0.14);
  }

  for (const [element, key] of [
    [soundControl, "sound"], [contrastControl, "highContrast"], [motionControl, "reduceMotion"],
  ]) {
    element.addEventListener("change", () => {
      settings = { ...settings, [key]: element.checked };
      extras.saveSettings(settings);
      applySettings();
      if (key === "sound" && element.checked) { unlockAudio(); playCue("light"); }
      setStatus(key === "sound" ? (element.checked ? "Sound enabled." : "Sound muted.") : "Preference saved on this device.");
    });
  }
  scaleControl.addEventListener("change", () => {
    settings = extras.normalizeSettings({ ...settings, textScale: Number(scaleControl.value) });
    extras.saveSettings(settings);
    applySettings();
    setStatus("Text size updated.");
  });

  const controlLabels = {
    [PHASE.IDLE]: "Start reaction time test",
    [PHASE.LIGHTING]: "Wait for the lights to go out",
    [PHASE.READY]: "Stop the reaction time clock",
    [PHASE.RESULT]: "Start another test",
    [PHASE.FALSE_START]: "Try again after a jump start",
    [PHASE.INTERRUPTED]: "Restart interrupted test",
  };
  const announcements = {
    [PHASE.IDLE]: "Press Enter or Space to start.",
    [PHASE.LIGHTING]: "Lights are turning on. Do not react yet.",
    [PHASE.READY]: "Lights out! React now.",
    [PHASE.RESULT]: "Reaction time recorded. You can try again.",
    [PHASE.FALSE_START]: "Jump start! You reacted too early.",
    [PHASE.INTERRUPTED]: "Test interrupted. Start again.",
  };

  const game = createReactionGame({
    onChange(next) {
      strips.forEach((strip, i) => {
        const illuminated = next.litCount > i;
        const bulbs = strip.querySelectorAll(".light");
        bulbs[2].classList.toggle("on", illuminated);
        bulbs[3].classList.toggle("on", illuminated);
      });
      lights.setAttribute("aria-label", next.phase === PHASE.READY
        ? "All five lights are off. Go!"
        : `${next.litCount} of 5 light columns illuminated`);
      root.setAttribute("aria-label", controlLabels[next.phase]);
      if (next.phase !== announcedPhase) {
        announcement.textContent = announcements[next.phase];
        announcedPhase = next.phase;
      }
      if (next.phase === PHASE.FALSE_START) score.textContent = "JUMP START!";
      else if (next.phase === PHASE.INTERRUPTED) score.textContent = "INTERRUPTED";
      else if (next.phase === PHASE.RESULT) score.textContent = formatTime(next.resultMs);
      else score.textContent = "00.000";

      if (next.phase === PHASE.LIGHTING && next.litCount > previousLitCount) playCue("light");
      if (next.phase === PHASE.READY) playCue("go");
      if (next.phase === PHASE.FALSE_START) playCue("jump");
      previousLitCount = next.litCount;

      if (next.phase === PHASE.RESULT) {
        latestResult = next.resultMs;
        history = extras.recordAttempt(history, next.resultMs);
        updateResultActions();
        if (isValidRecord(next.resultMs) && (best === null || next.resultMs < best)) {
          best = next.resultMs;
          saveBest(best);
          bestElement.textContent = `Your best: ${formatTime(best)}`;
        }
      }
    },
  });

  function shareMessage() {
    return extras.shareText(latestResult, best, formatTime);
  }
  async function copyMessage() {
    if (latestResult === null) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareMessage());
      } else {
        // Browsers opened with file:// may not expose the Clipboard API.
        const field = document.createElement("textarea");
        field.value = shareMessage();
        field.readOnly = true;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        let copied = false;
        try { copied = document.execCommand("copy"); }
        finally { field.remove(); }
        if (!copied) throw new Error("Clipboard unavailable");
      }
      setStatus("Result copied to clipboard.");
    } catch { setStatus("Clipboard unavailable. Try Share or Export CSV."); }
  }
  copyButton.addEventListener("click", () => { void copyMessage(); });
  shareButton.addEventListener("click", async () => {
    if (latestResult === null) return;
    if (!navigator.share) { await copyMessage(); return; }
    try {
      const shareData = { title: "F1 Start Timer", text: shareMessage() };
      if (location.protocol === "https:") shareData.url = location.href;
      await navigator.share(shareData);
      setStatus("Result shared.");
    } catch (error) {
      if (error?.name !== "AbortError") setStatus("Sharing unavailable. Try Copy result.");
    }
  });
  exportButton.addEventListener("click", () => {
    if (!history.length) return;
    const csv = extras.csvForHistory(history, isValidRecord);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "f1-start-timer-results.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported ${history.length} result${history.length === 1 ? "" : "s"} as CSV.`);
  });

  function activate() {
    if (document.visibilityState === "hidden") return;
    unlockAudio();
    game.activate();
  }
  document.addEventListener("pointerdown", (event) => {
    // Settings, export controls and the author credit must never start the game.
    if (event.target.closest("#extras, #credits")) return;
    if (event.isPrimary && event.button === 0) activate();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) activate();
  });
  root.addEventListener("click", (event) => {
    if (event.detail === 0) activate();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") game.interrupt();
  });
  window.addEventListener("pagehide", () => game.interrupt());
  window.addEventListener("blur", () => game.interrupt());
})();
