import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateQualityAndNormalization,
  NORMALIZATION_RULE_VERSION,
  QUALITY_RULE_VERSION
} from "@open-triage/contracts/quality-rules";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [mapping, migration, catalog, scheduler, runbook, privacyPolicy, identifyingConfig,
  retentionPolicy, retentionPolicyConfig, retentionRunbook, retentionScript,
  qualityPolicy, qualityPolicyConfig, qualityEvaluator, operationsPolicy,
  operationsPolicyConfig, operationsRunbook, recoveryVerifier, replicaVerifier] = await Promise.all([
  readFile(path.join(packageRoot, "generated/nemsis-3.5.1-analytics-mapping.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8"),
  readFile(path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "deploy/kubernetes/analytics-projector-cronjobs.yaml"), "utf8"),
  readFile(path.join(repoRoot, "docs/runbooks/analytics-projection.md"), "utf8"),
  readFile(path.join(repoRoot, "docs/analytical-privacy-boundary.md"), "utf8"),
  readFile(path.join(packageRoot, "config/identifying-elements.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "docs/retention-archival-deletion-policy.md"), "utf8"),
  readFile(path.join(packageRoot, "config/retention-policy.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "docs/runbooks/retention.md"), "utf8"),
  readFile(path.join(packageRoot, "scripts/retention.mjs"), "utf8"),
  readFile(path.join(repoRoot, "docs/quality-normalization-policy.md"), "utf8"),
  readFile(path.join(repoRoot, "packages/contracts/quality-normalization-policy.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "packages/contracts/quality-rules.mjs"), "utf8"),
  readFile(path.join(repoRoot, "docs/database-operations-policy.md"), "utf8"),
  readFile(path.join(packageRoot, "config/database-operations-policy.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "docs/runbooks/database-operations.md"), "utf8"),
  readFile(path.join(packageRoot, "scripts/verify-recovery.mjs"), "utf8"),
  readFile(path.join(packageRoot, "scripts/verify-reporting-replica.mjs"), "utf8")
]);

test("flags unusual values at exclusive exteriors while retaining source and additive derivation", () => {
  const boundary = evaluateQualityAndNormalization([
    { id: "sbp-low-boundary", elementId: "eVitals.06", valueKind: "integer", valueInteger: 40 },
    { id: "sbp-high-boundary", elementId: "eVitals.06", valueKind: "integer", valueInteger: 300 }
  ]);
  assert.deepEqual(boundary, { qualityFindings: [], derivedValues: [] });

  const source = {
    id: "etco2-source", elementId: "eVitals.16", valueKind: "numeric",
    valueNumeric: "14.000", sourceAttributes: { ETCO2Type: "3340005" }
  };
  const evaluated = evaluateQualityAndNormalization([source]);
  assert.equal(source.valueNumeric, "14.000");
  assert.deepEqual(evaluated.qualityFindings[0], {
    sourceOccurrenceId: source.id,
    elementId: source.elementId,
    code: "vital.etco2.unusual",
    severity: "warning",
    message: "eVitals.16 value 14 kPa is outside the inclusive 1.3-13.3 review range",
    observedNumeric: 14,
    sourceUnitCode: "kPa",
    expectedMinInclusive: 1.3,
    expectedMaxInclusive: 13.3,
    ruleVersion: QUALITY_RULE_VERSION
  });
  assert.deepEqual(evaluated.derivedValues[0], {
    sourceOccurrenceId: source.id,
    elementId: source.elementId,
    sourceNumeric: 14,
    sourceUnitCode: "kPa",
    derivedNumeric: 105.009,
    derivedUnitCode: "mm[Hg]",
    ruleId: "etco2.kpa-to-mmhg",
    ruleVersion: NORMALIZATION_RULE_VERSION
  });
  assert.ok(Math.abs(evaluated.derivedValues[0].derivedNumeric / 7.50062 - 14) < 0.0001);
});

test("records the human-approved quality and normalization policy", () => {
  assert.match(qualityPolicy, /approved by human clinical\/product review on 2026-09-02/i);
  assert.match(qualityPolicy, /approved on 2026-09-02 by the requesting human reviewer/i);
  assert.match(qualityPolicy, new RegExp(QUALITY_RULE_VERSION));
  assert.match(qualityPolicy, new RegExp(NORMALIZATION_RULE_VERSION));
  assert.equal(qualityPolicyConfig.policyStatus, "approved-human-clinical-product-review");
  assert.deepEqual(qualityPolicyConfig.approval, {
    approvedOn: "2026-09-02",
    approvedBy: "requesting-human-reviewer",
    context: "ticket-040-codex-session"
  });
  assert.equal(qualityPolicyConfig.qualityRuleVersion, QUALITY_RULE_VERSION);
  assert.equal(qualityPolicyConfig.normalizationRuleVersion, NORMALIZATION_RULE_VERSION);
  assert.deepEqual(qualityPolicyConfig.semantics, {
    bounds: "inclusive",
    findingsBlockSigning: false,
    sourceValuesImmutable: true,
    normalizationsAreAdditive: true,
    missingOrUnrecognizedETCO2Type: "retain-source-without-quality-evaluation-or-normalization"
  });
  assert.equal(qualityPolicyConfig.qualityRules.length, 7);
  assert.deepEqual(Object.keys(qualityPolicyConfig.etco2.typeMappings).sort(),
    ["3340001", "3340003", "3340005"]);
  assert.deepEqual(qualityPolicyConfig.normalizationRules, [{
    ruleId: "etco2.kpa-to-mmhg",
    elementId: "eVitals.16",
    sourceAttribute: "ETCO2Type",
    sourceAttributeValue: "3340005",
    sourceUnitCode: "kPa",
    derivedUnitCode: "mm[Hg]",
    operation: "multiply",
    factor: 7.50062,
    roundTo: 0.001
  }]);
  assert.match(qualityEvaluator,
    /import policy from "\.\/quality-normalization-policy\.json" with \{ type: "json" \}/);
  assert.match(migration, /quality_findings jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /normalized_numeric numeric,[\s\S]*normalization_rule_id text/);
});

test("maps every PatientCareReport element to exactly one analytical location", () => {
  const patientCareElements = catalog.elements.filter((element) =>
    element.groupPath.includes("PatientCareReportGroup")
  );
  assert.equal(patientCareElements.length, 441);
  assert.equal(mapping.elements.length, patientCareElements.length);
  assert.equal(new Set(mapping.elements.map((element) => element.elementId)).size, patientCareElements.length);
  assert.deepEqual(mapping.counts, {
    patientCareReportElements: 441,
    wideElements: 198,
    repeatableElements: 243,
    identifyingElements: 36,
    repeatingGroups: 34,
    repeatingGroupsWithOneLocalTimeCandidate: 11,
    repeatingGroupsFlaggedForZeroOrMultipleCandidates: 23
  });
});

test("uses deterministic simple SQL names and valid NEMSIS-compatible UUID identities", () => {
  const sqlColumns = mapping.elements
    .filter((element) => element.analyticalLocation === "wide")
    .flatMap((element) => element.columns.map((column) => column.name));
  assert.equal(new Set(sqlColumns).size, sqlColumns.length);
  assert.ok(sqlColumns.includes("esituation_11"));
  assert.ok(sqlColumns.every((column) => /^[a-z][a-z0-9_]*$/.test(column)));
  assert.ok(
    mapping.elements.every((element) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        element.applicationId
      )
    )
  );
});

test("requires an explicit time resolution for every repeating group", () => {
  assert.equal(mapping.repeatingGroupTimeMappings.length, mapping.counts.repeatingGroups);
  for (const group of mapping.repeatingGroupTimeMappings) {
    assert.match(group.resolution, /^(element|inherited|non-temporal)$/);
    assert.ok(group.note.length > 0);
    if (group.resolution === "element") {
      assert.equal(group.candidateCount, 1);
      assert.equal(group.candidateTimeElementIds[0], group.timeElementId);
    }
    if (group.resolution === "inherited") {
      assert.ok(group.inheritedFromGroupId);
      assert.ok(group.timeElementId);
    }
    if (group.resolution === "non-temporal") assert.equal(group.timeElementId, null);
  }
});

test("commits generated columns and keeps identifying values out of the default view", () => {
  const wideMappings = mapping.elements.filter((element) => element.analyticalLocation === "wide");
  for (const element of wideMappings) {
    for (const column of element.columns) {
      assert.match(migration, new RegExp(`\\n  ${column.name} ${column.type},`));
    }
  }
  const viewBlock = migration.slice(
    migration.indexOf("-- BEGIN GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS"),
    migration.indexOf("-- END GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS")
  );
  for (const element of wideMappings.filter((element) => element.identifying)) {
    assert.ok(element.columns.every((column) => !viewBlock.includes(`\n  ${column.name}`)));
  }
  assert.ok(viewBlock.includes("\n  esituation_11"));
  assert.ok(!viewBlock.includes("\n  enarrative_01"));
});

test("defines the transactional invariants and two private analytical base tables", () => {
  for (const expected of [
    "create table clinical.incident",
    "create table clinical.report",
    "create table clinical.group_instance",
    "create table clinical.element_occurrence",
    "create table clinical.draft_target_state",
    "create table clinical.signed_snapshot",
    "create table clinical.amendment",
    "create table clinical_audit.event",
    "create table clinical_audit.draft_reconciliation",
    "create table clinical_audit.post_signature_audit_note",
    "create table integration.outbox_event",
    "create table integration.projection_run",
    "create table integration.projection_backfill_job",
    "create table analytics_private.epcr",
    "create table analytics_private.epcr_repeatable_element",
    "create view analytics.epcr",
    "create view analytics.epcr_repeatable_element",
    "create view operations.unsigned_report_work_queue",
    "create view operations.projection_health",
    "create view operations.projection_failures",
    "create view clinical_history.report_history"
  ]) {
    assert.ok(migration.includes(expected), `missing ${expected}`);
  }
  assert.ok(migration.includes("unique nulls not distinct"));
  assert.ok(migration.includes("substring(id::text from 15 for 1) = '4'"));
  assert.ok(!migration.includes("auth.users"));
  assert.ok(!migration.includes("patient_care_reports"));
});

test("schedules bounded observable projection work inside the freshness target", () => {
  assert.match(scheduler, /schedule: "\*\/2 \* \* \* \*"/);
  assert.match(scheduler, /concurrencyPolicy: Forbid/);
  assert.match(scheduler, /ANALYTICS_PROJECTOR_BATCH_SIZE[\s\S]*value: "500"/);
  assert.match(scheduler, /ANALYTICS_PROJECTOR_FRESHNESS_TARGET_SECONDS[\s\S]*value: "300"/);
  assert.match(runbook, /five-minute\s+signed-to-analytical freshness target/);
  for (const operation of ["Replay", "reconciliation", "Backfill", "projection_health", "projection_failures"]) {
    assert.ok(runbook.includes(operation), `runbook is missing ${operation}`);
  }
});

test("separates unsigned operations, immutable history, and signed analytics access", () => {
  assert.match(migration, /where r\.status = 'draft'/);
  assert.match(migration, /from clinical\.report_change rc[\s\S]*from clinical\.signed_snapshot ss[\s\S]*from clinical\.amendment a/);
  assert.match(migration, /grant select on operations\.unsigned_report_work_queue,[\s\S]*to open_triage_operational/);
  assert.match(migration, /grant select on clinical_history\.report_history to open_triage_auditor/);
  assert.match(migration, /draft_reconciliation_append_only[\s\S]*prevent_update_or_delete/);
  assert.match(migration, /post_signature_audit_note_append_only[\s\S]*prevent_update_or_delete/);
  assert.match(migration, /grant select on clinical_audit\.draft_reconciliation, clinical_audit\.post_signature_audit_note to open_triage_auditor/);
  assert.ok(!migration.includes("grant select on clinical_history.report_history to open_triage_operational"));
  assert.ok(!migration.includes("grant select on operations.unsigned_report_work_queue to open_triage_analyst"));
});

test("records the human-approved privacy boundary", () => {
  assert.equal(identifyingConfig.policyVersion, "privacy-boundary-1.0.0");
  assert.equal(identifyingConfig.reviewStatus, "approved-human-privacy-security-review");
  assert.equal(identifyingConfig.elements.length, 36);
  assert.match(privacyPolicy, /approved on 2026-09-02 by the requesting human reviewer/i);
  for (const decision of ["Identifying classification", "HMAC inputs", "Secret custody", "Rotation"]) {
    assert.ok(privacyPolicy.includes(decision), `privacy policy is missing ${decision}`);
  }
  assert.match(migration, /revoke all on schema app_identity, catalog, forms, clinical, clinical_audit, integration,[\s\S]*from open_triage_analyst, open_triage_identified_analyst/);
  assert.match(migration, /grant select on analytics\.epcr, analytics\.epcr_repeatable_element, analytics\.element_dictionary, analytics\.agency to open_triage_analyst/);
  assert.ok(!migration.includes("grant select on analytics.epcr_identified to open_triage_analyst"));
  assert.match(migration, /identifying boolean not null,\n  definition jsonb not null/);
});

test("requires approved archive-before-delete retention with durable evidence", () => {
  for (const table of ["retention.policy", "retention.legal_hold", "retention.archive_batch",
    "retention.archive_batch_report", "retention.evidence"]) {
    assert.ok(migration.includes(`create table ${table}`), `missing ${table}`);
  }
  assert.match(migration, /retention_years integer not null default 10/);
  assert.match(migration, /pending-installation-owner-approval/);
  assert.match(migration, /r\.status = 'signed'[\s\S]*r\.reporting_date < selected_cutoff[\s\S]*h\.released_at is null/);
  assert.match(migration, /if selected_batch\.status <> 'archive_verified' then raise exception 'archive verification is required before deletion'/);
  assert.match(migration, /a legal hold now protects one or more reports/);
  assert.match(migration, /drop_empty_expired_partitions/);
  assert.match(migration, /create role open_triage_retention_executor nologin/);
  assert.match(migration, /capability\.capability_key = 'installation:administer'/);
  assert.match(migration, /retention\.delete_verified_batch\(uuid, uuid\)/);
  assert.ok(!migration.includes("grant execute on function retention.delete_verified_batch(uuid, uuid) to open_triage_operational"));
  for (const decision of ["Archive destination", "Deletion authority", "Evidence format", "Online retention"]) {
    assert.ok(retentionPolicy.includes(decision), `retention policy is missing ${decision}`);
  }
  assert.equal(retentionPolicyConfig.policyVersion, "retention-1.0.0");
  assert.equal(retentionPolicyConfig.reviewStatus, "approved-installation-owner");
  assert.equal(retentionPolicyConfig.retentionYearsDefault, 10);
  assert.equal(retentionPolicyConfig.localRetentionOverride, null);
  assert.match(retentionPolicy, /approved by the installation owner on 2026-09-02/);
  assert.match(retentionPolicy, /requesting human reviewer[\s\S]*ticket 042 Codex\s+session/);
  assert.match(retentionRunbook, /Object Lock/);
  assert.match(retentionRunbook, /active, belong to the batch organization/);
  assert.match(retentionRunbook, /--admin-user ADMINISTRATOR_USER_UUID/);
  assert.match(retentionScript, /export checksum mismatch/);
});

test("records approved backup, recovery, replica, credential, and query-audit operations", () => {
  assert.equal(operationsPolicyConfig.policyVersion, "database-operations-1.0.0");
  assert.equal(operationsPolicyConfig.reviewStatus, "approved-installation-owner");
  assert.equal(operationsPolicyConfig.approvedBy,
    "requesting human reviewer acting as the delegating installation owner in the ticket 044 Codex session");
  assert.equal(operationsPolicyConfig.approvedOn, "2026-09-02");
  assert.deepEqual(operationsPolicyConfig.recoveryObjectives, {
    rpoMinutes: 5,
    rtoHours: 4,
    exerciseFrequencyDays: 90
  });
  assert.equal(operationsPolicyConfig.backup.baseBackupFrequencyHours, 24);
  assert.equal(operationsPolicyConfig.backup.retentionDays, 35);
  assert.equal(operationsPolicyConfig.reportingReplica.maximumReplayLagSeconds, 300);
  assert.equal(operationsPolicyConfig.credentials.analystMaximumLifetimeMinutes, 15);
  assert.equal(operationsPolicyConfig.credentials.serviceCredentialMaximumLifetimeDays, 30);
  assert.equal(operationsPolicyConfig.monitoring.statementTextCaptured, false);
  assert.equal(operationsPolicyConfig.monitoring.bindValuesCaptured, false);
  assert.equal(operationsPolicyConfig.monitoring.returnedClinicalValuesCaptured, false);
  for (const decision of ["Backup storage", "Recovery objectives", "Replica topology",
    "Credential lifecycle", "Monitoring and query audit"]) {
    assert.ok(operationsPolicy.includes(decision), `operations policy is missing ${decision}`);
  }
  assert.match(operationsPolicy, /approved by the installation owner on 2026-09-02/i);
  assert.match(operationsPolicy,
    /requesting human reviewer acting as the delegating[\s\S]*installation owner in the ticket 044 Codex session/i);
  for (const object of ["operations.query_audit_event", "operations.query_audit_health",
    "operations.recovery_readiness", "operations.reporting_replica_health"]) {
    assert.ok(migration.includes(object), `migration is missing ${object}`);
  }
  assert.match(migration, /create role open_triage_query_auditor nologin/);
  assert.match(migration, /SQL text, bind values, and returned clinical values are structurally absent/);
  assert.ok(!/query_text\s+text/.test(migration));
  assert.ok(!/bind_(?:value|parameter)s?\s+/.test(migration));
  assert.match(operationsRunbook, /pg_restore --exit-on-error/);
  assert.match(operationsRunbook, /ALLOW_PRIMARY_REPLICA_TEST=1` exists only for CI/);
  assert.match(recoveryVerifier, /missing_or_stale_projection_count/);
  assert.match(recoveryVerifier, /--reconcile/);
  assert.match(replicaVerifier, /begin read only/);
  assert.match(replicaVerifier, /analytics_private\.epcr/);
});
