import assert from "node:assert/strict";
import test from "node:test";
import { effectiveCatalogFields, materializeLegacyChoicePolicies, validateFieldChoicePolicies } from "../dist/forms/field-choice-policy.js";
import { FormPublicationValidationError, validateCanonicalFormDefinition } from "../dist/forms/form-publication.validation.js";

const catalogFields = {
  "eFirst.01": { supportsNotValues: true, codeChoices: [
    { code: "A", codeSystem: "x", label: "Alpha" }, { code: "B", codeSystem: "x", label: "Beta" }],
    exceptionalChoices: [{ key: "not-value:7701003" }] },
  "eSecond.01": { supportsNotValues: true, codeChoices: [
    { code: "A", codeSystem: "x", label: "Alpha" }, { code: "B", codeSystem: "x", label: "Beta" }],
    exceptionalChoices: [{ key: "not-value:7701003" }] },
};
const definition = { schemaVersion: 1, sections: [{ key: "one", fields: [
  { key: "first", source: { kind: "nemsis", elementId: "eFirst.01" }, choicePolicy: [
    { kind: "not-value", code: "7701003" }, { kind: "code", code: "B", codeSystem: "x" }] },
  { key: "second", source: { kind: "nemsis", elementId: "eSecond.01" }, choicePolicy: [
    { kind: "code", code: "A", codeSystem: "x" }] },
] }] };

test("fields sharing a code list retain independent enabled choices", () => {
  assert.deepEqual(validateFieldChoicePolicies(definition, catalogFields), []);
  const resolved = effectiveCatalogFields(definition, catalogFields);
  assert.deepEqual(resolved["eFirst.01"].codeChoices.map((choice) => choice.code), ["B"]);
  assert.deepEqual(resolved["eSecond.01"].codeChoices.map((choice) => choice.code), ["A"]);
  assert.deepEqual(resolved["eFirst.01"].exceptionalChoices.map((choice) => choice.key), ["not-value:7701003"]);
  assert.deepEqual(resolved["eSecond.01"].exceptionalChoices, []);
  assert.equal(catalogFields["eFirst.01"].codeChoices.length, 2);
});

test("legacy successor snapshots effective catalog enablement and order", () => {
  const legacy = { schemaVersion: 1, sections: [{ key: "one", fields: [
    { key: "first", source: { kind: "nemsis", elementId: "eFirst.01" } }] }] };
  const successor = materializeLegacyChoicePolicies(legacy, catalogFields);
  assert.deepEqual(successor.sections[0].fields[0].choicePolicy, [
    { kind: "code", code: "A", codeSystem: "x" }, { kind: "code", code: "B", codeSystem: "x" },
    { kind: "not-value", code: "7701003" }]);
  assert.equal(legacy.sections[0].fields[0].choicePolicy, undefined);
});

test("direct invalid policies are rejected before saving or publishing", () => {
  assert.deepEqual(validateFieldChoicePolicies({ ...definition, sections: [{ key: "one", fields: [
    { ...definition.sections[0].fields[0], choicePolicy: [{ kind: "code", code: "missing", codeSystem: "x" }] }] }] },
    catalogFields), ["field first choice code:missing is unavailable in the pinned catalog"]);
  assert.throws(() => validateCanonicalFormDefinition({ ...definition, sections: [{ key: "one", fields: [
    { ...definition.sections[0].fields[0], choicePolicy: [{ kind: "code", code: "A", codeSystem: "x" },
      { kind: "code", code: "A", codeSystem: "x" }] }] }] }),
  (error) => error instanceof FormPublicationValidationError && error.findings.some((item) => item.includes("duplicate choices")));
});
