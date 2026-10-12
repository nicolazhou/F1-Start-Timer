#!/usr/bin/env python3
"""Real-browser integration suite: Chromium, Firefox and Safari's WebKit engine.

Install the optional test-only dependency:
  python3 -m pip install playwright==1.57.0
  python3 -m playwright install chromium firefox webkit
Then run `npm run test:cross-browser` (builds dist before testing).
This does NOT replace on-device iOS Safari / Android browser checks.
"""

import argparse
import contextlib
import http.server
import mimetypes
import os
from pathlib import Path
import threading

try:
    from playwright.sync_api import sync_playwright, expect
except ImportError as error:
    raise SystemExit("Install browser tests: python3 -m pip install playwright==1.57.0") from error

DIST = Path(__file__).resolve().parent.parent / "dist"
PATHS = {
    "index.html", "src/style.css", "src/game.js", "src/options.js",
    "src/i18n.js", "src/main.js", "src/history.js", "public/favicon.ico",
    "public/favicon-16x16.png", "public/favicon-32x32.png",
    "public/icons/gear.svg", "public/icons/chevron-down.svg",
    "public/apple-touch-icon.png", "README.md",
}


class StaticSite(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/f1-start-timer/"):
            path = path[len("/f1-start-timer"):]
        path = "index.html" if path == "/" else path.lstrip("/")
        if path not in PATHS:
            self.send_error(404)
            return
        try:
            body = (DIST / path).read_bytes()
        except FileNotFoundError:
            self.send_error(404, "Run npm run build first")
            return
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@contextlib.contextmanager
def serve():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), StaticSite)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def no_overflow(page, label):
    overflow = page.evaluate("""() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth
    })""")
    assert overflow["document"] <= overflow["width"] + 1, f"{label}: horizontal overflow {overflow}"


def run_engine(browser_type, base, engine_name):
    launch_options = {"headless": True}
    executable = os.environ.get(f"PLAYWRIGHT_{engine_name.upper()}_EXECUTABLE")
    if executable:
        launch_options["executable_path"] = executable
    browser = browser_type.launch(**launch_options)
    try:
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
        # Make the lights-out delay deterministic while preserving the original 1s light sequence.
        context.add_init_script("Math.random = () => 0")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda exception: errors.append(str(exception)))
        page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)

        for path in ("/", "/f1-start-timer/"):
            response = page.goto(base + path, wait_until="load")
            assert response is not None and response.status == 200, f"{engine_name}: {path} failed"
            expect(page.locator("#game-control")).to_have_attribute("aria-label", "Start reaction time test")
            assert page.locator(".light-container").count() == 5
            icon = page.locator("img.settings-gear")
            expect(icon).to_have_attribute("src", "./public/icons/gear.svg")
            assert icon.evaluate("img => img.complete && img.naturalWidth === 16")
            expect(page.locator("#extras summary")).to_have_text("Settings")
            expect(page.locator("#copy-result")).to_be_disabled()
            expect(page.locator("#export-results")).to_be_disabled()
            no_overflow(page, f"{engine_name} startup {path}")

        # Settings click, correct modal position and no accidental reaction starts.
        trigger = page.locator("#extras summary")
        trigger.click()
        expect(page.locator("#extras")).to_have_attribute("open", "")
        expect(page.locator(".extras-content")).to_be_visible()
        expect(page.locator("#close-settings")).to_be_focused()
        assert page.locator(".extras-content").get_attribute("role") == "dialog"
        assert page.locator(".extras-content").get_attribute("aria-modal") == "true"
        assert page.evaluate("document.documentElement.classList.contains('settings-open')")
        assert page.locator("#setting-sound").get_attribute("type") == "checkbox"
        expect(page.locator("#setting-green-lights")).not_to_be_checked()
        expect(page.locator("#setting-live-timer")).not_to_be_checked()
        expect(page.locator(".light.green")).to_have_count(0)
        assert page.locator("#setting-sound + .switch-track").count() == 1
        assert page.locator("#setting-sound").get_attribute("aria-hidden") is None
        expect(page.locator("#tab-history")).to_have_attribute("aria-selected", "true")
        expect(page.locator("#export-history")).to_be_disabled()
        page.locator("#tab-preferences").click()
        expect(page.locator("#panel-preferences")).to_be_visible()
        # Uniform arrows in Chromium, Firefox and WebKit, including Pages subpaths.
        for select_id in ("setting-scale", "setting-language", "history-filter", "history-period"):
            style = page.locator(f"#{select_id}").evaluate("""node => ({
                appearance: getComputedStyle(node).appearance,
                image: getComputedStyle(node).backgroundImage,
                padding: parseFloat(getComputedStyle(node).paddingRight),
            })""")
            assert style["appearance"] == "none", f"{engine_name}: {select_id} has native arrow"
            assert "chevron-down.svg" in style["image"], f"{engine_name}: {select_id} missing chevron"
            assert style["padding"] >= 30, f"{engine_name}: {select_id} arrow overlaps label"
        page.locator("#close-settings").focus()
        page.keyboard.press("Shift+Tab")
        expect(page.locator("#setting-language")).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.locator("#close-settings")).to_be_focused()

        green = page.locator("#setting-green-lights")
        green.check()
        expect(green).to_be_checked()
        page.locator("#setting-live-timer").check()
        expect(page.locator("#setting-live-timer")).to_be_checked()
        assert page.evaluate("JSON.parse(localStorage.getItem('f1-start-timer:settings')).greenLights") is True
        contrast = page.locator("#setting-contrast")
        contrast.check()
        expect(contrast).to_be_checked()
        assert page.evaluate("document.documentElement.dataset.highContrast") == "true"
        page.locator("#setting-scale").select_option("150")
        assert page.evaluate("document.documentElement.dataset.textScale") == "150"
        page.locator("#setting-language").select_option("it")
        assert page.evaluate("document.documentElement.lang") == "it"
        expect(page.locator("#settings-panel-title")).to_have_text("Impostazioni e risultati")
        expect(page.locator("#extras summary")).to_have_text("Impostazioni")
        expect(page.locator("#game-control")).to_have_attribute("aria-label", "Inizia il test dei riflessi")
        no_overflow(page, f"{engine_name} modal settings")

        page.keyboard.press("Escape")
        expect(page.locator("#extras")).not_to_have_attribute("open", "")
        expect(trigger).to_be_focused()
        assert not page.evaluate("document.documentElement.classList.contains('settings-open')")
        expect(page.locator("#game-control")).to_have_attribute("aria-label", "Inizia il test dei riflessi")
        # Persistence across a reload, including language and contrast.
        page.reload(wait_until="load")
        assert page.evaluate("document.documentElement.lang") == "it"
        assert page.evaluate("document.documentElement.dataset.highContrast") == "true"
        assert page.evaluate("document.documentElement.dataset.textScale") == "150"
        expect(page.locator("#setting-green-lights")).to_be_checked()
        expect(page.locator("#setting-live-timer")).to_be_checked()
        assert page.evaluate("JSON.parse(localStorage.getItem('f1-start-timer:settings')).liveTimer") is True
        assert page.evaluate("JSON.parse(localStorage.getItem('f1-start-timer:settings')).language") == "it"
        page.locator("#extras summary").click()
        page.locator("#setting-language").select_option("en")
        # Backdrop closes without activating the game.
        page.locator("#settings-backdrop").click(position={"x": 1, "y": 1}, force=True)
        expect(page.locator("#extras")).not_to_have_attribute("open", "")
        expect(page.locator("#game-control")).to_have_attribute("aria-label", "Start reaction time test")

        for width, height in [(320, 700), (360, 780), (375, 667), (568, 320), (600, 350), (768, 1024), (1280, 720)]:
            page.set_viewport_size({"width": width, "height": height})
            no_overflow(page, f"{engine_name}: {width}x{height}")
            page.locator("#extras summary").click()
            expect(page.locator("#close-settings")).to_be_visible()
            no_overflow(page, f"{engine_name} modal: {width}x{height}")
            page.keyboard.press("Escape")

        # Actual keyboard events, early jump start and a complete timed round.
        page.set_viewport_size({"width": 375, "height": 700})
        page.locator("#game-control").focus()
        page.keyboard.press("Enter")
        expect(page.locator(".light.on")).to_have_count(2)
        page.keyboard.press("Space")
        expect(page.locator("#result")).to_have_text("JUMP START!")
        no_overflow(page, f"{engine_name} jump-start")
        page.keyboard.press("Enter")
        expect(page.locator(".light.on")).to_have_count(10, timeout=6500)
        expect(page.locator("#game-control")).to_have_attribute("aria-label", "Stop the reaction time clock", timeout=4500)
        expect(page.locator(".light.green")).to_have_count(10)
        expect(page.locator(".light.on")).to_have_count(0)
        assert "green" in page.locator("#lights-container").get_attribute("aria-label").lower()
        page.wait_for_timeout(110)
        live_value = page.locator("#result").inner_text()
        assert live_value not in ("00.000", "JUMP START!"), "Timer must count up at lights-out"
        page.keyboard.press("Space")
        expect(page.locator(".light.green")).to_have_count(0)
        assert page.locator("#result").inner_text() not in ("00.000", "JUMP START!")
        final_value = page.locator("#result").inner_text()
        page.wait_for_timeout(70)
        assert page.locator("#result").inner_text() == final_value, "Timer must freeze at reaction"
        expect(page.locator("#copy-result")).to_be_enabled()
        expect(page.locator("#export-results")).to_be_enabled()
        expect(page.locator("#trials-stat")).to_have_text("1")
        assert page.locator("#history-chart circle").count() == 1
        expect(page.locator("#session-count")).to_have_text("1 session")
        page.locator("#extras summary").click()
        page.locator("#tab-history").click()
        expect(page.locator("#attempt-list .history-attempt")).to_have_count(1)
        with page.expect_download() as download_wait:
            page.locator("#export-history").click()
        download = download_wait.value
        assert download.suggested_filename == "f1-start-timer-results.csv"
        csv = Path(download.path()).read_bytes().decode("utf-8-sig")
        assert csv.startswith("timestamp_utc,reaction_ms,reaction_seconds\r\n")
        assert "eligible_for_best" not in csv
        assert len(csv.splitlines()) == 2
        expect(page.locator("#extras-status")).to_have_text("Exported 1 result as CSV.")
        expect(page.locator("#extras-status")).to_be_empty(timeout=6500)
        page.locator("#export-history").click()
        expect(page.locator("#extras-status")).to_have_text("Exported 1 result as CSV.")
        page.locator("#tab-preferences").click()
        expect(page.locator("#extras-status")).to_be_empty()
        page.locator("#tab-history").click()
        page.locator("#clear-history").click()
        expect(page.locator("#history-confirm")).to_be_visible()
        danger = page.locator("#confirm-clear")
        expect(danger).to_have_css("background-color", "rgb(210, 11, 6)")
        danger.hover()
        expect(danger).to_have_css("background-color", "rgb(170, 9, 4)")
        expect(danger).to_have_css("color", "rgb(255, 255, 255)")
        page.keyboard.press("Escape")
        expect(page.locator("#history-confirm")).to_be_hidden()
        expect(page.locator("#extras")).to_have_attribute("open", "")
        page.locator("#clear-history").click()
        page.locator("#confirm-clear").click()
        expect(page.locator("#trials-stat")).to_have_text("0")
        expect(page.locator("#export-history")).to_be_disabled()
        page.locator("#close-settings").click()
        page.locator("#extras summary").click()
        expect(page.locator("#extras-status")).to_be_empty()
        page.locator("#close-settings").click()
        result = page.locator("#best").inner_text()
        assert result.startswith("Your best: 00.")
        page.reload(wait_until="load")
        assert page.locator("#best").inner_text() == result
        assert page.evaluate("localStorage.getItem('f1-start-timer:history')") is None
        # Guard the 50-entry limit, reversed chart sequence and the full-list view.
        page.evaluate("""() => {
            const now = Date.now();
            localStorage.setItem('f1-start-timer:history', JSON.stringify(Array.from({length: 55}, (_, i) => ({
                at: new Date(now - i * 60000).toISOString(), ms: 195 + i
            }))));
        }""")
        page.reload(wait_until="load")
        page.locator("#extras summary").click()
        expect(page.locator("#trials-stat")).to_have_text("50")
        expect(page.locator("#stored-count")).to_have_text("50 of 50 saved")
        assert page.locator("#history-chart circle").count() == 10
        page.locator("#history-filter").select_option("all")
        expect(page.locator("#attempt-list .history-attempt")).to_have_count(50)
        # v1.4: old data has no session ID but remains visible and can be grouped.
        expect(page.locator("#session-count")).to_have_text("0 sessions")
        expect(page.locator(".history-session-heading")).to_have_count(1)
        assert page.locator("#median-stat").inner_text() != "—"
        assert page.locator("#slowest-stat").inner_text() != "—"
        assert "ms" in page.locator("#consistency-stat").inner_text()
        page.locator("#history-period").select_option("session")
        expect(page.locator("#trials-stat")).to_have_text("0")
        expect(page.locator("#export-history")).to_be_enabled()  # period does not limit export
        expect(page.locator(".history-empty")).to_contain_text("No matching attempts")
        page.locator("#history-period").select_option("all")
        expect(page.locator("#trials-stat")).to_have_text("50")
        # Seeding multiple new/old sessions tests date filters and persisted tab ID.
        page.evaluate("""() => {
            const id = sessionStorage.getItem('f1-start-timer:session');
            const now = Date.now();
            const attempt = (days, ms, sessionId) => ({
                at: new Date(now - days * 86400000).toISOString(), ms,
                ...(sessionId ? { sessionId } : {})
            });
            localStorage.setItem('f1-start-timer:history', JSON.stringify([
                attempt(0, 155, id), attempt(0, 175, id),
                attempt(6, 205, 'previous_session'), attempt(20, 225, 'previous_session'),
                attempt(40, 295),
            ]));
        }""")
        old_session = page.evaluate("sessionStorage.getItem('f1-start-timer:session')")
        page.reload(wait_until="load")
        assert page.evaluate("sessionStorage.getItem('f1-start-timer:session')") == old_session
        page.locator("#extras summary").click()
        page.locator("#history-filter").select_option("all")
        expect(page.locator("#trials-stat")).to_have_text("5")
        expect(page.locator("#session-count")).to_have_text("2 sessions")
        expect(page.locator(".history-session-heading")).to_have_count(3)
        assert "00.205" in page.locator("#median-stat").inner_text()
        assert "00.295" in page.locator("#slowest-stat").inner_text()
        page.locator("#history-period").select_option("session")
        expect(page.locator("#trials-stat")).to_have_text("2")
        expect(page.locator(".history-session-heading")).to_have_count(1)
        expect(page.locator("#session-count")).to_have_text("1 session")
        page.locator("#history-period").select_option("7d")
        expect(page.locator("#trials-stat")).to_have_text("3")
        page.locator("#history-period").select_option("30d")
        expect(page.locator("#trials-stat")).to_have_text("4")
        page.locator("#history-period").select_option("all")
        page.locator("#history-filter").select_option("all")
        expect(page.locator("#attempt-list .history-attempt")).to_have_count(5)
        no_overflow(page, f"{engine_name} v1.4 history")
        page.set_viewport_size({"width": 320, "height": 650})
        no_overflow(page, f"{engine_name} v1.4 small viewport")
        page.locator("#close-settings").click()
        assert not errors, f"{engine_name} JS/HTTP errors: {errors}"
        print(f"PASS {engine_name}: HTTP root/subpath, modal/gear, switches, Escape/Tab, localization, persistence, responsive, game")
        context.close()

        if engine_name in ("chromium", "webkit"):
            mobile_touch(browser, base, engine_name)
    finally:
        browser.close()


def mobile_touch(browser, base, engine_name):
    # Browser engines in device mode: WebKit simulates Mobile Safari rendering,
    # Chromium simulates Android touch. Neither is a physical-device claim.
    context = browser.new_context(
        viewport={"width": 390, "height": 844}, device_scale_factor=3,
        is_mobile=True, has_touch=True, locale="en-US",
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base + "/", wait_until="load")
    no_overflow(page, f"{engine_name} touch startup")
    page.locator("#extras summary").tap()
    expect(page.locator("#close-settings")).to_be_visible()
    panel_box = page.locator(".extras-content").bounding_box()
    assert panel_box is not None and panel_box["y"] > 150, f"{engine_name}: expected mobile bottom sheet: {panel_box}"
    page.locator("#tab-preferences").tap()
    page.locator("#setting-motion").tap()
    expect(page.locator("#setting-motion")).to_be_checked()
    assert page.evaluate("document.documentElement.dataset.reduceMotion") == "true"
    page.locator("#close-settings").tap()
    expect(page.locator("#extras")).not_to_have_attribute("open", "")
    expect(page.locator("#game-control")).to_have_attribute("aria-label", "Start reaction time test")
    # Touch should start the game immediately, without 300ms synthetic click delay.
    page.locator("#lights-container").tap()
    expect(page.locator(".light.on")).to_have_count(2)
    page.locator("#lights-container").tap()
    expect(page.locator("#result")).to_have_text("JUMP START!")
    no_overflow(page, f"{engine_name} touch early reaction")
    assert not errors, f"{engine_name} mobile JS errors: {errors}"
    print(f"PASS {engine_name} mobile touch: bottom sheet, switches, close, tap, false start")
    context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", choices=("all", "chromium", "firefox", "webkit"), default="all")
    args = parser.parse_args()
    if not (DIST / "index.html").exists():
        raise SystemExit("Build missing: run npm run build first")
    with serve() as url, sync_playwright() as playwright:
        for name in ("chromium", "firefox", "webkit"):
            if args.browser in ("all", name):
                print(f"Testing {name} against built site at / and /f1-start-timer/", flush=True)
                run_engine(getattr(playwright, name), url, name)
    print("Cross-browser suite passed. Real iOS Safari devices still require manual testing.")


if __name__ == "__main__":
    main()
