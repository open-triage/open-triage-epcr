import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AmendReportValidationError,
  validateAmendReportCommand
} from "../dist/reports/amend-report.validation.js";

test("amendment commands require independent signing, a reason, sequence, and typed overlays", () => {
  const target = randomUUID();
  const command = {
    commandId: randomUUID(),
    expectedSequence: 1,
    authorId: randomUUID(),
    reason: "Correct a transcription error",
    attestation: { meaning: "I attest that this correction is accurate" },
    changes: [
      { action: "replace", targetElementOccurrenceId: target, value: { kind: "integer", value: 118 } },
      { action: "add", occurrence: { id: randomUUID(), elementId: "eNarrative.01", value: { kind: "text", value: "Addendum" } } }
    ]
  };
  assert.deepEqual(validateAmendReportCommand(command), command);

  assert.throws(() => validateAmendReportCommand({ ...command, reason: " ", attestation: {}, changes: [] }),
    (error) => error instanceof AmendReportValidationError &&
      error.findings.some((finding) => finding.includes("reason")) &&
      error.findings.some((finding) => finding.includes("attestation")) &&
      error.findings.some((finding) => finding.includes("changes")));
  assert.throws(() => validateAmendReportCommand({
    ...command,
    changes: [
      { action: "remove", targetElementOccurrenceId: target },
      { action: "replace", targetElementOccurrenceId: target, value: { kind: "text", value: "duplicate" } }
    ]
  }), (error) => error instanceof AmendReportValidationError &&
    error.findings.some((finding) => finding.includes("changed more than once")));
});
