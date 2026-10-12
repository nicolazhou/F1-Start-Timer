/* Browser UI. Original five-light board with opt-in accessibility and sharing. */
(function () {
  "use strict";
  const core = globalThis.F1StartTimerGame;
  const extras = globalThis.F1StartTimerOptions;
  const i18n = globalThis.F1StartTimerI18n;
  const root = document.getElementById("game-control");
  if (!root || !core || !extras || !i18n) {
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
  const greenLightsControl = document.getElementById("setting-green-lights");
  const scaleControl = document.getElementById("setting-scale");
  const languageControl = document.getElementById("setting-language");
  const copyButton = document.getElementById("copy-result");
  const shareButton = document.getElementById("share-result");
  const exportButton = document.getElementById("export-results");
  const settingsDetails = document.getElementById("extras");
  const settingsTrigger = settingsDetails.querySelector("summary");
  const settingsPanel = settingsDetails.querySelector(".extras-content");
  const settingsClose = document.getElementById("close-settings");
  const settingsBackdrop = document.getElementById("settings-backdrop");
  let historyUI = null;

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

  let settings = extras.normalizeSettings(extras.loadSettings());
  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  let activeLanguage = i18n.resolveLanguage(settings.language, browserLanguages);
  const t = (key, params) => i18n.translate(activeLanguage, key, params);
  let history = extras.loadHistory();
  let latestResult = history[0]?.ms ?? null;
  let best = loadBest();
  let announcedPhase = PHASE.IDLE;
  let currentView = { phase: PHASE.IDLE, litCount: 0, resultMs: null };
  let previousLitCount = 0;
  let audioContext = null;
  let audioUnavailable = false;
  function renderLights(next = currentView) {
    strips.forEach((strip, i) => {
      const illuminated = next.phase === PHASE.LIGHTING && next.litCount > i;
      const green = settings.greenLights && next.phase === PHASE.READY;
      const bulbs = strip.querySelectorAll(".light");
      bulbs[0].classList.toggle("green", green);
      bulbs[1].classList.toggle("green", green);
      bulbs[2].classList.toggle("on", illuminated);
      bulbs[3].classList.toggle("on", illuminated);
    });
  }
  function renderGameTexts(next = currentView, forceAnnouncement = false) {
    root.setAttribute("aria-label", t({
      [PHASE.IDLE]: "gameIdle", [PHASE.LIGHTING]: "gameLighting", [PHASE.READY]: "gameReady",
      [PHASE.RESULT]: "gameResult", [PHASE.FALSE_START]: "gameFalseStart", [PHASE.INTERRUPTED]: "gameInterrupted",
    }[next.phase]));
    lights.setAttribute("aria-label", next.phase === PHASE.READY
      ? t(settings.greenLights ? "lightsReadyGreen" : "lightsReady") : t("lightsCount", { count: next.litCount }));
    if (forceAnnouncement || next.phase !== announcedPhase) announcement.textContent = t({
      [PHASE.IDLE]: "announceIdle", [PHASE.LIGHTING]: "announceLighting",
      [PHASE.READY]: "announceReady", [PHASE.RESULT]: "announceResult",
      [PHASE.FALSE_START]: "announceFalseStart", [PHASE.INTERRUPTED]: "announceInterrupted",
    }[next.phase]);
    announcedPhase = next.phase;
    if (next.phase === PHASE.FALSE_START) score.textContent = t("jumpStart");
    else if (next.phase === PHASE.INTERRUPTED) score.textContent = t("interrupted");
    else if (next.phase === PHASE.RESULT) score.textContent = formatTime(next.resultMs);
    else score.textContent = "00.000";
    bestElement.textContent = t("best", { time: formatTime(best) });
  }

  function renderLanguage() {
    activeLanguage = i18n.resolveLanguage(settings.language, browserLanguages);
    document.documentElement.lang = activeLanguage;
    languageControl.value = settings.language;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    });
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = t("pageDescription");
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.content = t("ogDescription");
    renderGameTexts(currentView, true);
    historyUI?.render();
  }

  // Toast-like feedback: do not leave old export messages in the modal footer.
  const STATUS_DURATION_MS = 4500;
  let statusTimer = null;
  function clearStatus() {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    status.textContent = "";
  }
  function setStatus(message) {
    clearStatus();
    if (!message || !settingsDetails.open) return;
    status.textContent = message;
    statusTimer = setTimeout(clearStatus, STATUS_DURATION_MS);
  }
  function applySettings() {
    soundControl.checked = settings.sound;
    contrastControl.checked = settings.highContrast;
    motionControl.checked = settings.reduceMotion;
    greenLightsControl.checked = settings.greenLights;
    scaleControl.value = String(settings.textScale);
    languageControl.value = settings.language;
    document.documentElement.dataset.highContrast = String(settings.highContrast);
    document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
    document.documentElement.dataset.textScale = String(settings.textScale);
    renderLights();
    renderGameTexts();
  }
  function updateResultActions() {
    copyButton.disabled = latestResult === null;
    shareButton.disabled = latestResult === null;
    exportButton.disabled = history.length === 0;
  }
  applySettings();
  renderLanguage();
  updateResultActions();
  if (globalThis.F1StartTimerHistory) {
    historyUI = globalThis.F1StartTimerHistory.initReactionHistory({
      t, getLanguage: () => activeLanguage,
      getHistory: () => history, getBest: () => best,
      formatTime, isValidRecord, historyStats: extras.historyStats,
      setStatus,
      onExport: () => exportCsv(),
      onClear: () => {
        if (!extras.clearHistory()) return false;
        history = [];
        latestResult = null;
        updateResultActions();
        return true;
      },
    });
  }

  // Generate sounds locally using Web Audio; never fetch external media.
  // A browser user gesture is required to unlock audio playback.
  function unlockAudio() {
    if (!settings.sound || audioUnavailable) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) { audioUnavailable = true; setStatus(t("audioUnavailable")); return; }
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    } catch { audioUnavailable = true; setStatus(t("audioUnavailable")); }
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
    [greenLightsControl, "greenLights"],
  ]) {
    element.addEventListener("change", () => {
      settings = { ...settings, [key]: element.checked };
      extras.saveSettings(settings);
      applySettings();
      if (key === "sound" && element.checked) { unlockAudio(); playCue("light"); }
      setStatus(key === "sound" ? t(element.checked ? "soundOn" : "soundOff") : t("preferenceSaved"));
    });
  }
  scaleControl.addEventListener("change", () => {
    settings = extras.normalizeSettings({ ...settings, textScale: Number(scaleControl.value) });
    extras.saveSettings(settings);
    applySettings();
    setStatus(t("scaleUpdated"));
  });

  languageControl.addEventListener("change", () => {
    settings = extras.normalizeSettings({ ...settings, language: languageControl.value });
    extras.saveSettings(settings);
    renderLanguage();
    setStatus(t("languageUpdated"));
  });

  const game = createReactionGame({
    onChange(next) {
      renderLights(next);
      currentView = next;
      // Redraw strings in the active language without modifying the game's timing.
      renderGameTexts(next);
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
          bestElement.textContent = t("best", { time: formatTime(best) });
        }
        historyUI?.render();
      }
    },
  });

  function shareMessage() {
    const bestText = best === null ? t("noBestYet") : `${formatTime(best)} s`;
    return t("shareMessage", { time: formatTime(latestResult), best: bestText });
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
      setStatus(t("copied"));
    } catch { setStatus(t("copyUnavailable")); }
  }
  copyButton.addEventListener("click", () => { void copyMessage(); });
  shareButton.addEventListener("click", async () => {
    if (latestResult === null) return;
    if (!navigator.share) { await copyMessage(); return; }
    try {
      const shareData = { title: "F1 Start Timer", text: shareMessage() };
      if (location.protocol === "https:") shareData.url = location.href;
      await navigator.share(shareData);
      setStatus(t("shared"));
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(t("sharingUnavailable"));
    }
  });
  function exportCsv() {
    if (!history.length) return;
    const csv = extras.csvForHistory(history);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "f1-start-timer-results.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t(history.length === 1 ? "exportedOne" : "exportedMany", { count: history.length }));
  }
  exportButton.addEventListener("click", exportCsv);

  function activate() {
    if (settingsDetails.open || document.visibilityState === "hidden") return;
    unlockAudio();
    game.activate();
  }

  // The native details/summary trigger keeps the panel available without JS.
  // With JS, opening it behaves as a modal: scroll locking, keyboard trapping,
  // Escape/backdrop dismiss, and focus restored to the trigger on close.
  function closeSettings() {
    if (historyUI?.dismissConfirmation()) return;
    settingsDetails.open = false;
  }
  settingsClose.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);
  settingsDetails.addEventListener("toggle", () => {
    clearStatus();
    document.documentElement.classList.toggle("settings-open", settingsDetails.open);
    if (settingsDetails.open) {
      settingsClose.focus({ preventScroll: true });
    } else {
      settingsTrigger.focus({ preventScroll: true });
    }
  });
  function modalFocusables() {
    const scope = historyUI?.confirmationOpen ? historyUI.confirmationPanel : settingsPanel;
    return [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
      .filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]') && element.tabIndex !== -1);
  }
  document.addEventListener("keydown", (event) => {
    if (!settingsDetails.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
    } else if (event.key === "Tab") {
      const items = modalFocusables();
      if (!items.length) { event.preventDefault(); settingsPanel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !settingsPanel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !settingsPanel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener("focusin", (event) => {
    if (!settingsDetails.open) return;
    if (historyUI?.confirmationOpen) {
      if (!historyUI.confirmationPanel.contains(event.target)) document.getElementById("cancel-clear").focus({ preventScroll: true });
    } else if (!settingsPanel.contains(event.target)) settingsClose.focus({ preventScroll: true });
  });

  // Show the subtle focus hint only if Tab navigated into the game.
  // Enter/Space during gameplay and pointer interactions keep the classic look.
  let tabNavigationPending = false;
  function clearTabFocus() {
    tabNavigationPending = false;
    root.classList.remove("tab-navigation");
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      tabNavigationPending = true;
    } else {
      clearTabFocus();
    }
  }, true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Tab") tabNavigationPending = false;
  }, true);
  root.addEventListener("focus", () => {
    root.classList.toggle("tab-navigation", tabNavigationPending);
  });
  root.addEventListener("blur", clearTabFocus);
  document.addEventListener("pointerdown", clearTabFocus, true);
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
