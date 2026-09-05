import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import {
  commandSha256,
  DraftReportValidationError,
  validateCreateDraftReportCommand,
  validateSaveDraftReportCommand
} from "../dist/reports/draft-report.validation.js";
import { storedEncounterValue } from "../dist/reports/encounter-document.persistence.js";

test("active-report reconstruction retains coded terminology metadata", () => {
  assert.deepEqual(storedEncounterValue({
    id: "coded-occurrence", group_instance_id: "group", element_id: "eScene.09", ordinal: 0,
    value_kind: "coded", value_text: null, value_integer: null, value_numeric: null,
    value_boolean: null, value_date: null, value_datetime: null, value_time: null,
    value_duration: null, value_binary: null, code: "Y92.03", code_system: "ICD-10-CM",
    code_display: "Apartment/condo", terminology_version: "2025-03-06",
    absence_code: null, absence_display: null, source_attributes: null,
    provenance_kind: "clinician", provenance_detail: null
  }), {
    occurrenceId: "coded-occurrence", kind: "coded", code: "Y92.03",
    system: "ICD-10-CM", display: "Apartment/condo", terminologyVersion: "2025-03-06"
  });
});

test("draft creation requires offline-safe UUIDv4 identities", () => {
  const command = {
    commandId: randomUUID(), reportId: randomUUID(), incidentId: randomUUID(), patientId: randomUUID(),
    organizationId: randomUUID(), documentingUserId: randomUUID(), formId: randomUUID(),
    patientIdentityState: "unknown"
  };
  assert.deepEqual(validateCreateDraftReportCommand(command), command);
  assert.throws(() => validateCreateDraftReportCommand({ ...command, reportId: "32000000-0000-3000-8000-000000000001" }),
    (error) => error instanceof DraftReportValidationError && error.findings.some((finding) => /reportId.*UUIDv4/.test(finding)));
  assert.throws(() => validateCreateDraftReportCommand({ ...command, patientPseudonymousKey: "a".repeat(64) }),
    (error) => error instanceof DraftReportValidationError && error.findings.some((finding) => /server-derived/.test(finding)));
});

test("patient HMAC keys are versioned, stable, and installation scoped", () => {
  const base = {
    PATIENT_KEY_INSTALLATION_ID: "10000000-0000-4000-8000-000000000001",
    PATIENT_KEY_VERSION: "7",
    PATIENT_KEY_SECRET_BASE64: Buffer.alloc(32, 0x5a).toString("base64")
  };
  const organizationId = "20000000-0000-4000-8000-000000000001";
  const patientId = "30000000-0000-4000-8000-000000000001";
  const first = derivePatientKey(patientKeyConfigFromEnvironment(base), organizationId, patientId);
  assert.equal(first, derivePatientKey(patientKeyConfigFromEnvironment(base), organizationId, patientId));
  assert.notEqual(first, derivePatientKey(patientKeyConfigFromEnvironment({
    ...base, PATIENT_KEY_INSTALLATION_ID: "10000000-0000-4000-8000-000000000002"
  }), organizationId, patientId));
  assert.notEqual(first, derivePatientKey(patientKeyConfigFromEnvironment({
    ...base, PATIENT_KEY_VERSION: "8", PATIENT_KEY_SECRET_BASE64: Buffer.alloc(32, 0x6b).toString("base64")
  }), organizationId, patientId));
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
