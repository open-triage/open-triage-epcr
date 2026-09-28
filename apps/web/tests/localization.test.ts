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
