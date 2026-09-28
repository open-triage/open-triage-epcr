import assert from "node:assert/strict";
import test from "node:test";
import { groupReviewFindings } from "../app/review-presentation";
import { displayValidationRuleMessage } from "../app/stationary-validation";

test("review sections retain each finding and correction target exactly once", () => {
  const findings = [
    { id: "patient-name", target: { groupId: "ePatient.PatientNameGroup", elementId: "ePatient.03" } },
    { id: "time", target: { groupId: "eTimesSection", elementId: "eTimes.03" } },
    { id: "patient-age", target: { groupId: "ePatient.AgeGroup", elementId: "ePatient.15" } },
  ];
  const sections = groupReviewFindings(findings);
  assert.equal(sections.length, 2);
  assert.equal(sections[0]!.label, "Patient");
  assert.deepEqual(sections[0]!.findings, [findings[0], findings[2]]);
  assert.deepEqual(sections[1]!.findings, [findings[1]]);
});

test("required-value messages are actionable without altering arbitrary authored rules", () => {
  assert.equal(displayValidationRuleMessage("Age requires at least 1 documented occurrence(s)", "ePatient.15", []), "Record Age.");
  assert.equal(displayValidationRuleMessage("Vitals requires at least 2 documented occurrence(s)", "eVitals.01", []), "Record at least 2 entries for Vitals.");
  assert.equal(displayValidationRuleMessage("Explain why no age could be obtained.", "ePatient.15", []), "Explain why no age could be obtained.");
});
