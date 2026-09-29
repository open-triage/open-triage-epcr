import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { NEMSIS_DATA_MODEL } from "../app/nemsis-data-model";
import {
  activeStationarySection,
  configuredStationarySections,
  stationaryPresentationCoverage,
  stationarySectionBlocks,
  stationarySectionStatuses,
} from "../app/stationary-record";
import { COMPILED_STATIONARY_LAYOUT } from "../app/stationary-layout";
import { stationaryActionLabel, stationaryDisplayLabel } from "../app/stationary-label";
import { StationaryRecord } from "../components/stationary-record";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { editScalarOccurrence } from "../app/stationary-scalar";
import { INITIAL_SHELL_STATE, reviewEncounter } from "../app/standard-encounter";
import { stationaryReviewFindings } from "../app/stationary-validation";

const document = structuredClone(synthetic) as EncounterDocument;

test("technical section and group identifiers become concise display labels", () => {
  assert.equal(stationaryDisplayLabel("eResponse"), "Response");
  assert.equal(stationaryDisplayLabel("eCustomConfigurationSection"), "Custom Configuration Section");
  assert.equal(stationaryDisplayLabel("eLabs.LabResultGroup"), "Lab Result Group");
  assert.equal(stationaryActionLabel("eLabs.LabResultGroup"), "Lab Result");
});

test("the complete record exposes configured sections and blocks in canonical hierarchy order", () => {
  const sections = configuredStationarySections();
  assert.equal(sections[0]?.id, "eRecordSection");
  assert.equal(sections.at(-1)?.id, "eOtherSection");
  assert.equal(sections.length, 25);
  assert.equal(sections.some(({ id }) => id === "DemographicGroup" || id === "eCustomConfigurationSection"), false);

  const payment = sections.find(({ id }) => id === "ePaymentSection")!;
  assert.deepEqual(stationarySectionBlocks(payment).map(({ group }) => group.id), [
    "ePaymentSection",
    "ePayment.CertificateGroup",
    "ePayment.InsuranceGroup",
    "ePayment.ClosestRelativeGroup",
    "ePayment.EmployerGroup",
    "ePayment.SupplyItemGroup",
  ]);

  const html = renderToStaticMarkup(createElement(StationaryRecord, { document, onDocumentChange() {} }));
  let previous = -1;
  for (const section of sections) {
    const index = html.indexOf(`data-stationary-section="${section.id}"`);
    assert.ok(index > previous, `${section.id} must follow configured section order`);
    previous = index;
    assert.ok(html.includes(`aria-label="${stationaryDisplayLabel(section.label)}:`));
  }
  assert.match(html, /aria-label="Stationary record sections"/);
  assert.doesNotMatch(html, /data-stationary-section="(?:DemographicGroup|eCustomConfigurationSection)"/);
  assert.doesNotMatch(html, /stationary-section-(?:DemographicGroup|eCustomConfigurationSection)/);
  assert.match(html, /aria-current="location"/);
  assert.match(html, /tabindex="-1"/);
});

test("an empty pinned form still renders the complete Stationary record", () => {
  const html = renderToStaticMarkup(createElement(StationaryRecord, {
    document,
    formDefinition: { schemaVersion: 1, sections: [] },
    onDocumentChange() {},
  }));
  assert.match(html, /data-stationary-section="eRecordSection"/);
  assert.match(html, /data-element-id="eResponse\.22"/);
  assert.match(html, /data-stationary-section="eOtherSection"/);
});

test("a pinned form controls Stationary section and element order", () => {
  const formDefinition = { schemaVersion: 1 as const, sections: [{
    key: "ePatientSection", fields: [
      { key: "sex", source: { kind: "nemsis" as const, elementId: "ePatient.25" } },
      { key: "name", source: { kind: "nemsis" as const, elementId: "ePatient.02" } },
    ],
  }, {
    key: "eRecordSection", fields: [
      { key: "record", source: { kind: "nemsis" as const, elementId: "eRecord.01" } },
    ],
  }] };
  const html = renderToStaticMarkup(createElement(StationaryRecord, { document, formDefinition, onDocumentChange() {} }));
  assert.ok(html.indexOf("Patient") < html.indexOf("Record"));
  assert.ok(html.indexOf('data-element-id="ePatient.25"') < html.indexOf('data-element-id="ePatient.02"'));
  assert.doesNotMatch(html, /data-element-id="eVitals\.06"/);
});

test("a pinned form never exposes agency demographics or NEMSIS custom configuration", () => {
  const formDefinition = { schemaVersion: 1 as const, sections: [{
    key: "demographics", fields: [
      { key: "agency-number", source: { kind: "nemsis" as const, elementId: "dAgency.01" } },
    ],
  }, {
    key: "custom-configuration", fields: [
      { key: "custom-title", source: { kind: "nemsis" as const, elementId: "eCustomConfiguration.01" } },
    ],
  }, {
    key: "clinical", fields: [
      { key: "patient-name", source: { kind: "nemsis" as const, elementId: "ePatient.02" } },
    ],
  }] };

  const html = renderToStaticMarkup(createElement(StationaryRecord, {
    document, formDefinition, onDocumentChange() {},
  }));

  assert.doesNotMatch(html, /Agency demographics|Custom configuration/);
  assert.doesNotMatch(html, /data-element-id="(?:dAgency|eCustomConfiguration)\./);
  assert.match(html, /data-element-id="ePatient\.02"/);
});

test("every compiled group and catalog element has exactly one renderer presentation route", () => {
  const coverage = stationaryPresentationCoverage();
  assert.equal(coverage.groups.size, COMPILED_STATIONARY_LAYOUT.groups.length);
  assert.equal(coverage.elements.size, COMPILED_STATIONARY_LAYOUT.elements.length);
  assert.deepEqual(new Set(coverage.groups.keys()), new Set(NEMSIS_DATA_MODEL.groups.map(({ id }) => id)));
  assert.deepEqual(new Set(coverage.elements.keys()), new Set(NEMSIS_DATA_MODEL.elements.map(({ id }) => id)));
  assert.equal([...coverage.elements.values()].filter((mode) => mode === "read-only").length > 0, true);
  assert.equal([...coverage.groups.values()].filter((kind) => kind === "nested-table").length > 0, true);
});

test("section status projects actionable errors and warnings", () => {
  const statuses = stationarySectionStatuses([
    { severity: "error", target: { groupId: "eVitals.VitalGroup", elementId: "eVitals.06" } },
    { severity: "warning", target: { groupId: "eVitals.CardiacRhythmGroup", elementId: "eVitals.03" } },
    { severity: "warning", target: { groupId: "eNarrativeSection", elementId: "eNarrative.01" } },
  ]);
  assert.equal(statuses.get("eVitalsSection")?.errors, 1);
  assert.equal(statuses.get("eVitalsSection")?.warnings, 1);
  assert.equal(statuses.get("eNarrativeSection")?.warnings, 1);

  const html = renderToStaticMarkup(createElement(StationaryRecord, {
    document,
    findings: [{ severity: "error", target: { groupId: "eVitals.VitalGroup" } }],
    onDocumentChange() {},
  }));
  assert.match(html, /Vitals: 1 error, 0 warnings/);
  assert.match(html, /warning-count zero-count/);
  assert.doesNotMatch(html, /incomplete-count|required fields incomplete/);
  assert.doesNotMatch(html, /NEMSIS section/);
  assert.match(html, /data-section-status="error"/);
});

test("encounter-review warnings contribute to section badges without becoming inline form messages", () => {
  const populated = populateStationaryDemoData(document);
  const vitalReviewWarning = { severity: "warning" as const, target: {
    groupId: "eVitals.VitalGroup", elementId: "eVitals.10",
  } };
  const html = renderToStaticMarkup(createElement(StationaryRecord, { document: populated,
    findings: [], sectionFindings: [vitalReviewWarning], onDocumentChange() {} }));
  assert.match(html, /Vitals: 0 errors, 1 warning/);
  assert.doesNotMatch(html, /stationary-validation-message warning/);

  const formDefinition = { schemaVersion: 1 as const, sections: [{ key: "vitals", fields: [
    { key: "heart-rate", source: { kind: "nemsis" as const, elementId: "eVitals.10" } },
  ] }] };
  const preview = renderToStaticMarkup(createElement(StationaryRecord, { document: populated,
    formDefinition, findings: [], sectionFindings: [vitalReviewWarning], onDocumentChange() {} }));
  assert.match(preview, /vitals: 0 errors, 1 warning/i);
});

test("populated vital review warnings appear in the stationary section rail", () => {
  let populated = populateStationaryDemoData(document);
  for (const elementId of ["eVitals.06", "eVitals.10", "eVitals.12", "eVitals.14"]) {
    const groupId = NEMSIS_DATA_MODEL.elements.find(({ id }) => id === elementId)!.groupPath.at(-1)!;
    const instance = populated.groups.find(({ id }) => id === groupId)!.instances[0]!;
    const occurrenceId = instance.elements.find(({ id }) => id === elementId)!.values[0]!.occurrenceId;
    const edited = editScalarOccurrence(populated, { groupId, groupInstanceId: instance.instanceId,
      elementId, occurrenceId, input: "0" });
    assert.equal(edited.ok, true);
    populated = edited.document;
  }
  const vitalFindings = reviewEncounter({ ...INITIAL_SHELL_STATE,
    encounter: { ...INITIAL_SHELL_STATE.encounter, document: populated } })
    .filter(({ eventType }) => eventType === "vitals");
  assert.equal(vitalFindings.filter(({ severity }) => severity === "warning").length, 4);
  const formDefinition = { schemaVersion: 1 as const, sections: [{ key: "vitals", fields: [
    ...["eVitals.06", "eVitals.10", "eVitals.12", "eVitals.14"].map((elementId) => ({
      key: elementId, source: { kind: "nemsis" as const, elementId },
    })),
  ] }] };
  const visible = stationaryReviewFindings(vitalFindings, { definition: formDefinition, catalogFields: {} });
  assert.equal(visible.length, 4);
  const fullHtml = renderToStaticMarkup(createElement(StationaryRecord, { document: populated,
    sectionFindings: visible, onDocumentChange() {} }));
  assert.match(fullHtml, /Vitals: 0 errors, 4 warnings/);
  const html = renderToStaticMarkup(createElement(StationaryRecord, { document: populated, formDefinition,
    sectionFindings: visible, onDocumentChange() {} }));
  assert.match(html, /vitals: 0 errors, 4 warnings/i);
});

test("a warning on a vital field highlights its table row", () => {
  const populated = populateStationaryDemoData(document);
  const vital = populated.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances[0]!;
  const formDefinition = { schemaVersion: 1 as const, sections: [{ key: "vitals", fields: [
    { key: "etco2", source: { kind: "nemsis" as const, elementId: "eVitals.16" } },
  ] }] };
  const html = renderToStaticMarkup(createElement(StationaryRecord, { document: populated, formDefinition,
    findings: [{ severity: "warning", target: { groupId: "eVitals.VitalGroup", groupInstanceId: vital.instanceId,
      fieldId: "eVitals.16" } }], onDocumentChange() {} }));
  assert.match(html, /<tr[^>]*class="stationary-validation-state warning"/);
});

test("scroll activation selects the section crossing the sticky activation line", () => {
  assert.equal(activeStationarySection([{ id: "one", top: -200 }, { id: "two", top: 120 }, { id: "three", top: 500 }]), "two");
  assert.equal(activeStationarySection([{ id: "one", top: 300 }, { id: "two", top: 700 }]), "one");
});
