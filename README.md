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


### More cross-browser testing

The optional Playwright integration suite checks the **production build** in three browser engines (Chromium, Firefox, WebKit), including keyboard/Tab/Escape operation, settings and history tabs, graph and clear confirmation, translated strings, localStorage after reload, mobile and landscape widths, and full reaction rounds. It also simulates touch interaction and mobile Safari-style layout using WebKit, plus Android-style touch using Chromium. **These are engine/device emulations, not tests on physical iPhones.**

```bash
python3 -m pip install playwright==1.57.0
python3 -m playwright install chromium firefox webkit
npm run test:cross-browser
```

On Linux, browser runtime dependencies may also be needed (`python3 -m playwright install --with-deps chromium firefox webkit`). Run only one engine with `python3 scripts/cross-browser-test.py --browser firefox` after `npm run build`. The GitHub Actions workflow installs and runs all three on every pull request and push before deployment. Browser tooling is **test-only**; the deployed site retains zero JavaScript/npm dependencies. For the final physical-device check, manually confirm VoiceOver/Tab focus, tap targets, and viewport fit on a real iOS Safari device and Android Firefox/Chrome.

Useful individual commands:

```bash
npm test
npm run lint
npm run build
npm run audit
```

The application and build scripts have **zero npm dependencies**, so `npm install` is unnecessary. Dependabot monitors GitHub Actions and will also check any future npm dependencies. `npm audit` checks the empty dependency tree; it cannot identify application logic bugs.

## TODO / Roadmap

Implemented features are marked complete; items left unchecked are future ideas. The original minimalist lights-and-stopwatch design remains the default.

- [X] **Multiple languages:** add Italian, Spanish, French and German alongside English, with a manual language switcher and an optional browser-language default.
- [X] **Optional sound effects:** play a subtle lights-out cue, with a mute toggle and no automatic audio until user interaction.
- [X] **Reaction history:** personal best, mean reaction time, total saved attempts, last-10 graph, recent/all list, CSV export and confirmed history clearing, stored only on the device.
- [X] **Personalization:** provide optional settings for text size, higher contrast and reduced animations, with the accessible settings modal from the mockup.
- [X] **Share or export results:** let players copy or download their times without requiring accounts or sending data to a server.
- [X] **More cross-browser testing:** automated Chromium, Firefox, WebKit, simulated mobile touch, responsive layout and keyboard accessibility checks; physical-device validation remains recommended.

Ideas and contributions are welcome; none of these changes is required for the current game to work.

## Project layout

```text
index.html                       Accessible game markup and social metadata
src/style.css                    Original design and responsive rules
src/game.js                      Reaction timer and personal-best storage
src/main.js                      Input, light rendering and announcements
src/history.js                   Reaction-history tabs, chart, metrics and confirmation
public/                          Favicons, Apple touch icon, Bootstrap Icons gear and MIT license
scripts/site-files.mjs          Shared public-asset allowlist and MIME types
scripts/serve.mjs                Localhost-only allowlisted development server
scripts/build.mjs                Dependency-free production build
scripts/check-source.mjs         Source, syntax and HTML/CSS checks
scripts/browser-test.mjs         Chrome/Chromium smoke and responsive tests
scripts/cross-browser-test.py    Playwright Chromium/Firefox/WebKit and touch tests
scripts/verify-build.mjs         Output/asset verification
tests/                            Game, storage and server tests
.github/workflows/pages.yml      GitHub Pages build, tests and deployment
.github/dependabot.yml           Weekly GitHub Actions and npm update checks
```
