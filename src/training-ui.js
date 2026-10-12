/* Separate accessible Training dialog + practice progress. Uses the existing game engine. */
(function (root) {
  "use strict";
  const model = root.F1StartTimerTraining;
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function init({ t, getLanguage, formatTime, interruptGame, focusGame }) {
    const launch = $("training-launch");
    const modal = $("training-dialog");
    const overlay = $("training-overlay");
    const closeButton = $("training-close");
    const banner = $("training-banner");
    const startButton = $("training-start");
    const endButton = $("training-end");
    const summary = $("training-summary");
    const modes = [...modal.querySelectorAll(".training-mode")];
    let selected = 10;
    let active = model.loadActive();
    let sessions = model.loadSessions();
    let completionTimer = null;
    let modalPreviousFocus = null;
    let launchKeyboardOpen = false;
    let lastFinished = null;

    const units = (ms) => ms === null ? "—" : `${formatTime(ms)} s`;
    function renderBanner(hint) {
      banner.hidden = !active;
      if (!active) return;
      const done = active.attempts.length;
      $("training-banner-title").textContent = t("trainingRound", { current: Math.min(done + 1, active.target), total: active.target });
      $("training-banner-progress").textContent = t("trainingCompleted", { done, total: active.target });
      $("training-progress-fill").style.width = `${done / active.target * 100}%`;
      const progress = $("training-progressbar");
      progress.setAttribute("aria-valuemax", String(active.target));
      progress.setAttribute("aria-valuenow", String(done));
      $("training-banner-hint").textContent = hint || t("trainingTapHint");
    }
    function setSelected(value) {
      if (!model.TARGETS.includes(value)) return;
      selected = value;
      for (const button of modes) {
        const isSelected = Number(button.dataset.count) === selected;
        button.classList.toggle("selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      }
    }
    for (const button of modes) button.addEventListener("click", () => setSelected(Number(button.dataset.count)));

    function renderSummary(session) {
      summary.hidden = !session;
      if (!session) return;
      const stats = model.statsFor(session);
      const completed = session.attempts.length === session.target;
      $("training-summary-heading").textContent = t(completed ? "trainingFinished" : "trainingStopped");
      $("training-summary-desc").textContent = t("trainingSummaryText", { valid: stats.valid, falseStarts: stats.falseStarts, total: stats.completed });
      $("training-summary-average").textContent = units(stats.averageMs);
      $("training-summary-best").textContent = units(stats.bestMs);
      $("training-summary-score").textContent = stats.consistency === null ? "—" : `${stats.consistency}/100`;
      $("training-summary-false").textContent = `${stats.falseStarts} (${stats.falseStartPercent}%)`;
    }
    function renderChart() {
      const chart = $("training-chart");
      chart.replaceChildren(svg("title", {}, t("trainingChartLabel")));
      const points = sessions.slice(0, 5).reverse().map(model.statsFor).map(({ averageMs }) => averageMs);
      $("training-chart-summary").textContent = points.some((value) => value !== null)
        ? t("trainingChartValues", { values: points.map((ms) => ms === null ? "—" : Math.round(ms)).join(", ") })
        : t("trainingChartEmpty");
      if (!points.some((value) => value !== null)) {
        chart.append(svg("text", { x: 210, y: 76, "text-anchor": "middle", "font-size": 13, fill: "#59616b" }, t("trainingChartEmpty")));
        return;
      }
      const lows = points.filter((value) => value !== null);
      const low = Math.min(...lows);
      const high = Math.max(...lows);
      const span = Math.max(30, high - low);
      const y = (ms) => 115 - 85 * (ms - low + (span - (high - low)) / 2) / span;
      for (const yy of [30, 65, 100]) chart.append(svg("line", { x1: 15, y1: yy, x2: 405, y2: yy, stroke: "#e7e9eb", "stroke-dasharray": "3 4" }));
      const x = (i) => 20 + i * (380 / Math.max(1, points.length - 1));
      let current = [];
      function drawLine() {
        if (!current.length) return;
        if (current.length > 1) chart.append(svg("polyline", { points: current.map((p) => p.join(",")).join(" "), fill: "none", stroke: "#e10600", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }));
        current = [];
      }
      points.forEach((ms, i) => {
        if (ms === null) { drawLine(); return; }
        current.push([x(i), y(ms)]);
      });
      drawLine();
      points.forEach((ms, i) => {
        if (ms === null) return;
        const circle = svg("circle", { cx: x(i), cy: y(ms), r: 4, fill: "white", stroke: "#e10600", "stroke-width": 2 });
        circle.append(svg("title", {}, `${formatTime(ms)} s`));
        chart.append(circle);
      });
    }
    function renderStats() {
      sessions = model.loadSessions();
      const last = sessions[0];
      $("training-last-stats").hidden = !last;
      $("training-empty").hidden = !!last;
      $("training-last-date").textContent = last ? new Date(last.endedAt).toLocaleDateString(getLanguage()) : "";
      if (last) {
        const data = model.statsFor(last);
        $("training-last-average").textContent = units(data.averageMs);
        $("training-last-false").textContent = `${data.falseStarts}/${data.completed} (${data.falseStartPercent}%)`;
        $("training-last-score").textContent = data.consistency === null ? "—" : `${data.consistency}/100`;
        $("training-last-valid").textContent = String(data.valid);
      }
      renderSummary(lastFinished);
      renderChart();
      startButton.disabled = !!active;
      startButton.textContent = t(active ? "trainingAlreadyActive" : "trainingStart");
      renderBanner();
    }
    function open() {
      if (modal.hidden === false) return;
      interruptGame();
      modalPreviousFocus = document.activeElement;
      overlay.hidden = false;
      modal.hidden = false;
      // Prevent screen readers from browsing the page behind this modal.
      $("app").inert = true;
      document.documentElement.classList.add("training-open");
      renderStats();
      closeButton.focus({ preventScroll: true });
    }
    function close({ toGame = false } = {}) {
      if (modal.hidden) return;
      overlay.hidden = true;
      modal.hidden = true;
      $("app").inert = false;
      document.documentElement.classList.remove("training-open");
      const focusTarget = !toGame && launchKeyboardOpen ? modalPreviousFocus : null;
      modalPreviousFocus = null;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
      else focusGame();
    }
    function clearCompletionTimer() {
      if (completionTimer !== null) clearTimeout(completionTimer);
      completionTimer = null;
    }
    function finish() {
      if (!active) return;
      clearCompletionTimer();
      interruptGame();
      const session = { ...active, endedAt: new Date().toISOString() };
      model.persistActive(null);
      active = null;
      // Empty sessions are discarded instead of being counted in progress.
      if (session.attempts.length) model.saveSession(session);
      lastFinished = session.attempts.length ? session : null;
      renderBanner();
      open();
      renderStats();
    }
    launch.addEventListener("pointerdown", () => { launchKeyboardOpen = false; });
    launch.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") launchKeyboardOpen = true;
    });
    launch.addEventListener("click", open);
    closeButton.addEventListener("click", () => close());
    overlay.addEventListener("click", () => close());
    startButton.addEventListener("click", () => {
      if (active) return;
      interruptGame();
      lastFinished = null;
      active = model.newSession(selected);
      model.persistActive(active);
      renderBanner();
      close({ toGame: true });
    });
    endButton.addEventListener("click", finish);
    function onOutcome(next) {
      if (!active || !["false-start", "result"].includes(next.phase)) return;
      const ms = next.phase === "result" ? next.resultMs : null;
      const updated = model.addAttempt(active, ms);
      if (!updated) return;
      active = updated;
      model.persistActive(active);
      const completed = active.attempts.length >= active.target;
      renderBanner(t(completed ? "trainingFinishHint" : next.phase === "result" ? "trainingNextHint" : "trainingFalseHint"));
      if (completed) {
        clearCompletionTimer();
        completionTimer = setTimeout(finish, 1100);
      }
    }
    function beforeActivate() {
      if (!active || active.attempts.length < active.target) return false;
      finish();
      return true;
    }
    document.addEventListener("keydown", (event) => {
      if (modal.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const controls = [...modal.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
      if (!controls.length) { event.preventDefault(); modal.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener("focusin", (event) => {
      if (!modal.hidden && !modal.contains(event.target)) closeButton.focus({ preventScroll: true });
    });
    renderBanner();
    if (active && active.attempts.length >= active.target) completionTimer = setTimeout(finish, 0);
    return {
      open, close, onOutcome, beforeActivate,
      get active() { return !!active; },
      get isOpen() { return !modal.hidden; },
      renderLanguage: renderStats,
    };
  }
  root.F1StartTimerTrainingUI = Object.freeze({ init });
})(globalThis);
