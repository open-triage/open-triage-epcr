import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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
const migrationsDirectory = path.join(repoRoot, "supabase/migrations");
const analyticsMigrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name === "202608300001_initial.sql" || name.includes("_nemsis_analytics_"))
  .sort();
const analyticsMigrations = await Promise.all(
  analyticsMigrationFiles.map((name) => readFile(path.join(migrationsDirectory, name), "utf8"))
);
const analyticsMigrationSql = analyticsMigrations.join("\n");
const currentAnalyticsViewMigration = analyticsMigrations.findLast((sql) =>
  sql.includes("-- BEGIN GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS")
);
const [mapping, migration, catalog, runbook, privacyPolicy, identifyingConfig,
  retentionPolicy, retentionPolicyConfig, retentionRunbook, retentionScript,
  qualityPolicy, qualityPolicyConfig, qualityEvaluator, operationsPolicy,
  operationsPolicyConfig, operationsRunbook, recoveryVerifier, replicaVerifier, catalogAuthoringMigration,
  codeListAuthoringMigration, formAuthoringMigration, formActivationMigration,
  reportConfigurationPinMigration, prototypeDeletionMigration, versionDisplayNameMigration,
  roleAuthorizationMigration, installationOwnerMigration, formDraftAuditMigration,
  temporaryCredentialMigration, customRoleAuthoringMigration, userLifecycleMigration,
  roleRetirementMigration, sessionAdministrationMigration,
  portableRolePackageMigration, syntheticGenerationMigration, syntheticDraftMutationMigration,
  syntheticExpiryMigration] = await Promise.all([
  readFile(path.join(packageRoot, "generated/nemsis-3.5.1-analytics-mapping.json"), "utf8").then(JSON.parse),
  readFile(path.join(repoRoot, "supabase/migrations/202608300001_initial.sql"), "utf8"),
  readFile(path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8").then(JSON.parse),
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
  readFile(path.join(packageRoot, "scripts/verify-reporting-replica.mjs"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260906210000_catalog_authoring.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260906230000_code_list_authoring.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260907010000_form_authoring.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260907020000_form_activation_default.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260907030000_preserve_report_configuration_pins.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260908141346_prototype_synthetic_draft_deletion.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260908144514_version_display_names.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911164417_role_resolved_authorization.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911171505_single_installation_owner.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911213000_form_draft_audit.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911180000_expiring_temporary_credentials.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911200000_custom_role_authoring.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911220000_safe_user_lifecycle.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911230000_role_retirement_history.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911240000_session_administration.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911250000_portable_role_packages.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911184803_authorized_synthetic_call_generation.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911191329_audit_authorized_synthetic_draft_mutations.sql"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20260911270000_expire_synthetic_records.sql"), "utf8")
]);

test("synthetic expiry is immutable, indexed, concurrency-safe, and retains only anti-replay facts", () => {
  assert.match(syntheticExpiryMigration, /expires_at = created_at \+ interval '24 hours'/);
  assert.match(syntheticExpiryMigration, /synthetic assignment provenance and expiry are immutable/);
  assert.match(syntheticExpiryMigration, /synthetic report provenance and expiry are immutable/);
  assert.match(syntheticExpiryMigration, /report_synthetic_expiry_idx/);
  assert.match(syntheticExpiryMigration, /call_assignment_synthetic_expiry_idx/);
  assert.match(syntheticExpiryMigration, /for update skip locked/);
  assert.match(syntheticExpiryMigration, /purged report % can never be recreated/);
  assert.match(syntheticExpiryMigration, /clinical_audit\.synthetic_purge_tombstone/);
  const tombstone = syntheticExpiryMigration.match(/create table clinical_audit\.synthetic_purge_tombstone \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.doesNotMatch(tombstone, /patient|payload|value|document|name|address|actor/i);
});

test("synthetic generation has a per-user/unit unopened invariant and append-only safe audit facts", () => {
  assert.match(syntheticGenerationMigration, /synthetic_generated_by uuid/);
  assert.match(syntheticGenerationMigration,
    /unique index call_assignment_one_generated_unopened_per_user_unit_idx[\s\S]*status = 'assigned'/);
  assert.match(syntheticGenerationMigration, /synthetic_generated_by is null or synthetic/);
  assert.match(syntheticGenerationMigration, /call_assignment_synthetic_generator_immutable/);
  assert.match(syntheticGenerationMigration, /create table clinical_audit\.synthetic_generation_event/);
  assert.match(syntheticGenerationMigration, /synthetic_generation_event_append_only/);
  assert.doesNotMatch(syntheticGenerationMigration, /patient|source_payload|password|token|csrf/i);
  assert.match(syntheticGenerationMigration, /revoke all on clinical_audit\.synthetic_generation_event from public/);
});

test("synthetic draft actions retain append-only redacted audit after report deletion", () => {
  assert.match(syntheticDraftMutationMigration, /create table clinical_audit\.synthetic_draft_mutation_event/);
  assert.match(syntheticDraftMutationMigration, /report_id uuid not null/);
  assert.doesNotMatch(syntheticDraftMutationMigration, /report_id uuid[^;]*references clinical\.report/);
  assert.match(syntheticDraftMutationMigration, /synthetic_draft_mutation_event_append_only/);
  assert.match(syntheticDraftMutationMigration, /revoke all on clinical_audit\.synthetic_draft_mutation_event from public/);
  assert.doesNotMatch(syntheticDraftMutationMigration, /patient_id|source_payload|clinical_value|details jsonb/i);
});

test("authorization uses a fixed capability registry and current immutable role versions", () => {
  for (const capability of [
    "clinical:document", "clinical:demo", "admin-dashboard:read", "users:read", "users:write",
    "credentials:reset", "sessions:read", "sessions:revoke", "roles:read", "roles:write",
    "roles:assign", "catalog:read", "catalog:write", "catalog:publish", "forms:read",
    "forms:write", "forms:publish"
  ]) assert.ok(roleAuthorizationMigration.includes(`'${capability}'`), `missing ${capability}`);
  assert.match(roleAuthorizationMigration, /create table app_identity\.role_version[\s\S]*role_version_immutable/);
  assert.match(roleAuthorizationMigration, /r\.current_version_id/);
  assert.match(roleAuthorizationMigration, /ura\.ended_at is null/);
  assert.match(roleAuthorizationMigration, /r\.active and r\.assignable/);
  assert.match(roleAuthorizationMigration, /drop table app_identity\.user_capability/);
  assert.match(roleAuthorizationMigration, /capability_fixed_registry/);
});

test("protected roles are explicit, immutable, and keep Reviewer hidden and unassignable", () => {
  for (const role of ["clinician", "administrator", "configuration-author", "clinical-demo", "reviewer"]) {
    assert.ok(roleAuthorizationMigration.includes(`'${role}'`), `missing protected role ${role}`);
  }
  assert.match(roleAuthorizationMigration, /'reviewer', 'Reviewer', true, false, array\[\]::text\[\]/);
  assert.match(roleAuthorizationMigration, /protected_role_immutable/);
  assert.match(roleAuthorizationMigration, /user_role_assignment_valid/);
  assert.match(roleAuthorizationMigration, /protected role % requires its exact capability set/);
  assert.doesNotMatch(roleAuthorizationMigration,
    /'administrator'[\s\S]{0,500}'clinical:document'/,
    "Administrator must not silently inherit clinical access");
});

test("role constraints cover organizations, prerequisites, audit redaction, and append-only history", () => {
  assert.match(roleAuthorizationMigration,
    /foreign key \(organization_id, user_id\)[\s\S]*references app_identity\.app_user\(organization_id, id\)/);
  assert.match(roleAuthorizationMigration,
    /foreign key \(organization_id, role_id\)[\s\S]*references app_identity\.role\(organization_id, id\)/);
  assert.match(roleAuthorizationMigration, /role_version_capabilities_valid[\s\S]*deferrable initially deferred/);
  assert.match(roleAuthorizationMigration, /authorization_event_append_only/);
  assert.match(roleAuthorizationMigration, /password\|password_verifier\|token\|csrf\|secret\|recovery_value/);
  assert.match(roleAuthorizationMigration, /role\.version_activate/);
});

test("ownership transfers are unique, expiring, eligibility-bound, and append-only", async () => {
  const migration = await readFile(path.join(repoRoot,
    "supabase/migrations/20260911260000_ownership_transfer_nominations.sql"), "utf8");
  assert.match(migration, /ownership_transfer_one_pending_idx[\s\S]*where status = 'pending'/);
  assert.match(migration, /expires_at = initiated_at \+ interval '72 hours'/);
  assert.match(migration, /ownership_transfer_user_eligibility/);
  assert.match(migration, /ownership_transfer_administrator_eligibility/);
  assert.match(migration, /ownership_transfer_event_append_only/);
  for (const action of ["initiate", "accept", "cancel", "expire", "ineligible", "stale_assurance", "conflict"]) {
    assert.match(migration, new RegExp(`owner\\.transfer\\.${action}`));
  }
});

test("custom role authoring normalizes identities and audits the first immutable activation", () => {
  assert.match(customRoleAuthoringMigration, /role_display_name_normalized/);
  assert.match(customRoleAuthoringMigration, /normalize\(btrim\(display_name\), NFC\)/);
  assert.match(customRoleAuthoringMigration, /protected_role_identity_not_shadowed/);
  assert.match(customRoleAuthoringMigration,
    /role_initial_version_activation_audit[\s\S]*deferrable initially deferred/);
  assert.match(customRoleAuthoringMigration,
    /jsonb_build_object\('roleId', new\.id, 'priorVersionId', null,[\s\S]*'version', selected_version\.version\)/);
  assert.doesNotMatch(customRoleAuthoringMigration, /jsonb_build_object\([^)]*(display_name|description)/);
});

test("role retirement retains immutable definitions and assignment intervals with redacted lifecycle audit", () => {
  assert.match(roleRetirementMigration, /add column display_name text[\s\S]*role_version_display_name_normalized/);
  assert.match(roleRetirementMigration, /role_assignment_interval_immutable/);
  assert.match(roleRetirementMigration, /role_retirement_closes_assignments[\s\S]*deferrable initially deferred/);
  assert.match(roleRetirementMigration, /custom_role_active_assignable/);
  assert.match(roleRetirementMigration, /'role\.deactivate', 'role\.reactivate'/);
  assert.doesNotMatch(roleRetirementMigration, /password|password_verifier|token|csrf|secret|recovery_value/i);
});

test("portable role-package operations have redacted authorization audit actions", () => {
  assert.match(portableRolePackageMigration, /role\.package_export/);
  assert.match(portableRolePackageMigration, /role\.package_preview/);
  assert.match(portableRolePackageMigration, /role\.package_import/);
  assert.match(portableRolePackageMigration, /target_type in \([^)]*'role_package'/s);
  assert.doesNotMatch(portableRolePackageMigration,
    /display_name|description|capability_key|user_id|assignment_id|password|credential|session|token|secret/i);
});

test("installation ownership is singular, durable, least-privilege, and gates role authority", () => {
  assert.match(installationOwnerMigration,
    /create table app_identity\.installation_owner[\s\S]*organization_id uuid primary key/);
  assert.match(installationOwnerMigration, /installation_owner_not_deleted/);
  assert.match(installationOwnerMigration, /active_owner_user_protected/);
  assert.match(installationOwnerMigration, /owner_local_credential_protected/);
  assert.match(installationOwnerMigration, /owner_administrator_assignment_protected/);
  assert.match(installationOwnerMigration,
    /create or replace function app_identity\.user_has_capability[\s\S]*app_identity\.installation_owner/);
  assert.match(installationOwnerMigration,
    /create table app_identity\.operator_identity_event[\s\S]*operator_id text not null[\s\S]*os_account text not null[\s\S]*host text not null/);
  assert.match(installationOwnerMigration, /operator_identity_event_append_only/);
  assert.match(installationOwnerMigration,
    /password\|password_verifier\|token\|csrf\|secret\|recovery_value/);
});

test("temporary credentials have a bounded expiry and credential-free audit storage", () => {
  assert.match(temporaryCredentialMigration, /temporary_password_expires_at timestamptz/);
  assert.match(temporaryCredentialMigration, /local_credential_temporary_expiry_check/);
  assert.match(temporaryCredentialMigration, /must_change_password and temporary_password_expires_at is not null/);
  assert.match(temporaryCredentialMigration, /add column note text/);
  assert.doesNotMatch(temporaryCredentialMigration, /password_verifier[),]/,
    "the provisioning migration must not copy password verifiers into audit storage");
});

test("user lifecycle revisions reserve historical usernames and extend append-only safe audit actions", () => {
  assert.match(userLifecycleMigration, /add column revision bigint not null default 1/);
  assert.match(userLifecycleMigration, /create table app_identity\.username_reservation/);
  assert.match(userLifecycleMigration, /insert into app_identity\.username_reservation[\s\S]*app_identity\.local_credential/);
  assert.match(userLifecycleMigration, /local_credential_reserved_username_fkey[\s\S]*deferrable initially deferred/);
  assert.match(userLifecycleMigration, /local_credential_username_reserved/);
  assert.match(userLifecycleMigration, /username_reservation_append_only/);
  assert.match(userLifecycleMigration, /'account\.disable', 'account\.reactivate', 'account\.roles_change'/);
  assert.match(userLifecycleMigration, /revoke all on app_identity\.username_reservation from public/);
});

test("session administration stores only bounded activity and coarse-device metadata", () => {
  assert.match(sessionAdministrationMigration, /last_activity_at timestamptz/);
  assert.match(sessionAdministrationMigration, /device_label text not null/);
  assert.match(sessionAdministrationMigration, /app_session_active_user_activity_idx/);
  assert.match(sessionAdministrationMigration, /authentication\.session_revoke/);
  assert.match(sessionAdministrationMigration, /authentication\.reauthenticate/);
  assert.doesNotMatch(sessionAdministrationMigration, /add column (source_ip|geolocation|user_agent)/i);
});

test("catalog authoring separates optimistic drafts from sealed immutable projections", () => {
  assert.match(catalogAuthoringMigration, /create table catalog\.authoring_draft/);
  assert.match(catalogAuthoringMigration, /revision integer not null/);
  assert.match(catalogAuthoringMigration, /catalog_one_editable_draft_per_organization/);
  assert.match(catalogAuthoringMigration, /prevent_sealed_projection_mutation/);
  assert.match(catalogAuthoringMigration, /before insert or update or delete on catalog\.element_option/);
  assert.match(catalogAuthoringMigration, /catalog_publication_event_append_only/);
});

test("code-list projections retain disabled values, deterministic order, and one optional default", () => {
  assert.match(codeListAuthoringMigration, /create table catalog\.value_set_option_configuration/);
  assert.match(codeListAuthoringMigration, /enabled boolean not null default true/);
  assert.match(codeListAuthoringMigration, /sort_order integer/);
  assert.match(codeListAuthoringMigration, /catalog_value_set_option_order_unique/);
  assert.match(codeListAuthoringMigration, /catalog_value_set_option_one_default[\s\S]*where is_default/);
  assert.match(codeListAuthoringMigration, /catalog_value_set_option_configuration_immutable/);
});

test("form authoring uses revision preconditions while retaining immutable published versions", () => {
  assert.match(formAuthoringMigration, /revision integer not null default 1/);
  assert.match(formAuthoringMigration, /forms_one_editable_version_per_form/);
  assert.match(formAuthoringMigration, /where status = 'draft'/);
  assert.match(migration, /prevent_published_form_version_mutation/);
  assert.match(migration, /children of published form version .* are immutable/);
});

test("form publication and agency activation are separate, pinned, and append-only", () => {
  assert.match(formActivationMigration, /create table forms\.agency_stationary_default/);
  assert.match(formActivationMigration, /version_status <> 'published'/);
  assert.match(formActivationMigration, /create table app_identity\.configuration_event/);
  assert.match(formActivationMigration, /'form\.publish', 'form\.activate'/);
  assert.match(formActivationMigration, /previous_form_version_id/);
  assert.match(formActivationMigration, /configuration_event_append_only/);
});

test("form draft mutations remain audited after the draft is deleted", () => {
  assert.match(formDraftAuditMigration, /'form\.draft_create', 'form\.draft_save', 'form\.draft_delete'/);
  assert.match(formDraftAuditMigration, /alter column form_version_id drop not null/);
  assert.doesNotMatch(formDraftAuditMigration, /on delete set null/);
});

test("reports retain immutable, tenant-matched published configuration pins", () => {
  assert.match(reportConfigurationPinMigration, /foreign key \(form_version_id, catalog_release_id\)/);
  assert.match(reportConfigurationPinMigration, /fv\.status = 'published'/);
  assert.match(reportConfigurationPinMigration, /f\.organization_id = new\.organization_id/);
  assert.match(reportConfigurationPinMigration, /report .* identity and pinned configuration are immutable/);
  assert.doesNotMatch(reportConfigurationPinMigration, /agency_stationary_default/);
});

test("prototype deletion remains limited to one explicitly selected synthetic draft", () => {
  assert.match(prototypeDeletionMigration, /current_setting\('open_triage\.prototype_delete_report', true\)/);
  assert.match(prototypeDeletionMigration, /id = candidate_report_id and status = 'draft' and synthetic/);
  assert.match(prototypeDeletionMigration, /id = parent_report_id and status = 'draft' and synthetic/);
  assert.match(prototypeDeletionMigration, /create or replace function public\.prevent_update_or_delete/);
  assert.match(prototypeDeletionMigration, /create or replace function clinical\.prevent_signed_report_mutation/);
});

test("catalog and form versions retain bounded administrator display names", () => {
  assert.match(versionDisplayNameMigration, /alter table catalog\.release[\s\S]*add column display_name text/);
  assert.match(versionDisplayNameMigration, /alter table catalog\.authoring_draft[\s\S]*add column display_name text/);
  assert.match(versionDisplayNameMigration, /alter table forms\.form_version[\s\S]*add column display_name text/);
  assert.equal((versionDisplayNameMigration.match(/char_length\(display_name\) between 1 and 120/g) ?? []).length, 3);
});

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
      assert.match(
        analyticsMigrationSql,
        new RegExp(`(?:\\n  ${column.name} ${column.type},|add column if not exists ${column.name} ${column.type};)`)
      );
    }
  }
  assert.ok(currentAnalyticsViewMigration);
  const viewBlock = currentAnalyticsViewMigration.slice(
    currentAnalyticsViewMigration.indexOf("-- BEGIN GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS"),
    currentAnalyticsViewMigration.indexOf("-- END GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS")
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
    "create table clinical.dispatch_receipt",
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

test("stores immutable dispatch delivery evidence under clinical-data controls", () => {
  assert.match(migration, /create table clinical\.dispatch_receipt \([\s\S]*source_bytes bytea not null/);
  assert.match(migration, /exact_sha256 text generated always as[\s\S]*digest\(source_bytes, 'sha256'\)/);
  assert.match(migration, /canonical_sha256 text generated always as[\s\S]*digest\(source_payload::text, 'sha256'\)/);
  assert.match(migration, /convert_from\(source_bytes, 'UTF8'\)::jsonb = source_payload/);
  assert.match(migration, /not \(source_payload \?\| array\['organizationId', 'organization_id', 'sourceId', 'source_id'\]\)/);
  assert.match(migration, /unique \(organization_id, source_id, message_id\)/);
  assert.match(migration, /unique \(organization_id, source_id, source_record_id, source_revision\)/);
  assert.match(migration, /dispatch_receipt_append_only[\s\S]*prevent_update_or_delete/);
  assert.match(migration, /Source payload bytes must never be copied to ordinary logs/);
});

test("stores a rebuildable agency-scoped dispatch assignment projection", () => {
  assert.match(migration, /create table clinical\.call_assignment \([\s\S]*dispatch_source_id text/);
  assert.match(migration, /create table clinical\.call_assignment \([\s\S]*dispatch_source_record_id text/);
  assert.match(migration, /create table clinical\.call_assignment \([\s\S]*response_number text/);
  assert.match(migration, /create table clinical\.call_assignment \([\s\S]*vehicle_number text/);
  assert.match(migration, /unique \(organization_id, dispatch_source_id, dispatch_source_record_id\)/);
  assert.match(migration, /foreign key \(organization_id, dispatch_receipt_id\)[\s\S]*references clinical\.dispatch_receipt\(organization_id, id\)/);
  assert.doesNotMatch(migration, /unique \(organization_id, call_number\)/);
});

test("retains dispatch conflicts with both values, lineage, and explicit dispositions", () => {
  assert.match(migration, /create table clinical\.dispatch_conflict \([\s\S]*clinician_value jsonb[\s\S]*dispatch_value jsonb/);
  assert.match(migration, /create table clinical\.dispatch_conflict \([\s\S]*clinician_lineage jsonb not null[\s\S]*dispatch_receipt_id uuid not null[\s\S]*dispatch_revision bigint not null/);
  assert.match(migration, /create table clinical\.element_occurrence \([\s\S]*unique \(report_id, id\)[\s\S]*unique nulls not distinct/);
  assert.match(migration, /disposition text check \(disposition in \('keep', 'accept', 'acknowledge'\)\)/);
  assert.match(migration, /dispatch_conflict_report_unresolved_idx[\s\S]*where disposition is null/);
});

test("dispatch cancellation and post-signature proposals remain durable without rewriting signed records", () => {
  assert.match(migration, /dispatch_canceled_at timestamptz[\s\S]*dispatch_cancellation_revision bigint[\s\S]*dispatch_cancellation_receipt_id uuid/);
  assert.match(migration, /create table clinical_audit\.post_signature_dispatch_delivery[\s\S]*proposed_snapshot jsonb not null[\s\S]*differences jsonb not null[\s\S]*acceptance_requires_amendment boolean not null default true/);
  assert.match(migration, /post_signature_dispatch_delivery_append_only[\s\S]*prevent_update_or_delete/);
});

test("documents bounded observable projection work inside the freshness target", () => {
  assert.match(runbook, /analytics\.batchSize/);
  assert.match(runbook, /--show-only templates\/analytics-cronjobs\.yaml/);
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
  assert.match(migration, /grant select on clinical_audit\.draft_reconciliation, clinical_audit\.post_signature_audit_note,[\s\S]*post_signature_dispatch_delivery to open_triage_auditor/);
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
