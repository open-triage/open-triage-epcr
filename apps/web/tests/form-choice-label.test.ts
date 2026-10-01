import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicalFormConfiguration, FormDraftField } from "@open-triage/contracts";
import { formChoiceLabel } from "../app/form-choice-label";

const field: FormDraftField = { key: "age", source: { kind: "nemsis", elementId: "ePatient.15" } };
const catalogFields: ClinicalFormConfiguration["catalogFields"] = { "ePatient.15": {
  agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true, supportsNotValues: true, supportsPertinentNegatives: false,
  exceptionalChoices: [{ key: "not-value:7701003", localization: { schemaVersion: 1, sv: { label: "Ej dokumenterat" } } }],
  codeChoices: [{ code: "A", codeSystem: "local", label: "Adult", localization: { schemaVersion: 1, sv: { label: "Vuxen" } } }],
} };

test("form NOT labels resolve pinned translations and English source wording", () => {
  assert.equal(formChoiceLabel({ kind: "not-value", code: "7701003" }, field, catalogFields, undefined, "sv"), "Ej dokumenterat");
  assert.equal(formChoiceLabel({ kind: "not-value", code: "7701003" }, field, catalogFields, undefined, "en"), "Not Recorded");
  assert.equal(formChoiceLabel({ kind: "not-value", code: "7701001" }, field, undefined, undefined, "en"), "Not Applicable");
  assert.equal(formChoiceLabel({ kind: "code", code: "A", codeSystem: "local" }, field, catalogFields, undefined, "sv"), "Vuxen");
});

test("custom fields use readable exceptional values without exposing numeric NOT or PN codes", () => {
  const custom: FormDraftField = { key: "local", source: { kind: "custom", elementDefinitionId: "custom" } };
  assert.equal(formChoiceLabel({ kind: "not-value", code: "7701003" }, custom, undefined, undefined, "en"), "Not Recorded");
  assert.doesNotMatch(formChoiceLabel({ kind: "pertinent-negative", code: "8801019" }, custom, undefined, undefined, "en"), /8801019|Unknown/);
});
