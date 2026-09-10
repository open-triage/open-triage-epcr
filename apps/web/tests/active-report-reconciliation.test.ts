import assert from "node:assert/strict";
import test from "node:test";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { pendingDraftTargets, reconcileActiveReportDocument } from "../app/active-report-reconciliation";
import { encounterEvents } from "../app/canonical-events";
import { encounterDocumentToDraftMutations, stableDraftId } from "../app/draft-report";
import { editNonRepeatingScalarValue } from "../app/stationary-non-repeating";
import { removeScalarOccurrence } from "../app/stationary-scalar";
import { bundledEncounterDefinition, INITIAL_SHELL_STATE, transitionShell } from "../app/standard-encounter";

const reportId = "42000000-0000-4000-8000-000000000013";

test("server inbound changes merge with unsaved clinician groups by stable identity", () => {
  let local = transitionShell(INITIAL_SHELL_STATE, { type: "note-started", id: "local-note", date: "2026-09-03", time: "12:01" });
  local = transitionShell(local, { type: "note-draft-changed", field: "summary", value: "Unsaved local correction" });
  local = transitionShell(local, { type: "note-saved" });
  const baseline = structuredClone(synthetic) as EncounterDocument;
  const server = { ...baseline, groups: baseline.groups.map((group) => group.id === "ePatient.PatientNameGroup" ? {
    ...group,
    instances: group.instances.map((instance) => ({ ...instance, elements: instance.elements.map((element) => element.id === "ePatient.02" ? {
      ...element, values: element.values.map((value) => value.kind === "scalar" ? { ...value, value: "Dispatch update" } : value),
    } : element) })),
  } : group) };
  const changedServer = { ...server, groups: [...server.groups, { id: "eNarrativeSection", instances: [{
    instanceId: stableDraftId(reportId, "group:local-note"),
    elements: [{ id: "eNarrative.01", values: [{ kind: "scalar", occurrenceId: "server-note", value: "Older server value" }] }],
  }] }] } as EncounterDocument;

  const merged = reconcileActiveReportDocument(reportId, local.encounter.document, changedServer);
  assert.equal(encounterEvents(merged, bundledEncounterDefinition).find(({ id }) => id === "local-note")?.detail, "Unsaved local correction");
  assert.equal(merged.groups.find(({ id }) => id === "eNarrativeSection")?.instances.length, 1);
  const lastName = merged.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements.find(({ id }) => id === "ePatient.02")!.values[0];
  assert.equal(lastName?.kind === "scalar" ? lastName.value : null, "Dispatch update");
});

test("pending clinician removals stay removed while a clean report accepts the server document", () => {
  let local = transitionShell(INITIAL_SHELL_STATE, { type: "note-started", id: "removed-note", date: "2026-09-03", time: "12:01" });
  local = transitionShell(local, { type: "note-draft-changed", field: "summary", value: "Remove me" });
  local = transitionShell(local, { type: "note-saved" });
  const server = structuredClone(local.encounter.document);
  local = transitionShell(local, { type: "note-opened", id: "removed-note" });
  local = transitionShell(local, { type: "note-removed" });

  const pending = reconcileActiveReportDocument(reportId, local.encounter.document, server, true);
  assert.equal(encounterEvents(pending, bundledEncounterDefinition).some(({ id }) => id === "removed-note"), false);
  assert.equal(reconcileActiveReportDocument(reportId, local.encounter.document, server, false), server);
});

test("target-aware reconciliation keeps a stationary field edit and a disjoint server field edit", () => {
  const baseline = structuredClone(synthetic) as EncounterDocument;
  const nameElements = baseline.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements;
  const occurrenceId = (elementId: string) => nameElements.find((element) => element.id === elementId)!.values[0]!.occurrenceId;
  const localEdit = editNonRepeatingScalarValue(baseline, { groupId: "ePatient.PatientNameGroup", elementId: "ePatient.03", occurrenceId: occurrenceId("ePatient.03") }, "Local first name", () => "unused");
  const serverEdit = editNonRepeatingScalarValue(baseline, { groupId: "ePatient.PatientNameGroup", elementId: "ePatient.02", occurrenceId: occurrenceId("ePatient.02") }, "Server last name", () => "unused");
  assert.ok(localEdit.ok, "expected the local scalar edit to succeed");
  assert.ok(serverEdit.ok, "expected the server scalar edit to succeed");
  const local = localEdit.document;
  const server = serverEdit.document;
  const persisted = encounterDocumentToDraftMutations(reportId, baseline);
  const command = encounterDocumentToDraftMutations(reportId, local, persisted);
  const targets = pendingDraftTargets(command, persisted);

  const merged = reconcileActiveReportDocument(reportId, local, server, true, targets);
  const values = merged.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements;
  const scalar = (id: string) => {
    const value = values.find((element) => element.id === id)!.values[0]!;
    return value.kind === "scalar" ? value.value : null;
  };
  assert.equal(scalar("ePatient.02"), "Server last name");
  assert.equal(scalar("ePatient.03"), "Local first name");
});

test("target-aware reconciliation keeps a pending occurrence deletion during a server refresh", () => {
  const baseline = structuredClone(synthetic) as EncounterDocument;
  const nameInstance = baseline.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!;
  const nameElements = nameInstance.elements;
  const occurrenceId = (elementId: string) => nameElements.find((element) => element.id === elementId)!.values[0]!.occurrenceId;
  const localDeletion = removeScalarOccurrence(
    baseline,
    "ePatient.PatientNameGroup",
    nameInstance.instanceId,
    "ePatient.03",
    occurrenceId("ePatient.03"),
  );
  const serverEdit = editNonRepeatingScalarValue(baseline, {
    groupId: "ePatient.PatientNameGroup",
    elementId: "ePatient.02",
    occurrenceId: occurrenceId("ePatient.02"),
  }, "Server last name", () => "unused");
  assert.ok(localDeletion.ok, "expected the local scalar deletion to succeed");
  assert.ok(serverEdit.ok, "expected the server scalar edit to succeed");
  const persisted = encounterDocumentToDraftMutations(reportId, baseline);
  const command = encounterDocumentToDraftMutations(reportId, localDeletion.document, persisted);
  const targets = pendingDraftTargets(command, persisted);

  const merged = reconcileActiveReportDocument(reportId, localDeletion.document, serverEdit.document, true, targets);
  const values = merged.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements;
  assert.equal(values.find(({ id }) => id === "ePatient.03"), undefined);
  const lastName = values.find(({ id }) => id === "ePatient.02")!.values[0]!;
  assert.equal(lastName.kind === "scalar" ? lastName.value : null, "Server last name");
});
