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
    assert.ok(html.includes(`href="#${section.hash}"`));
  }
  assert.match(html, /aria-label="Stationary record sections"/);
  assert.doesNotMatch(html, /data-stationary-section="(?:DemographicGroup|eCustomConfigurationSection)"/);
  assert.doesNotMatch(html, /href="#stationary-section-(?:DemographicGroup|eCustomConfigurationSection)"/);
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
    key: "patient-first", presentation: { title: "Patient first" }, fields: [
      { key: "sex", source: { kind: "nemsis" as const, elementId: "ePatient.25" } },
      { key: "name", source: { kind: "nemsis" as const, elementId: "ePatient.02" } },
    ],
  }, {
    key: "record-second", presentation: { title: "Record second" }, fields: [
      { key: "record", source: { kind: "nemsis" as const, elementId: "eRecord.01" } },
    ],
  }] };
  const html = renderToStaticMarkup(createElement(StationaryRecord, { document, formDefinition, onDocumentChange() {} }));
  assert.ok(html.indexOf("Patient first") < html.indexOf("Record second"));
  assert.ok(html.indexOf('data-element-id="ePatient.25"') < html.indexOf('data-element-id="ePatient.02"'));
  assert.doesNotMatch(html, /data-element-id="eVitals\.06"/);
});

test("a pinned form never exposes agency demographics or NEMSIS custom configuration", () => {
  const formDefinition = { schemaVersion: 1 as const, sections: [{
    key: "demographics", presentation: { title: "Agency demographics" }, fields: [
      { key: "agency-number", source: { kind: "nemsis" as const, elementId: "dAgency.01" } },
    ],
  }, {
    key: "custom-configuration", presentation: { title: "Custom configuration" }, fields: [
      { key: "custom-title", source: { kind: "nemsis" as const, elementId: "eCustomConfiguration.01" } },
    ],
  }, {
    key: "clinical", presentation: { title: "Patient" }, fields: [
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

test("section status projects errors, warnings, and incomplete catalog requirements", () => {
  const statuses = stationarySectionStatuses(document, [
    { severity: "error", target: { groupId: "eVitals.VitalGroup", elementId: "eVitals.06" } },
    { severity: "warning", target: { groupId: "eVitals.CardiacRhythmGroup", elementId: "eVitals.03" } },
    { severity: "warning", target: { groupId: "eNarrativeSection", elementId: "eNarrative.01" } },
  ]);
  assert.equal(statuses.get("eVitalsSection")?.errors, 1);
  assert.equal(statuses.get("eVitalsSection")?.warnings, 1);
  assert.equal(statuses.get("eNarrativeSection")?.warnings, 1);
  assert.ok([...statuses.values()].some(({ incomplete }) => incomplete > 0));

  const html = renderToStaticMarkup(createElement(StationaryRecord, {
    document,
    findings: [{ severity: "error", target: { groupId: "eVitals.VitalGroup" } }],
    onDocumentChange() {},
  }));
  assert.match(html, /Vitals: 1 error, 0 warnings,/);
  assert.match(html, /warning-count zero-count/);
  assert.doesNotMatch(html, /NEMSIS section/);
  assert.match(html, /data-section-status="error"/);
});

test("scroll activation selects the section crossing the sticky activation line", () => {
  assert.equal(activeStationarySection([{ id: "one", top: -200 }, { id: "two", top: 120 }, { id: "three", top: 500 }]), "two");
  assert.equal(activeStationarySection([{ id: "one", top: 300 }, { id: "two", top: 700 }]), "one");
});
