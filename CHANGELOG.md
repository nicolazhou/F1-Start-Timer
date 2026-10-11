# Changelog

## 1.2.0 — Optional sounds, accessibility settings and results sharing

- Kept the original white racing lights and stopwatch design; added a collapsed **Settings & Results** panel below the game.
- Added opt-in Web Audio effects for each light, lights out and jump starts; sound is off by default and requires a user gesture.
- Added persisted high-contrast, reduced-motion and text-size options with safe storage fallbacks.
- Added recent result history (up to 50 on-device rounds), clipboard/native sharing and CSV export, without accounts or network APIs.
- Kept the creator credit independent from gameplay and prevented settings/share interactions from starting rounds.
- Expanded unit and browser smoke tests; preserved dependency-free GitHub Pages builds.
- Removed the oversized blue keyboard-focus frame around the game board, retaining subtle underlined instructions as the focus indicator.


## 1.1.0 — Version reset and record integrity fix

- Removed the obsolete GitHub branch ruleset template and its brittle configuration-matching test; CI continues to test builds and gameplay.
- Added an English TODO / Roadmap to the README, including planned multilingual support.

- Simplified CI validation: removed README/license-text and fixed-copy assertions and hardcoded asset counts. Kept runtime, build, file existence and security checks.

- Set the public project version to **1.1.0** in `package.json`, `package-lock.json` and README. This deliberately resets the previous 2.x numbering; historical release entries below are retained as release history.
- Fixed a personal-best bug: invalid results (under 0.5 ms or over 60 seconds) could appear as the current session's best even though storage rejected them, potentially leaving a misleading `00.000` best that prevented normal results from improving it.
- Reused a single strict numeric record-validation function for stored records and the on-screen best; added tests for boundary conditions and UI behavior.
- Added an automated check keeping the release number aligned in package metadata, README and changelog.
- Kept the original appearance, favicon, Github creator credit, GitHub Pages workflow and Dependabot unchanged.
- Restored the standard arrow cursor over the game area (keeping the hand on the GitHub link) and simplified the start instructions.

## 2.3.2 — GitHub creator CI fix

- Fixed a false failure in the Chrome smoke test when `GITHUB_USERNAME` is configured and the credit is visible during local preview.
- Verify the visible credit URL and label instead of requiring it to be hidden unconditionally.
- Wait for the correct URL to load during HTTP browser checks to avoid testing a previous page while navigation is pending.
- Keep the original visual design, game logic, GitHub Pages workflow and Dependabot unchanged.

## 2.3.1 — Clickable GitHub creator credit

- Added a discreet creator credit and GitHub profile link below the personal-best time, without changing the original lights or stopwatch styling.
- Automatically infer the GitHub account from standard GitHub Pages hosts; optionally override the handle in one line of `src/main.js`.
- Keep the creator link separate from the keyboard-accessible game control so following it never triggers the timer.
- Extended source and browser verification for the creator credit while preserving existing CI and Dependabot.

## 2.3.0 — Branch protection preparation and legal notice consolidation

- Enabled the existing test/browser verification job on pull requests. Publishing to GitHub Pages remains limited to pushes and manual workflow runs.
- Removed standalone `THIRD_PARTY_NOTICES.md` and preserved its full original upstream MIT license and copyright in `README.md`, which is now included in the published build.
- Strengthened build verification to check the published README still contains the required upstream copyright and permission text.
- Updated README with guidance for optional site credits.
- Preserved original HTML, CSS, favicon, gameplay, and Dependabot configuration without modification.

## 2.2.0 — Cleanup and automated dependency maintenance

- Restored Dependabot for weekly GitHub Actions and npm update checks (no npm dependencies are currently installed).
- Consolidated published-file declarations, content types, development server and browser-test allowlists into `scripts/site-files.mjs`. The build now copies only explicitly listed public files.
- Removed the redundant repository-root `.nojekyll`; the production build still generates `dist/.nojekyll`.
- Removed old project-name references from the source code, documentation, CSS comments and tests. The record migration keeps the generic `best` key but no longer reads an older project-specific storage key.
- Preserved all required upstream MIT notices, visual styles, favicon, game logic and GitHub Pages workflow.

## 2.1.0 — Reliability, accessibility and security

This update **does not redesign the game**. The original white background, black light housings, red bulbs, game instructions, centered result and click-anywhere control remain.

- Added a real Chromium/Chrome integration smoke test in GitHub Actions covering page startup, keyboard and pointer controls, jump starts, a completed round, stored best time on reload and mobile overflow. With browsers that block all navigation by administrator policy, the local test reports a reduced in-browser DOM test instead.
- Hardened the local development server: binds to `127.0.0.1`, allows only specific public game files, denies private files and non-GET/HEAD requests, and sets `nosniff` and `no-store` headers.
- Recovered valid legacy best times if a newer storage key is malformed. Rejected implausible stored best times that would round to `00.000` or exceed 60 seconds. Extreme times can still be displayed for an individual round.
- Corrected stopwatch formatting by rounding integer milliseconds before converting to seconds.
- Preserved the `main` landmark and stable visually hidden page heading. Added a separate keyboard-focusable game control and one status announcement per state transition, rather than one every second.
- Copied mandatory upstream MIT notices into the published `dist/` folder without adding a root `LICENSE` file.
- Added social-sharing title and description metadata, and removed two unused large PNG icons from the release while retaining the supplied favicon and touch icon.
- Expanded no-dependency syntax/static lint checks, unit and local server security tests; improved generated asset validation.
- Modernized GitHub Actions to Node 24-compatible releases, pinned four Actions by full commit SHA and pinned the remaining Pages upload Action to its v5.0.0 release tag.

## 2.0.0 — Stable static release

- Replaced the earlier Vue/Vite build with a dependency-free HTML, CSS and JavaScript implementation to prevent previous blank-screen startup errors.
- Restored the original five-light visual style with responsive layout.
- Preserved improved timer logic, best-score storage, the custom favicon, English README and GitHub Pages deployment workflow.
