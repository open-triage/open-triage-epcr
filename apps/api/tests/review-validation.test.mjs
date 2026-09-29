import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import {
  compileValidationRule,
  compiledValidationBundleSha256,
  evaluateValidationBundle,
} from "@open-triage/contracts";
import { DraftReportController } from "../dist/reports/draft-report.controller.js";
import { clinicalFormConfiguration } from "../dist/forms/clinical-form-configuration.js";
import { ReviewValidationService } from "../dist/reports/review-validation.service.js";
import { SignReportService } from "../dist/reports/sign-report.service.js";

const organizationId = randomUUID();
const userId = randomUUID();
const reportId = randomUUID();
const versionId = randomUUID();
const ruleId = randomUUID();
const catalogReleaseId = randomUUID();

const reviewRule = {
  schemaVersion: 1, languageVersion: "1.0.0", ruleId, validationVersionId: versionId,
  name: "Review missing narrative", enabled: true, severity: "information",
  executionTargets: ["review"], primaryTarget: { elementId: "eNarrative.01" },
  message: "Narrative needs review", localization: { schemaVersion: 1,
    sv: { name: "Granska berättelsen", message: "Berättelsen behöver granskas" } }, assertion: { operator: "constant", value: false },
  references: { elementIds: [], codes: [] },
};
const bundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
  catalogReleaseId, rules: [reviewRule] };
const compiledSha256 = compiledValidationBundleSha256(bundle);

function subject(manager, requireCapability = async (_token, capability) => {
  assert.equal(capability, "validation:read");
  return { organization: { id: organizationId }, user: { id: userId } };
}) {
  return new ReviewValidationService({
    transaction: async (isolation, work) => {
      assert.equal(isolation, "REPEATABLE READ");
      return work(manager);
    },
  }, { requireCapability });
}

function evaluatingManager({ storedSha256 = compiledSha256 } = {}) {
  const calls = [];
  const manager = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("from clinical.report") && sql.includes("organization_id=$2")) {
      return [{ id: reportId, organization_id: organizationId, catalog_release_id: catalogReleaseId, revision: 7 }];
    }
    if (sql.includes("from validation.version")) {
      return [{ id: versionId, compiled_bundle: bundle, compiled_sha256: storedSha256 }];
    }
    if (sql.includes("from app_identity.agency_settings")) return [{ language: "sv" }];
    if (sql.includes("select r.id, r.created_at")) return [{ id: reportId,
      created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-18T11:00:00Z",
      form_id: randomUUID(), form_version: 1, catalog_standard: "NEMSIS",
      catalog_version: "3.5.1", catalog_dataset: "EMSDataSet" }];
    if (sql.includes("from clinical.group_instance") || sql.includes("from clinical.element_occurrence")) return [];
    if (sql.includes("insert into clinical.validation_review_evaluation")) {
      return [{ id: randomUUID(), report_id: reportId, report_revision: 7,
        validation_version_id: versionId, validation_compiled_sha256: storedSha256,
        evaluated_by: userId, outcome: parameters[6], findings: JSON.parse(parameters[7]),
        failures: JSON.parse(parameters[8]), evaluated_at: parameters[9] }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { manager, calls };
}

test("review API forwards the selected version to the server evaluator", async () => {
  let invocation;
  const expected = { id: randomUUID(), outcome: "passed" };
  const controller = new DraftReportController(undefined, undefined, undefined, {
    evaluate: async (...parameters) => { invocation = parameters; return expected; },
  });
  const result = await controller.evaluateReview(reportId, { validationVersionId: versionId }, "Bearer session");
  assert.equal(result, expected);
  assert.deepEqual(invocation, ["session", reportId, { validationVersionId: versionId }]);
});

test("a selected published review-only version evaluates one current report and records a separate result", async () => {
  const { manager, calls } = evaluatingManager();
  const result = await subject(manager).evaluate("session", reportId, { validationVersionId: versionId });
  assert.equal(result.outcome, "findings");
  assert.equal(result.reportRevision, 7);
  assert.equal(result.validationVersionId, versionId);
  assert.equal(result.findings[0].executionTarget, "review");
  assert.equal(result.findings[0].severity, "information");
  assert.equal(result.findings[0].message, "Berättelsen behöver granskas");
  assert.ok(calls.some(({ sql }) => sql.includes("insert into clinical.validation_review_evaluation")));
  assert.ok(calls.every(({ sql }) => !sql.includes("clinical.validation_finding")));

  const document = { groups: [] };
  assert.deepEqual(evaluateValidationBundle(bundle, document, "live", { timestamp: "2026-09-18T12:00:00Z" }), []);
  assert.deepEqual(evaluateValidationBundle(bundle, document, "sign", { timestamp: "2026-09-18T12:00:00Z" }), []);
});

test("review-only rules are omitted from the offline live bundle", async () => {
  const formVersionId = randomUUID();
  const manager = { query: async (sql) => {
    if (sql.includes("from forms.form_version")) return [{ canonical_definition: { schemaVersion: 1, sections: [] } }];
    if (sql.includes("from validation.version")) return [{ compiled_bundle: bundle, compiled_sha256: compiledSha256 }];
    if (sql.includes("from catalog.group_definition")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const configuration = await clinicalFormConfiguration(manager, formVersionId, catalogReleaseId,
    versionId, compiledSha256);
  assert.deepEqual(configuration.validation.bundle.rules, []);
});

test("review-only rules do not participate in authoritative signing", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("from validation.version")) return [{ compiled_bundle: bundle, compiled_sha256: compiledSha256 }];
    if (sql.includes("from catalog.group_definition")) return [];
    if (sql.includes("select r.id, r.created_at")) return [{ id: reportId,
      created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-18T11:00:00Z",
      form_id: randomUUID(), form_version: 1, catalog_standard: "NEMSIS",
      catalog_version: "3.5.1", catalog_dataset: "EMSDataSet" }];
    if (sql.includes("from clinical.group_instance") || sql.includes("from clinical.element_occurrence")) return [];
    if (sql.includes("from app_identity.agency_settings")) return [{ language: "en" }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const signing = new SignReportService({}, {});
  const findings = await signing.validateAuthoredRules(manager, { id: reportId, organization_id: organizationId,
    catalog_release_id: catalogReleaseId, validation_version_id: versionId,
    validation_compiled_sha256: compiledSha256 }, "2026-09-18T12:00:00Z");
  assert.deepEqual(findings, []);
});

test("bundle integrity failures are persisted as failed review evaluations", async () => {
  const { manager, calls } = evaluatingManager({ storedSha256: "0".repeat(64) });
  const result = await subject(manager).evaluate("session", reportId, { validationVersionId: versionId });
  assert.equal(result.outcome, "failed");
  assert.equal(result.findings.length, 0);
  assert.equal(result.failures[0].code, "integrity");
  assert.equal(JSON.parse(calls.find(({ sql }) => sql.includes("insert into clinical.validation_review_evaluation")).parameters[8])[0].code,
    "integrity");
});

test("review evaluation authorizes before data access and scopes report/version reads to one organization", async () => {
  let queried = false;
  await assert.rejects(subject({ query: async () => { queried = true; return []; } }, async () => {
    throw new UnauthorizedException("validation:read is required");
  }).evaluate("session", reportId, { validationVersionId: versionId }), UnauthorizedException);
  assert.equal(queried, false);

  const { manager, calls } = evaluatingManager();
  await subject(manager).evaluate("session", reportId, { validationVersionId: versionId });
  const reportRead = calls.find(({ sql }) => sql.includes("from clinical.report") && sql.includes("organization_id=$2"));
  const versionRead = calls.find(({ sql }) => sql.includes("from validation.version"));
  assert.deepEqual(reportRead.parameters, [reportId, organizationId]);
  assert.deepEqual(versionRead.parameters, [versionId, organizationId, catalogReleaseId]);
});

test("the review language cannot compile database, history, or external-service access", () => {
  const catalog = { elements: [{ elementId: "eNarrative.01", label: "Narrative", baseDatatype: "string" }] };
  for (const source of [
    'require database("clinical.report")',
    'require historicalReport("previous")',
    'require http("https://example.test")',
  ]) {
    const result = compileValidationRule({ id: randomUUID(), name: "Forbidden access", enabled: true,
      severity: "error", executionTargets: ["review"], primaryTargetElementId: "eNarrative.01",
      message: "Forbidden", source }, versionId, catalog);
    assert.equal(result.compiled, undefined);
    assert.ok(["syntax", "compatibility"].includes(result.diagnostics[0].code));
  }
});
