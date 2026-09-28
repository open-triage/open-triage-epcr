import assert from "node:assert/strict";
import test from "node:test";
import { applyDocumentLanguage, resolveMessage } from "../app/localization";

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
