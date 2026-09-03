import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const [mapping, migration, catalog, scheduler, runbook] = await Promise.all([
  readFile(path.join(packageRoot, "generated/nemsis-3.5.1-analytics-mapping.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8"),
  readFile(path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "deploy/kubernetes/analytics-projector-cronjobs.yaml"), "utf8"),
  readFile(path.join(repoRoot, "docs/runbooks/analytics-projection.md"), "utf8")
]);

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
    identifyingElements: 43,
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
  assert.match(migration, /grant select on clinical_audit\.draft_reconciliation to open_triage_auditor/);
  assert.ok(!migration.includes("grant select on clinical_history.report_history to open_triage_operational"));
  assert.ok(!migration.includes("grant select on operations.unsigned_report_work_queue to open_triage_analyst"));
});
