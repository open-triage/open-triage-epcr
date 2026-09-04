import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { deserializeEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { NEMSIS_DATA_MODEL } from "../app/nemsis-data-model";
import {
  editNonRepeatingScalarValue,
  requireEditableNonRepeatingElement,
  STATIONARY_NON_REPEATING_GROUPS,
} from "../app/stationary-non-repeating";
import { COMPILED_STATIONARY_LAYOUT, type CompiledStationaryGroup } from "../app/stationary-layout";
import { StationaryNonRepeatingRecord } from "../components/stationary-non-repeating-record";

function hierarchyIds(): string[] {
  const result: string[] = [];
  const visit = (group: CompiledStationaryGroup) => {
    const catalog = NEMSIS_DATA_MODEL.groups.find(({ id }) => id === group.id)!;
    if (!catalog.repeating) result.push(group.id);
    group.children.forEach(visit);
  };
  COMPILED_STATIONARY_LAYOUT.hierarchy.forEach(visit);
  return result;
}

test("every configured non-repeating group and directly contained element is discoverable in canonical hierarchy order", () => {
  const expectedGroups = NEMSIS_DATA_MODEL.groups.filter(({ repeating }) => !repeating);
  assert.equal(STATIONARY_NON_REPEATING_GROUPS.length, 51);
  assert.deepEqual(STATIONARY_NON_REPEATING_GROUPS.map(({ id }) => id), hierarchyIds());
  assert.deepEqual(new Set(STATIONARY_NON_REPEATING_GROUPS.map(({ id }) => id)), new Set(expectedGroups.map(({ id }) => id)));

  for (const group of STATIONARY_NON_REPEATING_GROUPS) {
    assert.deepEqual(group.path, group.catalog.path);
    assert.equal(group.catalog.occurrence.max, 1);
    assert.deepEqual(
      group.fields.map(({ id }) => id),
      NEMSIS_DATA_MODEL.elements.filter(({ groupPath }) => groupPath.at(-1) === group.id).map(({ id }) => id),
    );
  }
  assert.equal(STATIONARY_NON_REPEATING_GROUPS.reduce((count, group) => count + group.fields.length, 0), 288);
  assert.ok(STATIONARY_NON_REPEATING_GROUPS.some(({ optional }) => optional));
});

test("system-owned metadata is externally read-only and cannot create draft mutations", () => {
  const demographic = STATIONARY_NON_REPEATING_GROUPS.find(({ id }) => id === "DemographicGroup")!;
  assert.equal(demographic.readOnly, true);
  assert.ok(demographic.fields.every(({ readOnly }) => readOnly));
  const document = structuredClone(synthetic) as EncounterDocument;
  const before = encounterDocumentToDraftMutations("report-062", document);
  assert.throws(() => requireEditableNonRepeatingElement("DemographicGroup", "dAgency.01"), /read-only system-owned metadata/);
  assert.throws(() => editNonRepeatingScalarValue(document, {
    groupId: "DemographicGroup", elementId: "dAgency.01",
  }, "unsafe mutation"), /read-only system-owned metadata/);
  assert.deepEqual(encounterDocumentToDraftMutations("report-062", document), before);
});

test("the full inline surface exposes every field while rendering system metadata without form controls", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const html = renderToStaticMarkup(createElement(StationaryNonRepeatingRecord, {
    document,
    applicability: { "eNarrative.01": { applicable: false, reason: "No narrative required for this scenario" } },
    onDocumentChange() {},
  }));
  for (const group of STATIONARY_NON_REPEATING_GROUPS) {
    assert.match(html, new RegExp(`data-group-id="${group.id.replaceAll(".", "\\.")}"`));
    for (const field of group.fields) assert.ok(html.includes(field.id), `${field.id} must remain discoverable`);
  }
  const demographic = html.slice(html.indexOf('data-group-id="DemographicGroup"'), html.indexOf("</section>", html.indexOf('data-group-id="DemographicGroup"')));
  assert.match(demographic, /Read-only system metadata/);
  assert.match(demographic, /data-read-only="true"/);
  assert.doesNotMatch(demographic, /<(?:input|select|textarea)/);
  const narrative = html.slice(html.indexOf('data-group-id="eNarrativeSection"'), html.indexOf("</section>", html.indexOf('data-group-id="eNarrativeSection"')));
  assert.match(narrative, /Not applicable: No narrative required/);
  assert.match(narrative, /disabled=""/);
  assert.match(narrative, /eNarrative\.01/);
});

test("inline edits retain stable identities, ancestry, source attributes, and compatible extensions through reopen", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const groupIndex = document.groups.findIndex(({ id }) => id === "ePatient.PatientNameGroup");
  const group = document.groups[groupIndex]!;
  const instance = group.instances[0]!;
  const elementIndex = instance.elements.findIndex(({ id }) => id === "ePatient.03");
  const element = instance.elements[elementIndex]!;
  const occurrenceId = element.values[0]!.occurrenceId;
  const groups = [...document.groups];
  groups[groupIndex] = {
    ...group,
    vendorGroupExtension: { retained: true },
    instances: [{
      ...instance,
      attributes: { source: "dispatch" },
      vendorInstanceExtension: "retained",
      elements: instance.elements.map((candidate, index) => index === elementIndex ? {
        ...candidate,
        vendorElementExtension: 62,
        values: [{ ...candidate.values[0]!, attributes: { sourceSystem: "CAD" }, vendorValueExtension: true }],
      } : candidate),
    }],
  };
  const enriched = { ...document, groups };
  const edited = editNonRepeatingScalarValue(enriched, {
    groupId: group.id, groupInstanceId: instance.instanceId, elementId: element.id, occurrenceId,
  }, "STATIONARY", () => "unused", new Date("2026-09-04T16:00:00.000Z"));
  assert.equal(edited.ok, true);
  if (!edited.ok) throw new Error("expected successful edit");
  const reopened = deserializeEncounterDocument(serializeEncounterDocument(edited.document));
  const reopenedGroup = reopened.groups.find(({ id }) => id === group.id)!;
  const reopenedInstance = reopenedGroup.instances[0]!;
  const reopenedElement = reopenedInstance.elements.find(({ id }) => id === element.id)!;
  assert.equal(reopenedInstance.instanceId, instance.instanceId);
  assert.equal(reopenedInstance.parentInstanceId, instance.parentInstanceId);
  assert.deepEqual(reopenedInstance.attributes, { source: "dispatch" });
  assert.deepEqual(reopenedGroup.vendorGroupExtension, { retained: true });
  assert.equal(reopenedInstance.vendorInstanceExtension, "retained");
  assert.equal(reopenedElement.vendorElementExtension, 62);
  assert.equal(reopenedElement.values[0]!.occurrenceId, occurrenceId);
  assert.deepEqual(reopenedElement.values[0]!.attributes, { sourceSystem: "CAD" });
  assert.equal(reopenedElement.values[0]!.vendorValueExtension, true);
});

test("editing an absent optional inline group creates its canonical ancestry once", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  let sequence = 0;
  const createId = () => `stationary-062-${++sequence}`;
  const first = editNonRepeatingScalarValue(document, {
    groupId: "eNarrativeSection", elementId: "eNarrative.01",
  }, "Initial narrative", createId);
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("expected successful edit");
  const narrative = first.document.groups.find(({ id }) => id === "eNarrativeSection")!;
  assert.equal(narrative.instances.length, 1);
  assert.equal(narrative.instances[0]!.parentInstanceId, "synthetic-pcr-1");
  const second = editNonRepeatingScalarValue(first.document, {
    groupId: "eNarrativeSection", groupInstanceId: narrative.instances[0]!.instanceId,
    elementId: "eNarrative.01", occurrenceId: narrative.instances[0]!.elements[0]!.values[0]!.occurrenceId,
  }, "Revised narrative", createId);
  assert.equal(second.ok, true);
  if (!second.ok) throw new Error("expected successful edit");
  assert.equal(second.document.groups.find(({ id }) => id === "eNarrativeSection")!.instances.length, 1);
  assert.equal(second.document.groups.find(({ id }) => id === "PatientCareReportGroup")!.instances.length, 1);
});
