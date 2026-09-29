import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogDraftDefinition, ValidationRuleSource } from "@open-triage/contracts";
import { catalogTranslationIssues, validationTranslationIssues, updateCatalogEnglish, updateCatalogChoiceEnglish, updateValidationEnglish } from "../app/translation-diagnostics";

const catalog = { elements: [{ elementId: "ePatient.01", label: "Patient", description: "Optional source",
  localization: { schemaVersion: 1, sv: { label: "Patient sv", description: "Valfri källa",
    reviewedSource: { label: "Patient", description: "Optional source" } } }, specialChoices: [],
  constraints: { minOccurs: 0, maxOccurs: 1 } }], codeLists: [], hiddenElementIds: [] } as unknown as CatalogDraftDefinition;

test("catalog review follows stored English source and preserves translated text", () => {
  assert.deepEqual(catalogTranslationIssues(catalog), []);
  const changed = { ...catalog, elements: catalog.elements.map((element) => ({ ...element, label: "Patient name" })) };
  assert.deepEqual(catalogTranslationIssues(changed as CatalogDraftDefinition).map(({ kind, field }) => [kind, field]), [["review", "label"]]);
  assert.equal(changed.elements[0]?.localization?.sv?.label, "Patient sv");
  const confirmed = { ...changed, elements: changed.elements.map((element) => ({ ...element,
    localization: { ...element.localization, sv: { ...element.localization?.sv,
      reviewedSource: { ...element.localization?.sv?.reviewedSource, label: element.label } } } })) };
  assert.deepEqual(catalogTranslationIssues(confirmed as CatalogDraftDefinition), []);
  assert.deepEqual(catalogTranslationIssues(changed as CatalogDraftDefinition, "en"), []);
});

test("catalog diagnostics detect whitespace labels and ignore absent optional English descriptions", () => {
  const missing = { ...catalog, elements: catalog.elements.map((element) => ({ ...element,
    label: "  ", description: undefined, localization: { ...element.localization,
      sv: { ...element.localization?.sv, label: "  ", description: undefined } } })) };
  assert.deepEqual(catalogTranslationIssues(missing as CatalogDraftDefinition).map(({ kind, field }) => [kind, field]),
    [["english", "label"], ["agency", "label"]]);
});

test("validation diagnostics distinguish missing English, missing Swedish, and source review", () => {
  const rule = { id: "rule-1", name: "  ", message: "Check", localization: { schemaVersion: 1,
    sv: { name: "Namn", message: "Kontroll", reviewedSource: { message: "Old" } } } } as ValidationRuleSource;
  assert.deepEqual(validationTranslationIssues([rule]).map(({ kind, field }) => [kind, field]),
    [["english", "name"], ["review", "message"]]);
  assert.deepEqual(validationTranslationIssues([rule], "en").map(({ kind, field }) => [kind, field]),
    [["english", "name"]]);
});


test("editing English retains legacy translations and marks their original source for review", () => {
  const original = { ...catalog.elements[0]!, localization: { schemaVersion: 1 as const, sv: { label: "Patient sv" } } };
  const unchanged = updateCatalogEnglish(original, "label", original.label);
  assert.equal(unchanged, original);
  const changed = updateCatalogEnglish(original, "label", "Patient name");
  assert.equal(changed.localization?.sv?.label, "Patient sv");
  assert.equal(changed.localization?.sv?.reviewedSource?.label, "Patient");
  assert.equal(updateCatalogEnglish(changed, "label", "Full patient name").localization?.sv?.reviewedSource?.label, "Patient");
  const choice = { code: "1", codeSystem: "test", label: "Choice", sourceLabel: "Choice", category: null, enabled: true,
    localization: { schemaVersion: 1 as const, sv: { label: "Val" } } };
  assert.equal(updateCatalogChoiceEnglish(choice, "New choice").localization?.sv?.reviewedSource?.label, "Choice");
  const rule = { id: "rule-1", name: "Original", message: "Check", localization: { schemaVersion: 1 as const,
    sv: { name: "Namn" } } } as ValidationRuleSource;
  const updated = updateValidationEnglish(rule, "name", "Changed");
  assert.equal(updated.localization?.sv?.name, "Namn");
  assert.equal(updated.localization?.sv?.reviewedSource?.name, "Original");
  assert.deepEqual(validationTranslationIssues([updated]).map(({ kind }) => kind), ["review", "agency"]);
});
