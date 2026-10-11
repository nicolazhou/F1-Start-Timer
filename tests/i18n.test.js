import assert from "node:assert/strict";
import test from "node:test";
import "../src/i18n.js";
import "../src/options.js";
const { languages, messages, resolveLanguage, translate } = globalThis.F1StartTimerI18n;
const opts = globalThis.F1StartTimerOptions;

test("all five languages have matching UI keys and interpolation variables", () => {
  const expected = Object.keys(messages.en).sort();
  for (const language of languages) {
    assert.deepEqual(Object.keys(messages[language]).sort(), expected, `${language} translation keys`);
    for (const key of expected) {
      assert.ok(messages[language][key].trim().length > 0, `${language}: ${key} is empty`);
      const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      assert.deepEqual(placeholders(messages[language][key]), placeholders(messages.en[key]), `${language}: ${key} placeholders`);
    }
  }
});

test("browser language selection tries locales in order, with safe English fallback", () => {
  assert.equal(resolveLanguage("auto", ["pt-BR", "it-IT"]), "it");
  assert.equal(resolveLanguage("auto", ["es-MX", "it-IT"]), "es");
  assert.equal(resolveLanguage("auto", ["pt-BR"]), "en");
  assert.equal(resolveLanguage("auto", []), "en");
  assert.equal(resolveLanguage("de", ["it-IT"]), "de");
  assert.equal(resolveLanguage("unknown", ["it-IT"]), "en");
  assert.equal(resolveLanguage("auto", "fr-CA"), "fr");
  assert.equal(translate("it", "best", { time: "00.245" }), "Il tuo record: 00.245");
  assert.equal(translate("en", "lightsCount", { count: 3 }), "3 of 5 light columns illuminated");
  assert.equal(translate("invalid", "gameIdle"), messages.en.gameIdle);
});

test("saved explicit language survives reload and old preferences default to automatic", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const saved = opts.normalizeSettings({ sound: true, textScale: 125, language: "fr" });
  assert.equal(opts.saveSettings(saved, storage), true);
  assert.deepEqual(opts.loadSettings(storage), saved);
  assert.equal(opts.normalizeSettings({ textScale: 150 }).language, "auto");
  assert.equal(opts.normalizeSettings({ language: "<script>" }).language, "auto");
  assert.equal(opts.normalizeSettings({ language: "xx" }).language, "auto");
});
