import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClinicalFormConfiguration, FormDraftDefinition } from "@open-triage/contracts";
import { previewCatalogFields } from "../app/form-field-choices";
import { FormSectionElements } from "../components/form-authoring";

const catalogFields = { "ePatient.25": {
  agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
  supportsNotValues: true, supportsPertinentNegatives: false,
  codeChoices: [{ code: "9906003", codeSystem: "NEMSIS", label: "Male" },
    { code: "9906001", codeSystem: "NEMSIS", label: "Female" }],
  exceptionalChoices: [{ key: "not-value:7701003" }],
} } satisfies ClinicalFormConfiguration["catalogFields"];

test("authoring and preview use one field policy for codes and NOT values", () => {
  const definition: FormDraftDefinition = { schemaVersion: 1, sections: [{ key: "ePatient", fields: [
    { key: "sex", source: { kind: "nemsis", elementId: "ePatient.25" }, choicePolicy: [
      { kind: "not-value", code: "7701003" }, { kind: "code", code: "9906001", codeSystem: "NEMSIS" }] },
  ] }] };
  const markup = renderToStaticMarkup(createElement(FormSectionElements,
    { definition, catalogFields, onChange() {} }));
  assert.match(markup, /Enabled choices and order/);
  assert.match(markup, /NOT 7701003/);
  const preview = previewCatalogFields(definition, catalogFields);
  assert.deepEqual(preview["ePatient.25"]?.codeChoices?.map((choice) => choice.code), ["9906001"]);
  assert.deepEqual(preview["ePatient.25"]?.exceptionalChoices?.map((choice) => choice.key), ["not-value:7701003"]);
});
