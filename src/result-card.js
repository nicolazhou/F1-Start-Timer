/* Fully local, deterministic Canvas image cards; no network or external fonts. */
(function (root) {
  "use strict";
  const WIDTH = 1200;
  const HEIGHT = 630;
  function rounded(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function createCard({ ms, bestMs, formatTime, label = "Reaction time", bestLabel = "Personal best", language = "en", date = new Date() }) {
    if (!Number.isFinite(ms) || ms < 0 || typeof formatTime !== "function") throw new TypeError("Invalid card time");
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    // Background + racing accent, intentionally not an official Formula 1 logo.
    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, "#10161f");
    bg.addColorStop(1, "#222935");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#e10600";
    ctx.fillRect(0, 0, WIDTH, 13);
    ctx.fillStyle = "rgba(255,255,255,.045)";
    for (let i = 0; i < 10; i++) {
      ctx.save();
      ctx.translate(850 + i * 65, 0);
      ctx.rotate(0.33);
      ctx.fillRect(0, -30, 22, 750);
      ctx.restore();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "700 35px system-ui, -apple-system, sans-serif";
    ctx.fillText("F1 START TIMER", 75, 99);
    ctx.fillStyle = "#adb7c7";
    ctx.font = "600 23px system-ui, -apple-system, sans-serif";
    ctx.fillText(String(label).toLocaleUpperCase(language), 75, 186);
    ctx.fillStyle = "#ffffff";
    ctx.font = "750 130px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${formatTime(ms)} s`, 65, 325);
    rounded(ctx, 75, 373, 440, 95, 16);
    ctx.fillStyle = "#303948";
    ctx.fill();
    ctx.fillStyle = "#aab7c8";
    ctx.font = "600 22px system-ui, -apple-system, sans-serif";
    ctx.fillText(bestLabel, 98, 410);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 35px system-ui, -apple-system, sans-serif";
    ctx.fillText(bestMs !== null && Number.isFinite(bestMs) ? `${formatTime(bestMs)} s` : "—", 98, 452);
    // Five illuminated columns, based on the game's existing start lights.
    for (let col = 0; col < 5; col++) {
      rounded(ctx, 770 + col * 64, 185, 52, 225, 12);
      ctx.fillStyle = "#050608";
      ctx.fill();
      for (let row = 0; row < 4; row++) {
        ctx.beginPath();
        ctx.arc(796 + col * 64, 213 + row * 54, 19, 0, Math.PI * 2);
        ctx.fillStyle = row >= 2 ? "#e10600" : "#414957";
        ctx.fill();
      }
    }
    ctx.fillStyle = "#9faab9";
    ctx.font = "500 20px system-ui, -apple-system, sans-serif";
    let dateText;
    try { dateText = date.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" }); }
    catch { dateText = date.toISOString().slice(0, 10); }
    ctx.fillText(dateText, 76, 562);
    ctx.textAlign = "right";
    ctx.fillText("f1-start-timer", 1120, 562);
    return canvas.toDataURL("image/png");
  }
  function toFile(dataUrl, name) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) throw new TypeError("Expected a PNG data URL");
    const bytes = atob(dataUrl.slice("data:image/png;base64,".length));
    const buffer = Uint8Array.from(bytes, (char) => char.charCodeAt(0));
    return new File([buffer], name, { type: "image/png" });
  }
  function download(dataUrl, name) {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  root.F1StartTimerCard = Object.freeze({ createCard, toFile, download, WIDTH, HEIGHT });
})(globalThis);
