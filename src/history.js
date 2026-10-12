/* Reaction History panel: local data only, using DOM APIs (no HTML injection). */
(function (root) {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const svgNode = (name, attrs = {}, content) => {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    if (content !== undefined) element.textContent = content;
    return element;
  };
  const element = (tag, className, text) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };

  function initReactionHistory({ t, getLanguage, getHistory, getBest, getSessionId, formatTime, historyStats, filterHistory, sessionFor, isValidRecord, onClear, onExport, onBackup, onPrepareImport, onRestore, canRestore, setStatus }) {
    const tabs = { preferences: $("tab-preferences"), history: $("tab-history") };
    const panels = { preferences: $("panel-preferences"), history: $("panel-history") };
    const confirmOverlay = $("history-confirm");
    const importOverlay = $("backup-confirm");
    const importButton = $("import-backup");
    const fileInput = $("backup-file");
    const importCancel = $("cancel-backup");
    const importConfirm = $("confirm-backup");
    let pendingImport = null;
    const cancelButton = $("cancel-clear");
    const confirmButton = $("confirm-clear");
    const clearButton = $("clear-history");
    const exportButton = $("export-history");
    const filter = $("history-filter");
    const period = $("history-period");
    const chart = $("history-chart");
    let activeTab = "history";

    function selectTab(name, focus = false) {
      if (name !== activeTab) {
        setStatus("");
        // Each mobile tab should open at its own beginning, not midway
        // through the scroll position left by the previous tab.
        $("settings-panel-title").closest(".extras-content").querySelector(".settings-body").scrollTop = 0;
      }
      activeTab = name;
      for (const key of Object.keys(tabs)) {
        const selected = key === name;
        tabs[key].setAttribute("aria-selected", String(selected));
        tabs[key].tabIndex = selected ? 0 : -1;
        panels[key].hidden = !selected;
      }
      if (focus) tabs[name].focus();
    }
    for (const name of Object.keys(tabs)) tabs[name].addEventListener("click", () => selectTab(name));
    $("tab-history").parentElement.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") selectTab("preferences", true);
      else if (event.key === "End") selectTab("history", true);
      else selectTab(activeTab === "history" ? "preferences" : "history", true);
    });
    filter.addEventListener("change", render);
    period.addEventListener("change", () => { filter.value = "3"; render(); });
    exportButton.addEventListener("click", onExport);
    $("export-backup").addEventListener("click", onBackup);
    importButton.addEventListener("click", () => {
      if (!canRestore()) { setStatus(t("backupTrainingActive")); return; }
      fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      if (!canRestore()) { setStatus(t("backupTrainingActive")); return; }
      if (file.size > root.F1StartTimerBackup.MAX_BYTES) { setStatus(t("backupTooLarge")); return; }
      try {
        const text = await file.text();
        const imported = onPrepareImport(text);
        if (!$('extras').open) return;
        showImportConfirmation(imported);
      } catch (error) {
        setStatus(t(error?.message === "backup-too-large" ? "backupTooLarge" : "backupInvalid"));
      }
    });

    function setTextWithUnit(target, value) {
      target.replaceChildren();
      if (value === null) { target.textContent = "—"; return; }
      target.append(document.createTextNode(`${formatTime(value)} `), element("small", "", "s"));
    }

    function setConsistency(target, value) {
      target.replaceChildren();
      if (value === null) { target.textContent = "—"; return; }
      target.append(document.createTextNode(`${Math.round(value)} `), element("small", "", "ms"));
    }

    function renderChart(entries) {
      const ordered = entries.slice(0, 10).reverse();
      const title = svgNode("title", {}, t("chartTitle", { count: ordered.length }));
      const desc = svgNode("desc", {}, t("chartDescription"));
      chart.replaceChildren(title, desc);
      $("history-chart-summary").textContent = ordered.length
        ? t("chartA11yValues", { values: ordered.map((entry) => Math.round(entry.ms)).join(", ") })
        : t("noChartData");
      if (!ordered.length) {
        chart.append(svgNode("text", { x: 210, y: 74, "text-anchor": "middle", fill: "#59616b", "font-size": 13 }, t("noChartData")));
        return;
      }
      const values = ordered.map((item) => item.ms);
      const min = Math.min(...values);
      const max = Math.max(...values);
      // Dynamic axis supports unusually fast/slow results without clipping.
      const margin = Math.max(20, (max - min) * 0.25);
      const low = Math.max(0, Math.floor((min - margin) / 10) * 10);
      const high = Math.max(low + 50, Math.ceil((max + margin) / 10) * 10);
      const plot = { left: 39, right: 410, top: 16, bottom: 117 };
      const yFor = (ms) => plot.top + (high - ms) / (high - low) * (plot.bottom - plot.top);
      for (const tick of [0, 0.5, 1]) {
        const ms = low + (high - low) * tick;
        const y = yFor(ms);
        chart.append(
          svgNode("line", { x1: plot.left, x2: plot.right, y1: y.toFixed(1), y2: y.toFixed(1), stroke: "#ebeef1", "stroke-dasharray": "3 4" }),
          svgNode("text", { x: 31, y: (y + 3).toFixed(1), "text-anchor": "end", "font-size": 10, fill: "#59616b" }, String(Math.round(ms)))
        );
      }
      const positions = ordered.map((attempt, i) => ({
        x: plot.left + (plot.right - plot.left) * (ordered.length === 1 ? 0.5 : i / (ordered.length - 1)),
        y: yFor(attempt.ms), ms: attempt.ms,
      }));
      const line = positions.map((pos, i) => `${i ? "L" : "M"} ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`).join(" ");
      const first = positions[0];
      const last = positions[positions.length - 1];
      const gradient = svgNode("linearGradient", { id: "history-area-fill", x1: "0%", y1: "0%", x2: "0%", y2: "100%" });
      gradient.append(svgNode("stop", { offset: "0%", "stop-color": "#e10600", "stop-opacity": ".14" }), svgNode("stop", { offset: "100%", "stop-color": "#e10600", "stop-opacity": "0" }));
      const defs = svgNode("defs");
      defs.append(gradient);
      chart.append(defs,
        svgNode("path", { d: `${line} L ${last.x.toFixed(1)} ${plot.bottom} L ${first.x.toFixed(1)} ${plot.bottom} Z`, fill: "url(#history-area-fill)" }),
        svgNode("path", { d: line, fill: "none", stroke: "#e10600", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" })
      );
      positions.forEach((pos, index) => {
        const circle = svgNode("circle", { cx: pos.x.toFixed(1), cy: pos.y.toFixed(1), r: 4.6, fill: "#fff", stroke: "#e10600", "stroke-width": 2.2 });
        circle.append(svgNode("title", {}, t("chartPoint", { count: index + 1, ms: Math.round(pos.ms) })));
        chart.append(circle);
      });
    }

    let dateLanguage = null;
    let dayFormatter;
    let clockFormatter;
    function formatAttemptDate(iso) {
      const date = new Date(iso);
      const language = getLanguage();
      if (language !== dateLanguage) {
        dateLanguage = language;
        dayFormatter = new Intl.DateTimeFormat(language, { month: "short", day: "numeric" });
        clockFormatter = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" });
      }
      const current = new Date();
      const isToday = date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth() && date.getDate() === current.getDate();
      const day = isToday ? t("today") : dayFormatter.format(date);
      const clock = clockFormatter.format(date);
      return `${day}, ${clock}`;
    }

    function renderAttempts(history, bestMs, hasSavedAttempts) {
      const list = $("attempt-list");
      if (!history.length) {
        const empty = element("li", "history-empty");
        empty.append(element("strong", "", t(hasSavedAttempts ? "noMatchingAttempts" : "noAttempts")),
          document.createTextNode(t(hasSavedAttempts ? "changeHistoryPeriod" : "noAttemptsHint")));
        list.replaceChildren(empty);
        return;
      }
      const visible = filter.value === "all" ? history : history.slice(0, 3);
      const fragment = document.createDocumentFragment();
      let previousSession = null;
      visible.forEach((attempt, i) => {
        const session = sessionFor(attempt);
        if (previousSession !== session) {
          const heading = element("li", "history-session-heading");
          const name = session === "legacy" ? t("earlierAttempts") :
            session === getSessionId() ? t("currentSession") : t("previousSession");
          heading.append(element("span", "", name),
            element("small", "", session === "legacy" ? t("beforeSessions") : formatAttemptDate(attempt.at)));
          fragment.append(heading);
          previousSession = session;
        }
        const li = element("li", "history-attempt");
        const number = element("span", "history-attempt-number", String(history.length - i).padStart(2, "0"));
        const detail = element("div", "history-attempt-info");
        detail.append(element("span", "history-attempt-title", t(i === 0 ? "latestAttempt" : "reactionTest")), element("span", "history-attempt-date", formatAttemptDate(attempt.at)));
        const right = element("div", "history-attempt-result");
        right.append(element("span", "history-attempt-time", `${formatTime(attempt.ms)} s`));
        if (isValidRecord(attempt.ms) && bestMs !== null && Math.abs(attempt.ms - bestMs) < 0.00001) {
          right.append(element("span", "history-record", t("recordBadge")));
        }
        li.append(number, detail, right);
        fragment.append(li);
      });
      list.replaceChildren(fragment);
    }

    function render() {
      const allHistory = getHistory();
      const history = filterHistory(allHistory, period.value, getSessionId());
      const stats = historyStats(history);
      $("stored-count").textContent = t("storedCount", { count: allHistory.length, max: 50 });
      setTextWithUnit($("best-stat"), getBest());
      setTextWithUnit($("avg-stat"), stats.averageMs);
      setTextWithUnit($("median-stat"), stats.medianMs);
      setTextWithUnit($("slowest-stat"), stats.slowestMs);
      setConsistency($("consistency-stat"), stats.consistencyMs);
      $("trials-stat").textContent = String(stats.count);
      $("session-count").textContent = t(stats.sessions === 1 ? "sessionsOne" : "sessionsMany", { count: stats.sessions });
      $("all-attempts-option").textContent = t("allAttempts", { count: stats.count });
      filter.disabled = !stats.count;
      // Export and clearing always operate on the *entire* saved history.
      exportButton.disabled = !allHistory.length;
      clearButton.disabled = !allHistory.length;
      renderChart(history);
      renderAttempts(history, getBest(), allHistory.length > 0);
    }

    function showConfirmation() {
      if (clearButton.disabled) return;
      confirmOverlay.hidden = false;
      $("settings-panel-title").closest(".settings-head").inert = true;
      $("settings-panel-title").closest(".extras-content").querySelector(".settings-body").inert = true;
      cancelButton.focus();
    }
    function showImportConfirmation(imported) {
      pendingImport = imported;
      $("backup-confirm-description").textContent = t("backupConfirmDescription", {
        attempts: imported.history.length, sessions: imported.trainingSessions.length,
      });
      importOverlay.hidden = false;
      $("settings-panel-title").closest(".settings-head").inert = true;
      $("settings-panel-title").closest(".extras-content").querySelector(".settings-body").inert = true;
      importCancel.focus();
    }
    function dismissConfirmation() {
      if (confirmOverlay.hidden && importOverlay.hidden) return false;
      const wasImport = !importOverlay.hidden;
      confirmOverlay.hidden = true;
      importOverlay.hidden = true;
      pendingImport = null;
      $("settings-panel-title").closest(".settings-head").inert = false;
      $("settings-panel-title").closest(".extras-content").querySelector(".settings-body").inert = false;
      (wasImport ? importButton : clearButton).focus();
      return true;
    }
    importCancel.addEventListener("click", dismissConfirmation);
    importConfirm.addEventListener("click", () => {
      if (!pendingImport) return;
      if (!canRestore()) { dismissConfirmation(); setStatus(t("backupTrainingActive")); return; }
      const attempts = pendingImport.history.length;
      const sessions = pendingImport.trainingSessions.length;
      const ok = onRestore(pendingImport);
      dismissConfirmation();
      if (!ok) { setStatus(t("backupRestoreFailed")); return; }
      filter.value = "3";
      period.value = "all";
      render();
      tabs.history.focus();
      setStatus(t("backupRestored", { attempts, sessions }));
    });
    clearButton.addEventListener("click", showConfirmation);
    cancelButton.addEventListener("click", dismissConfirmation);
    confirmButton.addEventListener("click", () => {
      if (!onClear()) { dismissConfirmation(); setStatus(t("clearFailed")); return; }
      dismissConfirmation();
      filter.value = "3";
      render();
      tabs.history.focus();
      setStatus(t("historyCleared"));
    });
    selectTab("history");
    render();
    return {
      render, selectTab, dismissConfirmation,
      get confirmationOpen() { return !confirmOverlay.hidden || !importOverlay.hidden; },
      get confirmationPanel() { return importOverlay.hidden ? confirmOverlay : importOverlay; },
    };
  }
  root.F1StartTimerHistory = Object.freeze({ initReactionHistory });
})(globalThis);
