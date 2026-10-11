/* Browser UI: progressively enhances the original visible HTML. */
(function () {
  "use strict";
  const core = globalThis.F1StartTimerGame;
  const root = document.getElementById("game-control");
  if (!root || !core) {
    if (root) root.setAttribute("aria-label", "Game scripts failed to load");
    console.error("F1 Start Timer: game engine was not loaded");
    return;
  }

  const { PHASE, createReactionGame, loadBest, saveBest, formatTime, isValidRecord } = core;
  const strips = [...root.querySelectorAll(".light-container")];
  const score = document.getElementById("result");
  const bestElement = document.getElementById("best");
  const lights = document.getElementById("lights-container");
  const announcement = document.getElementById("announcement");

  // Optional override: enter your GitHub username here. When empty, GitHub
  // Pages automatically uses the username from https://USERNAME.github.io/.
  const GITHUB_USERNAME = "nicolazhou";
  const pagesOwner = /^([a-z\d-]+)\.github\.io$/i.exec(location.hostname)?.[1];
  const creatorUsername = (GITHUB_USERNAME || pagesOwner || "").trim();
  if (/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(creatorUsername)) {
    const creatorLink = document.getElementById("creator-link");
    creatorLink.href = `https://github.com/${creatorUsername}`;
    creatorLink.textContent = `@${creatorUsername}`;
    document.getElementById("credits").hidden = false;
  }

  let announcedPhase = PHASE.IDLE;
  let best = loadBest();
  bestElement.textContent = `Your best: ${formatTime(best)}`;

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
      // Announce transitions, not each of the five intermediate light updates.
      if (next.phase !== announcedPhase) {
        announcement.textContent = announcements[next.phase];
        announcedPhase = next.phase;
      }
      if (next.phase === PHASE.FALSE_START) score.textContent = "JUMP START!";
      else if (next.phase === PHASE.INTERRUPTED) score.textContent = "INTERRUPTED";
      else if (next.phase === PHASE.RESULT) score.textContent = formatTime(next.resultMs);
      else score.textContent = "00.000";

      // Only plausible, persistable times may become a personal best.
      if (next.phase === PHASE.RESULT && isValidRecord(next.resultMs) &&
        (best === null || next.resultMs < best)) {
        best = next.resultMs;
        saveBest(best);
        bestElement.textContent = `Your best: ${formatTime(best)}`;
      }
    },
  });

  function activate() {
    if (document.visibilityState === "hidden") return;
    game.activate();
  }
  document.addEventListener("pointerdown", (event) => {
    // The play area still reacts to presses anywhere except the author link.
    if (event.target.closest("#credits")) return;
    if (event.isPrimary && event.button === 0) activate();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) activate();
  });
  root.addEventListener("click", (event) => {
    // Keyboard and assistive-technology clicks have no pointer details.
    if (event.detail === 0) activate();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") game.interrupt();
  });
  window.addEventListener("pagehide", () => game.interrupt());
  window.addEventListener("blur", () => game.interrupt());
})();
