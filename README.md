# F1 Start Timer

A lightweight Formula 1 starting-lights reaction-time game. Five red light columns illuminate in sequence; wait for **lights out**, then react as quickly as possible. Your personal best is stored locally in your browser.


## How to play

- **Mouse / touchscreen:** press anywhere on the game area to begin; press again after all lights switch off.
- **Keyboard:** use `Tab` to focus the game, then press `Enter` or `Space`.
- Pressing too early displays **JUMP START!** and cancels the remaining timers.
- Switching browser tabs, blurring the window, or leaving the page interrupts an active round so throttled timers cannot yield misleading results.
- Only plausible reaction times (0.5–60,000 ms) can become a personal best. Extreme results are still displayed but cannot overwrite a valid record. The best valid result is saved in `localStorage`. The generic `best` record format from early versions remains supported.

Reaction times are **estimates**, not calibrated measurements: display refresh, browser scheduling and input-device latency can influence the recorded value. The game uses `performance.now()` and `requestAnimationFrame()` but cannot know the exact moment pixels become visible on your monitor.

## Run locally

You can open `index.html` directly without installing anything. Alternatively, with **Node.js 20+**:

```bash
npm run dev
```

Open <http://127.0.0.1:4173/>. The development server listens **only on your computer** and only serves game files and the project README containing the required legal notice; it does not expose development files such as `.env`, scripts, tests or `package.json`.

## Tests, quality checks and build

```bash
npm run check
```

This runs automated unit and server-security tests, Node syntax checks and project-specific static lint rules, generates `dist/` from an explicit public-file allowlist and checks that published assets exist. It does not check README wording, version strings or exact instruction text. The dependency-free lint checks are **not a replacement for a full ESLint rule set**.

For a real Chrome/Chromium smoke test of the generated site:

```bash
npm run test:browser
```

This command builds the site automatically, then checks startup at `/` and `/f1-start-timer/`, UI state, keyboard and pointer input, jump starts, a completed round, saved record on reload, and horizontal overflow at mobile/tablet/desktop widths. Set `CHROME_BIN` to the browser executable if needed. On restricted machines where Chromium blocks navigation by administrator policy, the test instead exercises the real DOM and game logic in-browser without network navigation, and reports that limitation. **GitHub Actions executes the HTTP-based version** on its hosted runner.

Useful individual commands:

```bash
npm test
npm run lint
npm run build
npm run audit
```

The application and build scripts have **zero npm dependencies**, so `npm install` is unnecessary. Dependabot monitors GitHub Actions and will also check any future npm dependencies. `npm audit` checks the empty dependency tree; it cannot identify application logic bugs.

## TODO / Roadmap

These are **planned improvements**, not features available in v1.1.0. The original minimalist lights-and-stopwatch design will remain the default.

- [X] **Multiple languages:** add Italian, Spanish, French and German alongside English, with a manual language switcher and an optional browser-language default.
- [X] **Optional sound effects:** play a subtle lights-out cue, with a mute toggle and no automatic audio until user interaction.
- [ ] **Reaction history:** show recent attempts and simple statistics (average, fastest, slowest), stored only on the device.
- [ ] **Personalization:** provide optional settings for text size, higher contrast and reduced animations.
- [X] **Share or export results:** let players copy or download their times without requiring accounts or sending data to a server.
- [ ] **More cross-browser testing:** expand checks for mobile Safari, Firefox, touch interaction and keyboard accessibility.

Ideas and contributions are welcome; none of these changes is required for the current game to work.

## Project layout

```text
index.html                       Accessible game markup and social metadata
src/style.css                    Original design and responsive rules
src/game.js                      Reaction timer and personal-best storage
src/main.js                      Input, light rendering and announcements
public/                          Favicon and Apple touch icon
scripts/site-files.mjs          Shared public-asset allowlist and MIME types
scripts/serve.mjs                Localhost-only allowlisted development server
scripts/build.mjs                Dependency-free production build
scripts/check-source.mjs         Source, syntax and HTML/CSS checks
scripts/browser-test.mjs         Chrome/Chromium smoke and responsive tests
scripts/verify-build.mjs         Output/asset verification
tests/                            Game, storage and server tests
.github/workflows/pages.yml      GitHub Pages build, tests and deployment
.github/dependabot.yml           Weekly GitHub Actions and npm update checks
```
