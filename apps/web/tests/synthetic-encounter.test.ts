import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_SHELL_STATE, syntheticEncounter, transitionShell } from "../app/synthetic-encounter";

test("opens directly into the fixed synthetic chest-pain encounter", () => {
  assert.equal(INITIAL_SHELL_STATE.view, "timeline");
  assert.equal(syntheticEncounter.synthetic, true);
  assert.equal(syntheticEncounter.scenarioId, "adult-chest-pain-v1");
  assert.equal(syntheticEncounter.patient.name, "Lindqvist, Margareta");
  assert.match(syntheticEncounter.incident.complaint, /chest pain/i);
  assert.match(syntheticEncounter.incident.address, /fictional/i);
  assert.equal(syntheticEncounter.events.length, 17);
});

test("Timeline and Checklist navigation preserves the encounter", () => {
  const checklistState = transitionShell(INITIAL_SHELL_STATE, { type: "view-selected", view: "checklist" });
  const timelineState = transitionShell(checklistState, { type: "view-selected", view: "timeline" });
  assert.equal(checklistState.view, "checklist");
  assert.equal(timelineState.view, "timeline");
  assert.strictEqual(checklistState.encounter, syntheticEncounter);
  assert.strictEqual(timelineState.encounter, syntheticEncounter);
  assert.equal(timelineState.encounter.requiredRemaining, 3);
});

test("required count matches incomplete checklist items", () => {
  const incomplete = syntheticEncounter.checklist.filter((item) => !item.complete);
  assert.equal(incomplete.length, syntheticEncounter.requiredRemaining);
});
