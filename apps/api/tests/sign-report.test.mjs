import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { compiledValidationBundleSha256 } from "@open-triage/contracts";
import {
  SignReportValidationError,
  validateSignReportCommand
} from "../dist/reports/sign-report.validation.js";
import {
  acknowledgementMatchesFinding,
  blockingSigningFindings,
  SignReportService,
  unresolvedDispatchConflictFindings,
  validationFindingAcknowledgementId,
} from "../dist/reports/sign-report.service.js";

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

test("unresolved dispatch differences block signing until disposition", () => {
  const findings = unresolvedDispatchConflictFindings([
    { id: "conflict-1", element_id: "eDispatch.01" }
  ]);
  assert.deepEqual(findings.map(({ severity, code, path }) => ({ severity, code, path })), [{
    severity: "error", code: "dispatch.unresolved-conflict", path: "dispatchConflicts.conflict-1"
  }]);
  assert.deepEqual(unresolvedDispatchConflictFindings([]), []);
});

test("signing enforces errors, finding-specific warnings, and non-blocking information", () => {
  const validationVersionId = randomUUID();
  const ruleId = randomUUID();
  const targetGroupInstanceId = randomUUID();
  const targetOccurrenceId = randomUUID();
  const warning = { severity: "warning", code: "validation.rule", path: "$.occurrences.target",
    message: "Review this value", ruleVersion: validationVersionId, validationVersionId, ruleId,
    executionTarget: "sign", targetElementId: "eVitals.06", targetGroupInstanceId, targetOccurrenceId,
    inputFingerprint: "fnv1a32:12345678" };
  const acknowledgement = { validationVersionId, ruleId, targetElementId: "eVitals.06", targetGroupInstanceId,
    targetOccurrenceId, inputFingerprint: warning.inputFingerprint };
  const id = validationFindingAcknowledgementId(warning);
  assert.ok(id);
  assert.equal(acknowledgementMatchesFinding(acknowledgement, warning), true);
  assert.deepEqual(blockingSigningFindings([warning], {}), [warning]);
  assert.deepEqual(blockingSigningFindings([warning], { [id]: acknowledgement }), []);

  const changed = { ...warning, inputFingerprint: "fnv1a32:87654321" };
  assert.equal(validationFindingAcknowledgementId(changed) === id, false);
  assert.deepEqual(blockingSigningFindings([changed], { [id]: acknowledgement }), [changed],
    "changing relevant inputs invalidates the prior acknowledgement");
  const information = { ...warning, severity: "information", message: "For awareness" };
  const error = { ...warning, severity: "error", message: "Must resolve" };
  assert.deepEqual(blockingSigningFindings([information], {}), []);
  assert.deepEqual(blockingSigningFindings([error], { [id]: acknowledgement }), [error]);
});

test("sign command validation accepts complete acknowledgement evidence and rejects partial evidence", () => {
  const command = { commandId: randomUUID(), expectedRevision: 1, signerId: randomUUID(),
    attestation: { meaning: "clinician approval" } };
  const id = "finding-id";
  const acknowledgement = { validationVersionId: randomUUID(), ruleId: randomUUID(), targetElementId: "eVitals.06",
    targetGroupInstanceId: randomUUID(), targetOccurrenceId: randomUUID(), inputFingerprint: "fnv1a32:12345678" };
  assert.deepEqual(validateSignReportCommand({ ...command, warningAcknowledgements: { [id]: acknowledgement } })
    .warningAcknowledgements, { [id]: acknowledgement });
  assert.throws(() => validateSignReportCommand({ ...command, warningAcknowledgements: { [id]: { ...acknowledgement,
    inputFingerprint: "" } } }), SignReportValidationError);
});

test("signing retries a transient PostgreSQL serialization failure", async () => {
  const signerId = randomUUID();
  const organizationId = randomUUID();
  const reportId = randomUUID();
  const signed = {
    id: reportId,
    status: "signed",
    signedRevision: 7,
  };
  let transactions = 0;
  const service = new SignReportService({
    transaction: async () => {
      transactions += 1;
      if (transactions === 1) throw { driverError: { code: "40001" } };
      return { result: signed };
    },
  }, {
    requireCapability: async () => ({
      organization: { id: organizationId },
      user: { id: signerId },
    }),
  });

  const result = await service.sign("session", reportId, {
    commandId: randomUUID(), expectedRevision: 7, signerId,
    attestation: { meaning: "clinician approval" },
  });

  assert.equal(transactions, 2);
  assert.equal(result, signed);
});

test("signing does not require report occurrences for read-only configuration metadata", async () => {
  let fieldQuery = "";
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from forms.form_version")) {
      return [{ status: "published", catalog_release_id: "catalog-release" }];
    }
    if (normalized.includes("from forms.form_field")) {
      fieldQuery = normalized;
      return [
        {
          id: "metadata-field", stable_key: "dAgency.01", required: false,
          clinically_stored: false, catalog_element_identity_id: "agency-identity",
          custom_element_definition_id: null, min_occurs: 1, agency_required: false,
          agency_required_severity: null
        },
        {
          id: "clinical-field", stable_key: "ePatient.01", required: false,
          clinically_stored: true, catalog_element_identity_id: "patient-identity",
          custom_element_definition_id: null, min_occurs: 1, agency_required: false,
          agency_required_severity: null
        }
      ];
    }
    if (normalized.includes("from forms.form_rule")) return [];
    if (normalized.includes("from clinical.element_occurrence")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new SignReportService({}, {});

  const findings = await service.validateSemantics(manager, {
    id: "report-id", form_version_id: "form-version", catalog_release_id: "catalog-release"
  });

  assert.match(fieldQuery, /left join catalog\.analytics_element_mapping/);
  assert.deepEqual(findings.map(({ code, path }) => ({ code, path })), [{
    code: "catalog.cardinality", path: "$.fields.ePatient.01"
  }]);
});

test("pinned Validation replaces legacy requiredness while Form visibility still protects hidden values", async () => {
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from forms.form_version")) return [{ status: "published", catalog_release_id: "catalog-release" }];
    if (normalized.includes("from forms.form_field")) return [
      { id: "required-field", stable_key: "required", required: true, clinically_stored: true,
        catalog_element_identity_id: "required-identity", custom_element_definition_id: null,
        min_occurs: 1, agency_required: true, agency_required_severity: "error" },
      { id: "hidden-field", stable_key: "hidden", required: false, clinically_stored: true,
        catalog_element_identity_id: "hidden-identity", custom_element_definition_id: null,
        min_occurs: 0, agency_required: false, agency_required_severity: null },
    ];
    if (normalized.includes("from forms.form_rule")) return [
      { target_field_id: "required-field", target_key: "required", rule_kind: "requiredness",
        expression: { operator: "exists", field: "controller" } },
      { target_field_id: "hidden-field", target_key: "hidden", rule_kind: "visibility",
        expression: { operator: "exists", field: "controller" } },
    ];
    if (normalized.includes("from clinical.element_occurrence")) return [{ id: "occurrence", element_identity_id: "hidden-identity",
      element_id: "ePatient.02", form_field_id: "hidden-field", group_instance_id: null, ordinal: 0,
      value_kind: "text", scalar_value: "Hidden", code: null, code_system: null, absence_code: null,
      base_datatype: "string", min_occurs: 0, max_occurs: 1 }];
    if (normalized.includes("with incoming as")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new SignReportService({}, {});
  const findings = await service.validateSemantics(manager, { id: "report-id", form_version_id: "form-version",
    catalog_release_id: "catalog-release", validation_version_id: "validation-version" });
  assert.deepEqual(findings.map(({ code }) => code), ["form.conditional-hidden"]);
});

test("authoritative signing evaluates the report's pinned required-element bundle", async () => {
  const validationVersionId = randomUUID();
  const ruleId = randomUUID();
  const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId,
    catalogReleaseId: "catalog-release", rules: [{ schemaVersion: 1, languageVersion: "1.0.0",
      ruleId, validationVersionId, name: "Require patient name", enabled: true, severity: "error",
      executionTargets: ["live", "sign"], primaryTarget: { elementId: "ePatient.02" },
      message: "Patient name is required", assertion: { operator: "present", elementId: "ePatient.02" } }] };
  const compiledSha256 = compiledValidationBundleSha256(bundle);
  let valuePresent = false;
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from validation.version")) return [{ compiled_bundle: bundle, compiled_sha256: compiledSha256 }];
    if (normalized.includes("from app_identity.agency_settings")) return [{ language: "en" }];
    if (normalized.includes("from clinical.report r join forms.form_version")) return [{
      id: "report-id", created_at: new Date(), updated_at: new Date(), form_id: "form-id", form_version: 1,
      catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet"
    }];
    if (normalized.includes("from clinical.group_instance")) return valuePresent ? [{ id: "patient-group", parent_group_instance_id: null,
      group_id: "ePatient.PatientGroup", ordinal: 0, documented_time: null, correlation_id: null }] : [];
    if (normalized.includes("from clinical.element_occurrence")) return valuePresent ? [{ id: "patient-name", group_instance_id: "patient-group",
      element_id: "ePatient.02", ordinal: 0, value_kind: "text", value_text: "Morgan", value_integer: null,
      value_numeric: null, value_boolean: null, value_date: null, value_datetime: null, value_time: null,
      value_duration: null, value_binary: null, value_lexical: null, value_utc_offset_minutes: null,
      value_precision: null, code: null, code_system: null, code_display: null, terminology_version: null,
      absence_code: null, absence_display: null, source_attributes: null, provenance_kind: "clinician", provenance_detail: null }] : [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new SignReportService({}, {});
  const findings = await service.validateAuthoredRules(manager, {
    id: "report-id", organization_id: "organization", catalog_release_id: "catalog-release",
    validation_version_id: validationVersionId, validation_compiled_sha256: compiledSha256
  });
  assert.deepEqual(findings.map(({ severity, ruleId: id, targetElementId }) => ({ severity, id, targetElementId })), [{
    severity: "error", id: ruleId, targetElementId: "ePatient.02"
  }]);
  valuePresent = true;
  assert.deepEqual(await service.validateAuthoredRules(manager, {
    id: "report-id", organization_id: "organization", catalog_release_id: "catalog-release",
    validation_version_id: validationVersionId, validation_compiled_sha256: compiledSha256
  }), []);
});

test("signing blocks tampered artifacts and identifies a rule that fails at runtime", async () => {
  const validationVersionId = randomUUID();
  const ruleId = randomUUID();
  const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId,
    catalogReleaseId: "catalog-release", rules: [{ schemaVersion: 1, languageVersion: "1.0.0",
      ruleId, validationVersionId, name: "Broken sign rule", enabled: true, severity: "error",
      executionTargets: ["sign"], primaryTarget: { elementId: "ePatient.02" }, message: "Broken",
      assertion: { operator: "future-operator" }, references: { elementIds: ["ePatient.02"], codes: [] } }] };
  const compiledSha256 = compiledValidationBundleSha256(bundle);
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from validation.version")) return [{ compiled_bundle: bundle, compiled_sha256: compiledSha256 }];
    if (normalized.includes("from app_identity.agency_settings")) return [{ language: "en" }];
    if (normalized.includes("from clinical.report r join forms.form_version")) return [{
      id: "report-id", created_at: new Date(), updated_at: new Date(), form_id: "form-id", form_version: 1,
      catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet"
    }];
    if (normalized.includes("from clinical.group_instance") || normalized.includes("from clinical.element_occurrence")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new SignReportService({}, {});
  const report = { id: "report-id", organization_id: "organization", catalog_release_id: "catalog-release",
    validation_version_id: validationVersionId, validation_compiled_sha256: compiledSha256 };
  const runtime = await service.validateAuthoredRules(manager, report, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(runtime.map(({ code, ruleId: id }) => ({ code, id })), [{ code: "validation.compatibility", id: ruleId }]);
  const tampered = await service.validateAuthoredRules(manager, { ...report, validation_compiled_sha256: "0".repeat(64) },
    "2026-01-01T00:00:00.000Z");
  assert.deepEqual(tampered.map(({ code, ruleId: id }) => ({ code, id })), [{ code: "validation.integrity", id: "bundle" }]);
});
