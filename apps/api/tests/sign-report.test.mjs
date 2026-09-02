import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  SignReportValidationError,
  validateSignReportCommand
} from "../dist/reports/sign-report.validation.js";

test("sign commands require a revision, signer, and explicit attestation", () => {
  const command = {
    commandId: randomUUID(),
    expectedRevision: 7,
    signerId: randomUUID(),
    attestation: { meaning: "I authored and approve this clinical report" },
    actorPersona: "clinician",
    clientTime: "2026-08-30T14:30:00-04:00"
  };
  assert.deepEqual(validateSignReportCommand(command), command);
  assert.throws(() => validateSignReportCommand({ ...command, expectedRevision: -1, attestation: {} }),
    (error) => error instanceof SignReportValidationError &&
      error.findings.some((finding) => finding.includes("expectedRevision")) &&
      error.findings.some((finding) => finding.includes("attestation")));
});
