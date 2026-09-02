import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  commandSha256,
  DraftReportValidationError,
  validateCreateDraftReportCommand,
  validateSaveDraftReportCommand
} from "../dist/reports/draft-report.validation.js";

test("draft creation requires offline-safe UUIDv4 identities", () => {
  const command = {
    commandId: randomUUID(), reportId: randomUUID(), incidentId: randomUUID(), patientId: randomUUID(),
    organizationId: randomUUID(), documentingUserId: randomUUID(), formId: randomUUID(),
    patientIdentityState: "unknown", patientPseudonymousKey: "a".repeat(64)
  };
  assert.deepEqual(validateCreateDraftReportCommand(command), command);
  assert.throws(() => validateCreateDraftReportCommand({ ...command, reportId: "32000000-0000-3000-8000-000000000001" }),
    (error) => error instanceof DraftReportValidationError && error.findings.some((finding) => /reportId.*UUIDv4/.test(finding)));
});

test("draft changes accept each sparse typed value and explicit incomplete state", () => {
  const values = [
    { kind: "text", value: "narrative" },
    { kind: "integer", value: "42", lexical: "042" },
    { kind: "numeric", value: "12.50" },
    { kind: "boolean", value: false },
    { kind: "date", value: "2026-08-30", precision: "day" },
    { kind: "datetime", value: "2026-08-30T14:03:04-04:00", utcOffsetMinutes: -240, precision: "second" },
    { kind: "time", value: "14:03:04", utcOffsetMinutes: -240 },
    { kind: "duration", value: "PT12M" },
    { kind: "binary", value: "AQID" },
    { kind: "uri", value: "https://example.test/value" },
    { kind: "coded", code: "A", codeSystem: "urn:test", display: "Alpha" },
    { kind: "null", absenceCode: "7701003", display: "Not recorded" },
    { kind: "pertinent-negative", absenceCode: "8801005", display: "Denied" },
    { kind: "absent" }
  ];
  const command = {
    commandId: randomUUID(), expectedRevision: 0, authorId: randomUUID(),
    occurrences: values.map((value, index) => ({ id: randomUUID(), elementId: `test.${index}`, value }))
  };
  assert.deepEqual(validateSaveDraftReportCommand(command), command);
  assert.throws(() => validateSaveDraftReportCommand({ ...command, occurrences: [{
    id: randomUUID(), elementId: "test.bad", value: { kind: "numeric", value: "NaN" }
  }] }), (error) => error instanceof DraftReportValidationError && error.findings.some((finding) => /finite decimal/.test(finding)));
});

test("command digests are stable across object key order", () => {
  assert.equal(commandSha256({ reportId: "one", nested: { b: 2, a: 1 } }),
    commandSha256({ nested: { a: 1, b: 2 }, reportId: "one" }));
});
