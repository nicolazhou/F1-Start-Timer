# Accessibility & mobile performance audit — v1.7.3

This document records **automated checks and code corrections**, not a WCAG certification or a claim of testing physical phones or assistive technologies. Check the manual matrix below before publicly claiming WCAG 2.2 AA conformance.

## Accessibility fixes

| Area | Change | Automated verification |
| --- | --- | --- |
| Keyboard focus | The game has a visible, Tab-only blue outline around its instruction; pointer input does not introduce a persistent focus ring. Existing Tab/Shift+Tab/Esc modal handling remains. | `tests/accessibility.test.js`, `scripts/browser-test.mjs`, `scripts/cross-browser-test.py` |
| Modal accessibility | Opening Settings makes background game/training controls inert and takes the trigger out of the Tab order. Opening Training makes the main page inert. The background returns on close; nested confirmations preserve focus containment. | `tests/uiRecord.test.js`, Chromium smoke, cross-browser tests |
| Screen reader results | Live announcements live **outside** the `role="button"` container. The final measured time is read once as text; the visual count-up remains `aria-live="off"` to prevent excessive output. | Unit/static tests and Chromium DOM test |
| Charts | Reaction History and Training trend charts provide localized text alternatives with numerical millisecond values in chronological order. | Unit/static tests and Chromium smoke |
| Training progress | Training progress has `role="progressbar"` with a translated label and updated min/max/current values. | Unit/static tests and Chromium smoke |
| Small text | Secondary labels use `#555d66` instead of light grey on white/near-white. Contrast checks cover selected examples: 4.5:1 for small text, white on primary and destructive buttons. | `tests/accessibility.test.js` contrast calculations |
| Touch | On coarse pointers, key buttons and selects have at least 44px target height; selects use 16px type to avoid iOS focus zoom. | Static test and Playwright simulated touch check |
| System preferences | Existing reduced-motion, high-contrast and amber/blue patterned lights remain available. | Existing integration tests |

## Mobile performance changes

| Area | Earlier implementation | Current implementation |
| --- | --- | --- |
| Visible live stopwatch | DOM text updated on every animation frame, often ~60 times/second | Updates via a 40ms delay followed by `requestAnimationFrame` (typically ~18–25 paints/second). Reaction timestamp is still obtained directly by the game engine. |
| Light board | Repeatedly queried all lamps for each state change | Cached lamp nodes once, skips redraw when the illumination state does not change |
| History drawing | Chart and list redrawn even after a result while panel was closed | History redraw deferred until Settings opens or an active panel needs it |
| History date formatting | Multiple `Intl.DateTimeFormat` instances created per saved attempt | Two formatters reused for a language |

The visual stopwatch deliberately prioritizes lower rendering cost over showing every millisecond; **the final reaction measurement and the saved score are not throttled**. Smoke tests assert the live label updates without writing on every animation frame and freezes correctly at the precise result. Frame rates vary with device load and refresh rate; this is not a measured benchmark on a physical low-end phone.

## Commands

```bash
npm run check
npm run test:browser
npm run test:cross-browser
```

`npm run check` includes the source/contrast/semantic tests without extra npm dependencies. The Chromium smoke test uses the production build. On locked-down environments where browser navigation is blocked, the smoke test executes an alternate real-DOM test; **it does not verify HTTP, service worker or reload in that fallback**. The optional Playwright suite needs browser engines installed and is configured in GitHub Actions.

## Manual acceptance matrix — still to verify on real devices

- **Windows + NVDA/Chrome or Firefox:** Tab to the game, start/false-start/finish with keyboard; listen for the final numeric score exactly once; verify modal title, tab names, filter labels, history and Training chart alternatives.
- **macOS/iOS + VoiceOver/Safari:** navigate by rotor/swipes through Settings and Training; check that background content cannot be reached while a dialog is open; confirm switch/slider/select names and values and focus return after dismissal.
- **Android + TalkBack/Chrome:** swipe navigation, accessibility labels, hit targets, no unintended reaction on modal interactions, and real tap response.
- **Windows high-contrast and 200%/400% zoom:** examine text contrast, active tab indication, forced colors, reachable dialog controls, and no content clipped when resizing to 320 CSS px.
- **Older/entry-level mobile hardware:** test repeated 5/10/20-round sessions with live timer both on and off. Measure perceived responsiveness, jank, touch latency and battery usage; compare using the same device and settings. Verify backgrounding always interrupts a round.
- **Browser matrix:** run `npm run test:cross-browser` in CI and, where possible, a real mobile Safari and Android browser. Automated engine emulation is **not** a substitute for physical-device testing.

## Known constraints

- Reaction time is an **estimate** affected by display, OS scheduling and device input latency; a faster redraw cannot eliminate those effects.
- The code/contrast checks target identified problem areas but **do not exhaustively evaluate every foreground/background combination** or every WCAG criterion. Manual assistive technology, zoom and touch audits remain open.
- Screen-reader speech is typically too delayed and variable to be a fair reaction trigger. Visual/audio gameplay remains primary; the spoken GO/result messages are for orientation and feedback.
