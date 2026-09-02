import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_SHELL_STATE, syntheticEncounter, bundledEncounterDefinition, transitionShell } from "../app/standard-encounter";
import { patientSummary } from "../app/patient-document";
import { documentTimeline, incidentSummary } from "../app/incident-document";

test("opens directly into the fictional neutral standard encounter", () => {
  assert.equal(INITIAL_SHELL_STATE.view, "timeline");
  assert.equal(syntheticEncounter.synthetic, true);
  assert.equal(syntheticEncounter.definitionId, "standard-encounter-v1");
  assert.equal(patientSummary(syntheticEncounter.document).name, "Rivera, Jordan");
  assert.equal(incidentSummary(syntheticEncounter.document).complaint, "Medical assistance requested");
  assert.match(incidentSummary(syntheticEncounter.document).address, /fictional/i);
  assert.equal(syntheticEncounter.events.length, 0);
  assert.equal(syntheticEncounter.document.formProfile.id, bundledEncounterDefinition.id);
  assert.deepEqual(documentTimeline(syntheticEncounter.document).map((event) => event.reference), [
    "eTimes.06",
    "eTimes.05",
    "eTimes.03",
    "eTimes.01",
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
