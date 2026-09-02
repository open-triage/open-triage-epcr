import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_SHELL_STATE, syntheticEncounter, bundledEncounterDefinition, transitionShell } from "../app/standard-encounter";
import { patientSummary } from "../app/patient-document";

test("opens directly into the fictional neutral standard encounter", () => {
  assert.equal(INITIAL_SHELL_STATE.view, "timeline");
  assert.equal(syntheticEncounter.synthetic, true);
  assert.equal(syntheticEncounter.definitionId, "standard-encounter-v1");
  assert.equal(patientSummary(syntheticEncounter.document).name, "Rivera, Jordan");
  assert.equal(syntheticEncounter.incident.complaint, "Medical assistance requested");
  assert.match(syntheticEncounter.incident.address, /fictional/i);
  assert.equal(syntheticEncounter.events.length, 4);
  assert.equal(syntheticEncounter.document.formProfile.id, bundledEncounterDefinition.id);
  assert.equal(syntheticEncounter.incident, bundledEncounterDefinition.dispatch.incident);
  assert.deepEqual(syntheticEncounter.events.map((event) => event.reference), [
    "eTimes.07",
    "eTimes.06",
    "eTimes.03 · eDispatch.02 · eDispatch.06",
    "eTimes.01 · eDispatch.01 · eDispatch.05",
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
