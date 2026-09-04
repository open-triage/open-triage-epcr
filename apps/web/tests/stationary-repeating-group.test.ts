import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { encounterDocumentDiagnostics } from "../app/encounter-document";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { pendingDraftTargets, reconcileActiveReportDocument } from "../app/active-report-reconciliation";
import { loadShellStateResult, saveShellState } from "../app/local-persistence";
import { INITIAL_SHELL_STATE } from "../app/standard-encounter";
import { editScalarOccurrence } from "../app/stationary-scalar";
import { editStationaryCodedValue } from "../app/stationary-coded-value";
import {
  addRepeatingGroupOccurrence,
  configuredRepeatingGroupRoots,
  configuredRepeatingGroups,
  ensureNestedSingleGroupOccurrence,
  moveRepeatingGroupOccurrence,
  removeRepeatingGroupOccurrence,
  removeNestedGroupOccurrence,
  repeatingGroupInstances,
  repeatingGroupSummary,
} from "../app/stationary-repeating-group";
import { StationaryRepeatingGroups } from "../components/stationary-repeating-groups";

const reportId = "42000000-0000-4000-8000-000000000063";

function documentWithSceneResponderParent(): EncounterDocument {
  return structuredClone(synthetic) as EncounterDocument;
}

test("every root repeating group has a table while nested tables stay in their parent row workflow", () => {
  const document = documentWithSceneResponderParent();
  const configured = configuredRepeatingGroups();
  const roots = configuredRepeatingGroupRoots();
  assert.ok(configured.length > 30);
  assert.ok(roots.length < configured.length);
  assert.ok(roots.some(({ id }) => id === "eLabs.LabGroup"));
  assert.ok(!roots.some(({ id }) => id === "eLabs.LabResultGroup"));
  const html = renderToStaticMarkup(createElement(StationaryRepeatingGroups, { document, onDocumentChange() {} }));
  for (const placement of roots) {
    assert.match(html, new RegExp(`data-group-id="${placement.id.replaceAll(".", "\\.")}"`));
    if (placement.mode !== "read-only") assert.ok(html.includes(placement.presentation.dialog!.addLabel));
  }
  assert.ok(!html.includes('data-group-id="eLabs.LabResultGroup"'));
  assert.match(html, /role="region"/);
  assert.match(html, /tabindex="0"/);
});

test("rows add, edit, reorder, remove, and project stable canonical identities", () => {
  let document = documentWithSceneResponderParent();
  const parentId = "synthetic-scene-1";
  const first = addRepeatingGroupOccurrence(document, "eScene.ResponderGroup", parentId, () => "responder-row-1", new Date("2026-09-04T12:00:00Z"));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  document = first.document;
  const second = addRepeatingGroupOccurrence(document, "eScene.ResponderGroup", parentId, () => "responder-row-2");
  assert.equal(second.ok, true);
  if (!second.ok) return;
  document = second.document;

  const scalar = editScalarOccurrence(document, {
    groupId: "eScene.ResponderGroup", groupInstanceId: first.instanceId, elementId: "eScene.02", input: "Mutual Aid 7",
  }, () => "responder-agency-occurrence");
  assert.equal(scalar.ok, true);
  if (!scalar.ok) return;
  document = editStationaryCodedValue(scalar.document, {
    groupId: "eScene.ResponderGroup", instanceId: first.instanceId, elementId: "eScene.04",
  }, { kind: "coded", code: "2704003", display: "Fire" }, () => "responder-service-occurrence");

  const placement = configuredRepeatingGroups().find(({ id }) => id === "eScene.ResponderGroup")!;
  const row = repeatingGroupInstances(document, placement.id, parentId)[0]!;
  assert.equal(row.instanceId, "responder-row-1");
  const summary = repeatingGroupSummary(document, placement, row);
  assert.deepEqual(summary[0]!.values, [{ occurrenceId: "responder-agency-occurrence", text: "Mutual Aid 7" }]);
  assert.deepEqual(summary[2]!.values, [{ occurrenceId: "responder-service-occurrence", text: "Fire" }]);

  const draft = encounterDocumentToDraftMutations(reportId, document);
  const groupMutation = draft.groups.find(({ groupId }) => groupId === "eScene.ResponderGroup")!;
  assert.ok(groupMutation.id, "the stable canonical row identity projects to a stable draft target");
  assert.ok(draft.occurrences.some(({ groupInstanceId, elementId }) => groupInstanceId === groupMutation.id && elementId === "eScene.02"));

  const moved = moveRepeatingGroupOccurrence(document, placement.id, second.instanceId, 0);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.deepEqual(repeatingGroupInstances(moved.document, placement.id, parentId).map(({ instanceId }) => instanceId), ["responder-row-2", "responder-row-1"]);
  const removed = removeRepeatingGroupOccurrence(moved.document, placement.id, second.instanceId);
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(repeatingGroupInstances(removed.document, placement.id, parentId).map(({ instanceId }) => instanceId), ["responder-row-1"]);
  assert.deepEqual(encounterDocumentDiagnostics(removed.document), []);
});

test("group cardinality, duplicate identity, and parent ownership are enforced", () => {
  const document = documentWithSceneResponderParent();
  assert.equal(addRepeatingGroupOccurrence(document, "eScene.ResponderGroup", "missing-parent").ok, false);
  const added = addRepeatingGroupOccurrence(document, "eScene.ResponderGroup", "synthetic-scene-1", () => "SYNTHETIC-SOURCE-RECORD-0001:demo-crew");
  assert.equal(added.ok, false, "instance ids are unique across every canonical group");
  const crew = removeRepeatingGroupOccurrence(document, "eCrew.CrewGroup", "SYNTHETIC-SOURCE-RECORD-0001:demo-crew");
  assert.equal(crew.ok, true, "a zero-minimum final row removes its now-empty group container");
  if (crew.ok) assert.equal(crew.document.groups.some(({ id }) => id === "eCrew.CrewGroup"), false);
});

test("adding a top-level repeating row creates only its missing non-repeating ancestry", () => {
  const document = documentWithSceneResponderParent();
  let sequence = 0;
  const added = addRepeatingGroupOccurrence(document, "ePayment.SupplyItemGroup", undefined, () => `created-${++sequence}`);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const payment = added.document.groups.find(({ id }) => id === "ePaymentSection")?.instances[0];
  const supply = added.document.groups.find(({ id }) => id === "ePayment.SupplyItemGroup")?.instances[0];
  assert.equal(payment?.parentInstanceId, "synthetic-pcr-1");
  assert.equal(supply?.parentInstanceId, payment?.instanceId);
  assert.equal(supply?.instanceId, added.instanceId);
});

test("removing a parent row removes nested canonical group occurrences without orphaning them", () => {
  let document = documentWithSceneResponderParent();
  const parent = addRepeatingGroupOccurrence(document, "eLabs.LabGroup", "synthetic-pcr-1", () => "lab-row");
  assert.equal(parent.ok, false, "a group cannot skip its required section parent");
  document = {
    ...document,
    groups: [...document.groups, { id: "eLabsSection", instances: [{ instanceId: "labs-section", parentInstanceId: "synthetic-pcr-1", elements: [] }] }],
  };
  const lab = addRepeatingGroupOccurrence(document, "eLabs.LabGroup", "labs-section", () => "lab-row");
  assert.equal(lab.ok, true);
  if (!lab.ok) return;
  const result = addRepeatingGroupOccurrence(lab.document, "eLabs.LabResultGroup", "lab-row", () => "lab-result-row");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const removed = removeRepeatingGroupOccurrence(result.document, "eLabs.LabGroup", "lab-row");
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.document.groups.some(({ id }) => id === "eLabs.LabGroup" || id === "eLabs.LabResultGroup"), false);
});

test("multiple parent rows keep independent nested children and enforce single cardinality per parent", () => {
  const baseline = documentWithSceneResponderParent();
  const withLabs = {
    ...baseline,
    groups: [...baseline.groups, { id: "eLabsSection", instances: [{ instanceId: "labs-section", parentInstanceId: "synthetic-pcr-1", elements: [] }] }],
  } satisfies EncounterDocument;
  const first = addRepeatingGroupOccurrence(withLabs, "eLabs.LabGroup", "labs-section", () => "lab-one");
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addRepeatingGroupOccurrence(first.document, "eLabs.LabGroup", "labs-section", () => "lab-two");
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const firstResult = addRepeatingGroupOccurrence(second.document, "eLabs.LabResultGroup", "lab-one", () => "result-one");
  assert.equal(firstResult.ok, true);
  if (!firstResult.ok) return;
  const secondResult = addRepeatingGroupOccurrence(firstResult.document, "eLabs.LabResultGroup", "lab-two", () => "result-two");
  assert.equal(secondResult.ok, true);
  if (!secondResult.ok) return;
  assert.deepEqual(repeatingGroupInstances(secondResult.document, "eLabs.LabResultGroup", "lab-one").map(({ instanceId }) => instanceId), ["result-one"]);
  assert.deepEqual(repeatingGroupInstances(secondResult.document, "eLabs.LabResultGroup", "lab-two").map(({ instanceId }) => instanceId), ["result-two"]);

  const withVitals = {
    ...secondResult.document,
    groups: [...secondResult.document.groups,
      { id: "eVitalsSection", instances: [{ instanceId: "vitals-section", parentInstanceId: "synthetic-pcr-1", elements: [] }] },
      { id: "eVitals.VitalGroup", instances: [{ instanceId: "vital-one", parentInstanceId: "vitals-section", elements: [] }, { instanceId: "vital-two", parentInstanceId: "vitals-section", elements: [] }] }],
  } satisfies EncounterDocument;
  const temperatureOne = ensureNestedSingleGroupOccurrence(withVitals, "eVitals.TemperatureGroup", "vital-one", () => "temperature-one");
  assert.equal(temperatureOne.ok, true);
  if (!temperatureOne.ok) return;
  const sameTemperature = ensureNestedSingleGroupOccurrence(temperatureOne.document, "eVitals.TemperatureGroup", "vital-one", () => "duplicate-temperature");
  assert.equal(sameTemperature.ok, true);
  if (!sameTemperature.ok) return;
  assert.equal(sameTemperature.instanceId, "temperature-one");
  const temperatureTwo = ensureNestedSingleGroupOccurrence(sameTemperature.document, "eVitals.TemperatureGroup", "vital-two", () => "temperature-two");
  assert.equal(temperatureTwo.ok, true);
  if (!temperatureTwo.ok) return;
  assert.equal(temperatureTwo.document.groups.find(({ id }) => id === "eVitals.TemperatureGroup")?.instances.length, 2);
  const rhythm = ensureNestedSingleGroupOccurrence(temperatureTwo.document, "eVitals.CardiacRhythmGroup", "vital-one", () => "rhythm-one");
  assert.equal(rhythm.ok, true);
  if (!rhythm.ok) return;
  assert.equal(removeNestedGroupOccurrence(rhythm.document, "eVitals.CardiacRhythmGroup", "rhythm-one").ok, false, "a required single child cannot be removed");
  assert.equal(ensureNestedSingleGroupOccurrence(temperatureTwo.document, "eVitals.TemperatureGroup", "not-a-vital").ok, false);
});

test("nested identities and canonical parent links survive offline reopen and synchronization", () => {
  const baseline = documentWithSceneResponderParent();
  const withLabs = {
    ...baseline,
    groups: [...baseline.groups, { id: "eLabsSection", instances: [{ instanceId: "labs-section", parentInstanceId: "synthetic-pcr-1", elements: [] }] }],
  } satisfies EncounterDocument;
  const lab = addRepeatingGroupOccurrence(withLabs, "eLabs.LabGroup", "labs-section", () => "offline-lab");
  assert.equal(lab.ok, true);
  if (!lab.ok) return;
  const result = addRepeatingGroupOccurrence(lab.document, "eLabs.LabResultGroup", lab.instanceId, () => "offline-lab-result");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const values = new Map<string, string>();
  const storage = { getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, value); }, removeItem(key: string) { values.delete(key); } };
  saveShellState(storage, { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document: result.document } }, reportId);
  const reopened = loadShellStateResult(storage, undefined, reportId);
  assert.equal(reopened.status, "restored");
  if (reopened.status !== "restored") return;
  const reopenedChild = repeatingGroupInstances(reopened.state.encounter.document, "eLabs.LabResultGroup", "offline-lab")[0];
  assert.equal(reopenedChild?.instanceId, "offline-lab-result");
  assert.equal(reopenedChild?.parentInstanceId, "offline-lab");

  const persisted = encounterDocumentToDraftMutations(reportId, baseline);
  const pending = encounterDocumentToDraftMutations(reportId, reopened.state.encounter.document, persisted);
  const childMutation = pending.groups.find(({ groupId }) => groupId === "eLabs.LabResultGroup");
  const parentMutation = pending.groups.find(({ groupId }) => groupId === "eLabs.LabGroup");
  assert.equal(childMutation?.parentGroupInstanceId, parentMutation?.id);
  const synchronized = reconcileActiveReportDocument(reportId, reopened.state.encounter.document, baseline, true, pendingDraftTargets(pending, persisted));
  const synchronizedChild = repeatingGroupInstances(synchronized, "eLabs.LabResultGroup", "offline-lab")[0];
  assert.equal(synchronizedChild?.instanceId, "offline-lab-result");
  assert.equal(synchronizedChild?.parentInstanceId, "offline-lab");
});

test("offline reopen and cross-presentation reconciliation retain a pending table row", () => {
  const baseline = documentWithSceneResponderParent();
  const added = addRepeatingGroupOccurrence(baseline, "eScene.ResponderGroup", "synthetic-scene-1", () => "offline-responder-row");
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const edited = editScalarOccurrence(added.document, {
    groupId: "eScene.ResponderGroup", groupInstanceId: added.instanceId, elementId: "eScene.02", input: "Offline agency",
  }, () => "offline-responder-value");
  assert.equal(edited.ok, true);
  if (!edited.ok) return;

  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  saveShellState(storage, { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document: edited.document } }, reportId);
  const reopened = loadShellStateResult(storage, undefined, reportId);
  assert.equal(reopened.status, "restored");
  if (reopened.status !== "restored") return;
  assert.ok(repeatingGroupInstances(reopened.state.encounter.document, "eScene.ResponderGroup").some(({ instanceId }) => instanceId === "offline-responder-row"));

  const persisted = encounterDocumentToDraftMutations(reportId, baseline);
  const command = encounterDocumentToDraftMutations(reportId, reopened.state.encounter.document, persisted);
  const merged = reconcileActiveReportDocument(reportId, reopened.state.encounter.document, baseline, true, pendingDraftTargets(command, persisted));
  const row = repeatingGroupInstances(merged, "eScene.ResponderGroup").find(({ instanceId }) => instanceId === "offline-responder-row");
  assert.equal(row?.elements[0]?.values[0]?.occurrenceId, "offline-responder-value");
});
