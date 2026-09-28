import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument, FormDraftDefinition } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { formFieldForElement, formFieldText, formSectionTitle, formTranslationWarnings } from "../app/form-localization";
import { StationaryRecord } from "../components/stationary-record";

const form: FormDraftDefinition = { schemaVersion: 1, sections: [{ key: "patient", presentation: { title: "Patient details" }, fields: [
  { key: "patient-name", source: { kind: "nemsis", elementId: "ePatient.02" }, configuration: { label: "Patient's name", helpText: "Enter legal name" } },
  { key: "patient-sex", source: { kind: "nemsis", elementId: "ePatient.25" } },
] }], locales: [{ locale: "sv", translations: { sections: { patient: { title: "Patientuppgifter" } },
  fields: { "patient-name": { label: "Patientens namn", helpText: "Ange juridiskt namn" } } },
  sourceReview: { "fields.patient-name.label": true } }] };

test("pinned form text resolves translated headings and overrides before catalog fallback", () => {
  assert.equal(formSectionTitle(form, "patient", "sv"), "Patientuppgifter");
  const field = formFieldForElement(form, "ePatient.02");
  assert.equal(formFieldText(form, field, "sv", "label"), "Patientens namn");
  assert.equal(formFieldText(form, field, "en", "label"), "Patient's name");
  assert.equal(formFieldText(form, formFieldForElement(form, "ePatient.25"), "sv", "label"), undefined);
  assert.deepEqual(formTranslationWarnings(form, "sv"), []);
  const html = renderToStaticMarkup(createElement(StationaryRecord, {
    document: synthetic as EncounterDocument, formDefinition: form, language: "sv", onDocumentChange() {},
  }));
  assert.match(html, /Patientuppgifter/);
  assert.match(html, /Patientens namn/);
  assert.doesNotMatch(html, /Patient details/);
});

test("missing Swedish source text warns only for authored English content", () => {
  const incomplete = { ...form, locales: [] };
  assert.deepEqual(formTranslationWarnings(incomplete, "sv"), [
    "patient: Swedish heading missing", "patient / patient-name: Swedish label missing", "patient / patient-name: Swedish help text missing",
  ]);
  assert.equal(formFieldText(incomplete, formFieldForElement(incomplete, "ePatient.02"), "sv", "label"), "Patient's name");
  assert.deepEqual(formTranslationWarnings(incomplete, "en"), []);
  assert.equal(formSectionTitle({ schemaVersion: 1, sections: [{ key: "old", fields: [] }] }, "old", "sv"), undefined);
});
