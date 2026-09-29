import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicalFormConfiguration } from "@open-triage/contracts";
import { mobileDisplayDefinition, mobileDisplayEvent } from "../app/mobile-localization";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import { encounterEventDetail, type EncounterEvent } from "../app/standard-encounter";

const field = { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
  supportsNotValues: true, supportsPertinentNegatives: false };
const clinicalForm: ClinicalFormConfiguration = { definition: { schemaVersion: 1, sections: [] }, catalogFields: {
  "eMedications.04": { ...field, codeChoices: [{ code: "oral", codeSystem: "NEMSIS", label: "Oral", localization: { schemaVersion: 1, sv: { label: "Oralt" } } }] },
  "eVitals.06": { ...field, name: "Long catalog title", description: "Long catalog description",
    exceptionalChoices: [{ key: "not-value:7701003", localization: { schemaVersion: 1, sv: { label: "Ej registrerat" } } }] },
} };

test("mobile vitals retain concise labels, translated controls and field-specific absence choices", () => {
  const definition = mobileDisplayDefinition(standardEncounterDefinition, "sv", clinicalForm);
  assert.equal(definition.events.vitals.fields[0]!.label, "Systoliskt BT");
  assert.equal(definition.events.vitals.fields.find(({ id }) => id === "heartRate")?.label, "Puls");
  assert.equal(definition.events.vitals.labels.editorTitle, "Vitalparametrar");
  assert.equal(definition.events.vitals.labels.add, "Lägg till");
  assert.equal(definition.events.vitals.fields[0]!.absenceStates.find(({ code }) => code === "7701003")?.label, "Ej registrerat");
  assert.equal(mobileDisplayDefinition(standardEncounterDefinition, "en").events.vitals.fields[0]!.label, "Systolic BP");
  assert.equal(standardEncounterDefinition.events.vitals.labels.editorTitle, "Vital signs");
});

test("medication timeline localizes route labels while preserving authored response and recorded values", () => {
  const event: EncounterEvent = { id: "med", kind: "medication", time: "12:00", title: "Medication", detail: "", reference: "eMedications.03",
    medication: { medicationCode: "1", codeType: "RxNorm", label: "Drug", dose: "2", unit: "mg", route: "Oral", response: "Patient feels better", warningAcknowledged: false } };
  const shown = mobileDisplayEvent(event, "sv", clinicalForm);
  assert.equal(encounterEventDetail(shown, mobileDisplayDefinition(standardEncounterDefinition, "sv", clinicalForm)), "Oralt · Patient feels better");
  assert.equal(event.medication?.route, "Oral");
  assert.equal(shown.medication?.medicationCode, "1");
  assert.equal(mobileDisplayEvent(event, "en", clinicalForm), event);
});
