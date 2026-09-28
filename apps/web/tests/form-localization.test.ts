import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClinicalFormConfiguration, EncounterDocument, FormDraftDefinition } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { StationaryRecord } from "../components/stationary-record";

const form: FormDraftDefinition = { schemaVersion: 1, sections: [{
  key: "ePatientSection",
  fields: [{ key: "patient-name", source: { kind: "nemsis", elementId: "ePatient.02" } }],
}] };
const catalogFields: ClinicalFormConfiguration["catalogFields"] = {
  "ePatient.02": {
    name: "Catalog patient name",
    description: "Catalog patient help",
    localization: { schemaVersion: 1, sv: { label: "Katalogens patientnamn", description: "Katalogens patienthjälp" } },
    agencyRequired: false,
    minOccurs: 0,
    maxOccurs: 1,
    nillable: true,
    supportsNotValues: true,
    supportsPertinentNegatives: false,
  },
};
const catalogGroups: NonNullable<ClinicalFormConfiguration["catalogGroups"]> = {
  ePatientSection: {
    name: "ePatient",
    localization: { schemaVersion: 1, sv: { name: "Katalogens patient" } },
  },
};

function render(definition: FormDraftDefinition, language: string): string {
  return renderToStaticMarkup(createElement(StationaryRecord, {
    document: synthetic as EncounterDocument,
    formDefinition: definition,
    catalogFields,
    catalogGroups,
    language,
    onDocumentChange() {},
  }));
}

test("stationary field and section wording comes from the pinned catalog", () => {
  const english = render(form, "en");
  assert.match(english, /Catalog patient name/);
  assert.match(english, /Catalog patient help/);
  assert.match(english, />Patient</);

  const swedish = render(form, "sv");
  assert.match(swedish, /Katalogens patientnamn/);
  assert.match(swedish, /Katalogens patienthjälp/);
  assert.match(swedish, /Katalogens patient/);
});

test("legacy form wording cannot override catalog text", () => {
  const legacy = {
    ...form,
    sections: form.sections.map((section) => ({
      ...section,
      presentation: { title: "Legacy section" },
      fields: section.fields.map((field) => ({
        ...field,
        configuration: { label: "Legacy label", helpText: "Legacy help" },
      })),
    })),
    locales: [{ locale: "sv", translations: {
      sections: { ePatientSection: { title: "Äldre avsnitt" } },
      fields: { "patient-name": { label: "Äldre etikett", helpText: "Äldre hjälp" } },
    } }],
  } as unknown as FormDraftDefinition;

  const html = render(legacy, "sv");
  assert.match(html, /Katalogens patientnamn/);
  assert.match(html, /Katalogens patienthjälp/);
  assert.doesNotMatch(html, /Legacy|Äldre/);
});
