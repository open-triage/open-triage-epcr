import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_SHELL_STATE, syntheticEncounter, bundledEncounterDefinition, transitionShell } from "../app/standard-encounter";
import { documentTimeline, incidentSummary } from "../app/incident-document";
import { encounterEvents } from "../app/canonical-events";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";

test("opens directly into the fictional neutral standard encounter", () => {
  assert.equal(INITIAL_SHELL_STATE.view, "timeline");
  assert.equal(syntheticEncounter.synthetic, true);
  assert.equal(syntheticEncounter.definitionId, "standard-encounter-v1");
  const patientNames = syntheticEncounter.document.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!.instances[0]!.elements
    .flatMap(({ values }) => values.flatMap((value) => value.kind === "scalar" ? [String(value.value)] : []));
  assert.deepEqual(patientNames, ["Rivera", "Jordan"]);
  assert.equal(incidentSummary(syntheticEncounter.document).callSign, "AN");
  assert.match(incidentSummary(syntheticEncounter.document).location, /fictional/i);
  assert.equal(encounterEvents(INITIAL_SHELL_STATE.encounter.document, standardEncounterDefinition).length, 0);
  assert.equal(syntheticEncounter.document.formProfile.id, bundledEncounterDefinition.id);
  assert.deepEqual(documentTimeline(syntheticEncounter.document).map((event) => event.reference), [
    "eTimes.06",
    "eTimes.05",
    "eTimes.03",
  ]);
});

test("Timeline and Checklist navigation preserves the encounter", () => {
  const checklistState = transitionShell(INITIAL_SHELL_STATE, { type: "view-selected", view: "checklist" });
  const timelineState = transitionShell(checklistState, { type: "view-selected", view: "timeline" });
  assert.equal(checklistState.view, "checklist");
  assert.equal(timelineState.view, "timeline");
  assert.strictEqual(checklistState.encounter, syntheticEncounter);
  assert.strictEqual(timelineState.encounter, syntheticEncounter);
});
