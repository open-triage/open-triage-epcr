import assert from "node:assert/strict";
import test from "node:test";
import { resolveCatalogElementText } from "../app/catalog-localization";

test("pinned catalog localization resolves Swedish, English, then stable identity", () => {
  const field = { name: "Heart Rate", description: "Heart rate per minute", localization: {
    schemaVersion: 1 as const, sv: { label: "Hjärtfrekvens", description: "Hjärtfrekvens per minut",
      reviewedSource: { label: "Earlier English text", description: "Earlier description" } }
  } };
  assert.equal(resolveCatalogElementText(field, "eVitals.10", "sv", "label"), "Hjärtfrekvens");
  assert.equal(resolveCatalogElementText(field, "eVitals.10", "sv", "description"), "Hjärtfrekvens per minut");
  assert.equal(resolveCatalogElementText(field, "eVitals.10", "en", "label"), "Heart Rate");
  assert.equal(resolveCatalogElementText({ name: "Heart Rate" }, "eVitals.10", "sv", "label"), "Heart Rate");
  assert.equal(resolveCatalogElementText({ name: "   " }, "eVitals.10", "sv", "label"), "eVitals.10");
  assert.equal(resolveCatalogElementText(undefined, "eVitals.10", "sv", "label"), "eVitals.10");
});
