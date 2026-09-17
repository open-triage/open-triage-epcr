import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import {
  commandSha256,
  DraftReportValidationError,
  validateCreateDraftReportCommand,
  validateSaveDraftReportCommand
} from "../dist/reports/draft-report.validation.js";
import { storedEncounterValue } from "../dist/reports/encounter-document.persistence.js";
import { DraftReportService } from "../dist/reports/draft-report.service.js";

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
  assert.equal(validateSaveDraftReportCommand({ ...command, demoAction: "populate" }).demoAction, "populate");
  assert.throws(() => validateSaveDraftReportCommand({ ...command, demoAction: "erase" }),
    (error) => error instanceof DraftReportValidationError && error.findings.some((finding) => /demoAction/.test(finding)));
});

test("demo mutation boundaries reject ordinary, signed, unprovenanced, and forged targets", async () => {
  const service = new DraftReportService({}, {});
  const report = {
    id: randomUUID(), status: "draft", revision: 1, organization_id: randomUUID(),
    incident_id: randomUUID(), patient_id: randomUUID(), agency_demographic_version_id: randomUUID(),
    form_version_id: randomUUID(), catalog_release_id: randomUUID(), documenting_user_id: randomUUID(),
    synthetic: true, demo_mutable: true,
  };
  const groupId = randomUUID();
  const occurrenceId = randomUUID();
  const populated = {
    commandId: randomUUID(), expectedRevision: 1, authorId: report.documenting_user_id, demoAction: "populate",
    groups: [{ id: groupId, groupId: "eVitals.VitalGroup", ordinal: 0,
      correlationId: "demo:stationary-populate-v1:generated-group" }],
    occurrences: [{ id: occurrenceId, elementId: "eVitals.14", groupInstanceId: groupId, ordinal: 0,
      provenanceKind: "demo", provenanceDetail: { generator: "stationary-populate-v1" },
      sourceAttributes: { "x-open-triage-demo": "stationary-populate-v1" },
      value: { kind: "integer", value: 16 } }],
  };
  await service.assertDemoMutationBoundary({ query: async () => [] }, report, populated);
  await assert.rejects(service.assertDemoMutationBoundary({ query: async () => [] },
    { ...report, synthetic: false }, populated), ConflictException);
  await assert.rejects(service.assertDemoMutationBoundary({ query: async () => [] },
    { ...report, status: "signed" }, populated), ConflictException);
  await assert.rejects(service.assertDemoMutationBoundary({ query: async () => [] },
    { ...report, demo_mutable: false }, populated), ConflictException);
  await assert.rejects(service.assertDemoMutationBoundary({ query: async () => [] }, report,
    { ...populated, demoAction: undefined }), ConflictException);
  await assert.rejects(service.assertDemoMutationBoundary({ query: async () => [] }, report,
    { ...populated, occurrences: [{ ...populated.occurrences[0], provenanceKind: "clinician" }] }), ConflictException);

  const cleared = {
    ...populated, demoAction: "clear",
    groups: populated.groups.map(({ id, groupId, ordinal }) => ({ id, groupId, ordinal, tombstone: true })),
    occurrences: populated.occurrences.map(({ id, elementId, groupInstanceId, ordinal }) =>
      ({ id, elementId, groupInstanceId, ordinal, tombstone: true })),
  };
  await service.assertDemoMutationBoundary({ query: async () => [{ group_count: 1, occurrence_count: 1 }] }, report, cleared);
  await assert.rejects(service.assertDemoMutationBoundary(
    { query: async () => [{ group_count: 1, occurrence_count: 0 }] }, report, cleared), ConflictException);
});

test("every demo save rechecks the live capability and CSRF proof before report access", async () => {
  const session = { user: { id: randomUUID() }, organization: { id: randomUUID() } };
  const command = { commandId: randomUUID(), expectedRevision: 0, authorId: session.user.id,
    demoAction: "populate", groups: [{ id: randomUUID(), groupId: "eVitals.VitalGroup", ordinal: 0,
      correlationId: "demo:stationary-populate-v1:test" }] };
  const noDatabaseAccess = { transaction: async (_level, work) => work({ query: async () => { throw new Error("database touched"); } }) };
  const removedRole = new DraftReportService(noDatabaseAccess, {
    get: async () => session,
    requireCapability: async () => { throw new UnauthorizedException("role removed"); },
  });
  await assert.rejects(removedRole.save("session", randomUUID(), command, "csrf-proof"), UnauthorizedException);
  const badCsrf = new DraftReportService(noDatabaseAccess, {
    get: async () => session,
    requireCapability: async () => session,
    assertCsrf: async () => { throw new UnauthorizedException("bad csrf"); },
  });
  await assert.rejects(badCsrf.save("session", randomUUID(), command, "forged"), UnauthorizedException);
});

test("command digests are stable across object key order", () => {
  assert.equal(commandSha256({ reportId: "one", nested: { b: 2, a: 1 } }),
    commandSha256({ nested: { a: 1, b: 2 }, reportId: "one" }));
});

test("a full 441-field form save uses bounded database batches instead of per-field queries", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const elementIdentityId = randomUUID();
  const occurrences = Array.from({ length: 441 }, (_, ordinal) => ({
    id: randomUUID(), elementId: "eNarrative.01", ordinal,
    value: { kind: "text", value: `Full form value ${ordinal}` }
  }));
  const report = {
    id: reportId, status: "draft", revision: 0, organization_id: organizationId,
    incident_id: randomUUID(), patient_id: randomUUID(), agency_demographic_version_id: randomUUID(),
    form_version_id: randomUUID(), catalog_release_id: randomUUID(), documenting_user_id: userId
  };
  const queries = [];
  const manager = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    queries.push(normalized);
    if (normalized.includes("pg_advisory_xact_lock")) return [];
    if (normalized.includes("select * from clinical.command_receipt")) return [];
    if (normalized.includes("from clinical.report") && normalized.includes("for update")) return [report];
    if (normalized.includes("from app_identity.app_user")) return [{ id: userId }];
    if (normalized.includes("clock_timestamp()")) return [{ received_at: new Date() }];
    if (normalized.includes("from clinical.draft_target_state") && normalized.includes("for update")) return [];
    if (normalized.includes("from catalog.element_definition")) return [{
      element_id: "eNarrative.01", element_identity_id: elementIdentityId, base_datatype: "string",
      analytical_repeatable: false, identifying: false, allowed_absence_states: [], max_occurs: null
    }];
    if (normalized.startsWith("insert into clinical.element_occurrence")) {
      const rows = JSON.parse(parameters[3]).map(({ id }) => ({ id }));
      return [rows, rows.length];
    }
    if (normalized.startsWith("with updated as") && normalized.includes("insert into clinical.report_change")) {
      report.revision = 1;
      return [];
    }
    if (normalized.startsWith("insert into clinical.draft_target_state") ||
        normalized.startsWith("insert into clinical.command_receipt")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const dataSource = { transaction: async (_isolation, operation) => operation(manager) };
  const sessions = { get: async () => ({ organization: { id: organizationId }, user: { id: userId } }) };
  const service = new DraftReportService(dataSource, sessions);

  const saved = await service.save("session", reportId, {
    commandId: randomUUID(), expectedRevision: 0, authorId: userId, occurrences
  });

  assert.equal(saved.revision, 1);
  assert.ok(queries.length <= 15, `full form save issued ${queries.length} database queries`);
  assert.equal(queries.filter((sql) => sql.startsWith("insert into clinical.element_occurrence")).length, 1);
  assert.equal(queries.filter((sql) => sql.includes("from catalog.element_definition")).length, 1);
  assert.equal(queries.filter((sql) => sql.includes("from clinical.draft_target_state") && sql.includes("for update")).length, 1);
});
