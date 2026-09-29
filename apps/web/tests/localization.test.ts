import assert from "node:assert/strict";
import test from "node:test";
import { applyDocumentLanguage, availableUiLanguages, languageDisplayName, resolveMessage } from "../app/localization";
import english from "../messages/en.json";
import swedish from "../messages/sv.json";

test("named parameters, count variants, and fallback are stable", () => {
  assert.equal(resolveMessage("sv", "navigation.signedInAs", { name: "Anna" }), "Inloggad som Anna");
  assert.equal(resolveMessage("sv", "common.fallbackExample", { name: "Anna" }), "English fallback for Anna");
  assert.equal(resolveMessage("en", "common.count", {}, 1), "1 item");
  assert.equal(resolveMessage("en", "common.count", {}, 3), "3 items");
  assert.equal(resolveMessage("sv", "login.unsynchronized", {}, 1).startsWith("En rapport"), true);
  assert.equal(resolveMessage("sv", "missing.stable.key"), "missing.stable.key");
});

test("document metadata uses the agency language", () => {
  const document = { documentElement: { lang: "en" } } as Document;
  applyDocumentLanguage("sv", document);
  assert.equal(document.documentElement.lang, "sv");
});

test("note and media messages keep authored content verbatim in both languages", () => {
  const caption = "Åke: oxygen at 2 L/min — unchanged";
  const author = "Västra Räddningstjänsten";
  for (const language of ["en", "sv"] as const) {
    const label = resolveMessage(language, "noteUi.capturedAtState", {
      date: "2026-09-28 14:00", author, state: resolveMessage(language, "noteUi.state.ready"),
    });
    assert.ok(label.includes(author));
    assert.equal(resolveMessage(language, "mobile.openPhoto", { time: "14:00", author, caption }).includes(caption), true);
    assert.ok(resolveMessage(language, "noteUi.captionCount", { count: 7, max: 500 }).includes("500"));
    assert.ok(resolveMessage(language, "noteUi.imageLimit", { limit: 5 }).includes("5"));
  }
  assert.match(resolveMessage("sv", "noteUi.readinessMessage", { kind: "Foto", state: "laddas upp" }), /laddas upp/);
});

test("bundled language choices and missing translations use English", () => {
  assert.ok(availableUiLanguages.includes("en"));
  assert.ok(availableUiLanguages.includes("sv"));
  assert.equal(languageDisplayName("sv", "en"), "Swedish");
  const unavailable = "language-that-is-not-bundled";
  assert.equal(resolveMessage(unavailable, "login.signIn"), "Sign in");
  const document = { documentElement: { lang: unavailable } } as Document;
  applyDocumentLanguage(unavailable, document);
  assert.equal(document.documentElement.lang, "en");
});

test("admin and capture messages use stable descriptive keys in both dictionaries", () => {
  const englishKeys = Object.keys(english);
  const swedishKeys = new Set(Object.keys(swedish));
  for (const key of englishKeys.filter((candidate) => candidate.startsWith("admin.") || candidate.startsWith("noteUi.capture."))) {
    assert.ok(swedishKeys.has(key), `Swedish dictionary is missing ${key}`);
    if (key.startsWith("admin.") && !key.startsWith("admin.capability."))
      assert.match(key, /^admin\.[a-z][A-Za-z0-9]*$/);
    if (key.startsWith("noteUi.capture."))
      assert.match(key, /^noteUi\.capture\.[a-z][A-Za-z0-9]*$/);
  }
});
