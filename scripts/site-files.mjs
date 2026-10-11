// Single allowlist used by development hosting, build, and browser checks.
// Every path is project-relative; private files are never published or served.
export const SITE_FILES = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["src/game.js", "text/javascript; charset=utf-8"],
  ["src/options.js", "text/javascript; charset=utf-8"],
  ["src/main.js", "text/javascript; charset=utf-8"],
  ["src/style.css", "text/css; charset=utf-8"],
  ["public/favicon.ico", "image/x-icon"],
  ["public/favicon-32x32.png", "image/png"],
  ["public/favicon-16x16.png", "image/png"],
  ["public/apple-touch-icon.png", "image/png"],
  ["README.md", "text/plain; charset=utf-8"],
]);
