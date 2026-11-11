import assert from "node:assert/strict";
import test from "node:test";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { queuedDraftTargets, pendingDraftTargets, reconcileActiveReportDocument } from "../app/active-report-reconciliation";
import { encounterEvents } from "../app/canonical-events";
import { draftMutationDelta, encounterDocumentToDraftMutations, stableDraftId } from "../app/draft-report";
import { editNonRepeatingScalarValue } from "../app/stationary-non-repeating";
import { removeScalarOccurrence } from "../app/stationary-scalar";
import { bundledEncounterDefinition, INITIAL_SHELL_STATE, transitionShell } from "../app/standard-encounter";

const reportId = "42000000-0000-4000-8000-000000000013";

test("server inbound changes never reconcile app-native notes through the NEMSIS document", () => {
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
  assert.equal(encounterEvents(merged, bundledEncounterDefinition).some(({ id }) => id === "local-note"), false);
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

test("max-one reconciliation does not duplicate distinct client occurrence identities", () => {
  const baseline = structuredClone(synthetic) as EncounterDocument;
  const replaceFirstName = (document: EncounterDocument, occurrenceId: string, value: string): EncounterDocument => ({
    ...document,
    groups: document.groups.map((group) => group.id === "ePatient.PatientNameGroup" ? {
      ...group,
      instances: group.instances.map((instance) => ({
        ...instance,
        elements: [
          ...instance.elements.filter((element) => element.id !== "ePatient.03"),
          { id: "ePatient.03", values: [{ kind: "scalar" as const, occurrenceId, value }] },
        ],
      })),
    } : group),
  });
  const withoutFirstName = replaceFirstName(baseline, "removed", "removed");
  const empty = {
    ...withoutFirstName,
    groups: withoutFirstName.groups.map((group) => group.id === "ePatient.PatientNameGroup" ? {
      ...group,
      instances: group.instances.map((instance) => ({
        ...instance,
        elements: instance.elements.filter((element) => element.id !== "ePatient.03"),
      })),
    } : group),
  };
  const local = replaceFirstName(empty, "local-first-name", "Local winner");
  const server = replaceFirstName(empty, "server-first-name", "Server incumbent");
  const persisted = encounterDocumentToDraftMutations(reportId, empty);
  const command = encounterDocumentToDraftMutations(reportId, local, persisted);
  const targets = pendingDraftTargets(command, persisted);

  const pending = reconcileActiveReportDocument(reportId, local, server, true, targets);
  const pendingValues = pending.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!
    .instances[0]!.elements.find(({ id }) => id === "ePatient.03")!.values;
  assert.deepEqual(pendingValues.map(({ occurrenceId }) => occurrenceId), ["local-first-name"]);

  const winningSnapshot = replaceFirstName(empty, "server-first-name", "Local winner");
  const firstClient = reconcileActiveReportDocument(reportId, local, winningSnapshot, false);
  const secondClient = reconcileActiveReportDocument(reportId, server, winningSnapshot, false);
  assert.deepEqual(firstClient, winningSnapshot);
  assert.deepEqual(secondClient, winningSnapshot);
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


for (const operation of ["edit", "delete"] as const) test(`recovered sparse ${operation} targets survive an already optimistic baseline and disjoint server update`, () => {
  const baseline = structuredClone(synthetic) as EncounterDocument;
  const instance = baseline.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!;
  const occurrence = (elementId: string) => instance.elements.find(({ id }) => id === elementId)!.values[0]!.occurrenceId;
  const edited = operation === "edit"
    ? editNonRepeatingScalarValue(baseline, { groupId: "ePatient.PatientNameGroup", elementId: "ePatient.03", occurrenceId: occurrence("ePatient.03") }, "Retained offline first name", () => "unused")
    : removeScalarOccurrence(baseline, "ePatient.PatientNameGroup", instance.instanceId, "ePatient.03", occurrence("ePatient.03"));
  const inbound = editNonRepeatingScalarValue(baseline, { groupId: "ePatient.PatientNameGroup", elementId: "ePatient.02", occurrenceId: occurrence("ePatient.02") }, "New server last name", () => "unused");
  assert(edited.ok && inbound.ok);
  const accepted = encounterDocumentToDraftMutations(reportId, baseline);
  const recovered = encounterDocumentToDraftMutations(reportId, edited.document, accepted);
  const queued = draftMutationDelta(recovered, accepted);
  // Recovery's cached document already includes the pending command. That does
  // not acknowledge its explicit targets or permit the server to replace them.
  const server = encounterDocumentToDraftMutations(reportId, inbound.document);
  // Some older commands include unchanged parent context. It must not make the
  // whole group authoritative over an unrelated incoming server field.
  const targets = queuedDraftTargets([{...queued, groups: accepted.groups}], server);
  assert(targets.occurrenceIds.size > 0);
  const merged = reconcileActiveReportDocument(reportId, edited.document, inbound.document, true, targets);
  const elements = merged.groups.find(({id}) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements;
  const first = elements.find(({id}) => id === "ePatient.03")?.values[0];
  assert.equal(first?.kind === "scalar" ? first.value : undefined, operation === "edit" ? "Retained offline first name" : undefined);
  const last = elements.find(({id}) => id === "ePatient.02")!.values[0]!;
  assert.equal(last.kind === "scalar" ? last.value : undefined, "New server last name");
});

test("newer unqueued edits reverting a queued value retain authority against the optimistic baseline", () => {
  const baseline = structuredClone(synthetic) as EncounterDocument;
  const elements = baseline.groups.find(({id}) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements;
  const occurrence = (id: string) => elements.find(element => element.id === id)!.values[0]!.occurrenceId;
  const queuedEdit = editNonRepeatingScalarValue(baseline, {groupId:"ePatient.PatientNameGroup",elementId:"ePatient.03",occurrenceId:occurrence("ePatient.03")}, "Queued first name", () => "unused");
  const inbound = editNonRepeatingScalarValue(baseline, {groupId:"ePatient.PatientNameGroup",elementId:"ePatient.02",occurrenceId:occurrence("ePatient.02")}, "New server last name", () => "unused");
  assert(queuedEdit.ok && inbound.ok);
  const accepted = encounterDocumentToDraftMutations(reportId, baseline);
  const optimistic = encounterDocumentToDraftMutations(reportId, queuedEdit.document, accepted);
  // The clinician changed the queued value back to the original while its
  // acknowledgement was pending. Compare this new edit with queued state.
  const localDelta = draftMutationDelta(encounterDocumentToDraftMutations(reportId, baseline, optimistic), optimistic);
  const targets = pendingDraftTargets(localDelta, optimistic);
  assert(targets.occurrenceIds.size > 0);
  const merged = reconcileActiveReportDocument(reportId, baseline, inbound.document, true, targets);
  const mergedElements = merged.groups.find(({id}) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements;
  assert.deepEqual(mergedElements.find(({id}) => id === "ePatient.03"), elements.find(({id}) => id === "ePatient.03"));
  const last = mergedElements.find(({id}) => id === "ePatient.02")!.values[0]!;
  assert.equal(last.kind === "scalar" ? last.value : undefined, "New server last name");
});
