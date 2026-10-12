/* Install prompt and offline app-shell registration; optional in unsupported browsers. */
(function (root) {
  "use strict";
  const installButton = document.getElementById("install-app");
  let pendingPrompt = null;
  const standalone = () => root.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  const hide = () => { installButton.hidden = true; };
  if (standalone()) hide();
  root.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (standalone()) return;
    pendingPrompt = event;
    installButton.hidden = false;
  });
  root.addEventListener("appinstalled", () => { pendingPrompt = null; hide(); });
  installButton.addEventListener("click", async () => {
    if (!pendingPrompt) return;
    const event = pendingPrompt;
    pendingPrompt = null;
    hide();
    try {
      await event.prompt();
      await event.userChoice;
    } catch { /* Install prompts are browser-specific; installation remains optional. */ }
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    root.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
        console.warn("Offline installation is unavailable:", error);
      });
    });
  }
})(globalThis);
