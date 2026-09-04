import assert from "node:assert/strict";
import test from "node:test";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { reconcileActiveReportDocument } from "../app/active-report-reconciliation";
import { encounterEvents } from "../app/canonical-events";
import { stableDraftId } from "../app/draft-report";
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
