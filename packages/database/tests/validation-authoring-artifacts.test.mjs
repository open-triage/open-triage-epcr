import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../../../supabase/migrations/20260918170000_validation_required_element_rule.sql", import.meta.url), "utf8");
const capabilitySql = await readFile(new URL("../../../supabase/migrations/20260918183807_validation_capabilities_and_default_grants.sql", import.meta.url), "utf8");
const lifecycleSql = await readFile(new URL("../../../supabase/migrations/20260918190000_validation_version_lifecycle.sql", import.meta.url), "utf8");
const discardSql = await readFile(new URL("../../../supabase/migrations/20260922090000_allow_validation_draft_discard.sql", import.meta.url), "utf8");
const rolloutSql = await readFile(new URL("../../../supabase/migrations/20260918210000_mark_legacy_unversioned_validation_artifacts.sql", import.meta.url), "utf8");
const reviewSql = await readFile(new URL("../../../supabase/migrations/20260918211904_expose_review_target_server_evaluation.sql", import.meta.url), "utf8");
const seedScript = await readFile(new URL("../scripts/seed-initial-validation-versions.mjs", import.meta.url), "utf8");
const resetScript = await readFile(new URL("../scripts/reset-unsigned-clinical-work.mjs", import.meta.url), "utf8");

test("Validation capabilities have explicit protected-role defaults without changing custom roles", () => {
  for (const capability of ["validation:read", "validation:write", "validation:publish"]) {
    assert.ok(capabilitySql.includes(`'${capability}'`), `missing ${capability}`);
  }
  const administrator = capabilitySql.match(/when 'administrator' then array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? "";
  const demo = capabilitySql.match(/when 'demo' then array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? "";
  assert.match(administrator, /'validation:publish'/);
  assert.match(administrator, /'validation:read'/);
  assert.match(administrator, /'validation:write'/);
  assert.match(demo, /'validation:read'/);
  assert.match(demo, /'validation:write'/);
  assert.doesNotMatch(demo, /'validation:publish'/);
  assert.match(capabilitySql, /where role\.system_key in \('administrator', 'demo'\) and role\.protected/);
  assert.doesNotMatch(capabilitySql, /where role\.system_key is null/);
});

test("validation versions and rule identities are organization-scoped and published content is immutable", () => {
  assert.match(sql, /create table validation\.rule_identity/);
  assert.match(sql, /unique \(organization_id, id\)/);
  assert.match(sql, /foreign key \(organization_id, rule_id\)/);
  assert.match(sql, /published validation versions are immutable/);
  assert.match(sql, /validation_one_draft_per_organization_idx/);
});

test("reports pin a compatible published validation version without rewriting legacy reports", () => {
  assert.match(sql, /add column validation_version_id uuid/);
  assert.match(sql, /report validation version is immutable/);
  assert.match(sql, /must be published and bound to its pinned catalog/);
  assert.match(sql, /null identifies a truthful legacy report/);
});

test("finding persistence carries canonical authored-rule evidence", () => {
  for (const field of ["validation_version_id", "validation_rule_id", "execution_target", "target_element_id", "input_fingerprint"]) {
    assert.ok(sql.includes(field), `missing ${field}`);
  }
});

test("review results are organization-scoped, append-only, and separate from signing findings", () => {
  assert.match(reviewSql, /create table clinical\.validation_review_evaluation/);
  assert.match(reviewSql, /foreign key \(organization_id, report_id\)/);
  assert.match(reviewSql, /foreign key \(organization_id, validation_version_id\)/);
  assert.match(reviewSql, /validation_review_evaluation_append_only/);
  assert.match(reviewSql, /outcome in \('passed', 'findings', 'failed'\)/);
  assert.match(reviewSql, /outcome = 'failed' and jsonb_array_length\(failures\) > 0/);
  assert.match(reviewSql, /grant select, insert on table clinical\.validation_review_evaluation/);
  assert.doesNotMatch(reviewSql, /insert into clinical\.validation_finding/);
});

test("published Validation sources carry clone provenance and immutable integrity metadata", () => {
  assert.match(lifecycleSql, /add column cloned_from_id uuid/);
  assert.match(lifecycleSql, /validation_version_clone_organization_fk/);
  assert.match(lifecycleSql, /status = 'published' and source_sha256 is not null/);
  assert.match(lifecycleSql, /clone provenance, and catalog binding are immutable/);
});

test("draft discard keeps the published-version mutation guard", () => {
  assert.match(discardSql, /if old\.status = 'draft' then return old/);
  assert.match(discardSql, /if old\.status = 'published' then/);
  assert.match(discardSql, /clone provenance, and catalog binding are immutable/);
});

test("Validation publication and activation history is append-only, actor-attributed, and rule-level", () => {
  assert.match(lifecycleSql, /create table validation\.change_event/);
  for (const field of ["actor_id", "source_version_id", "destination_version_id", "change_note", "rule_changes",
    "source_sha256", "compiled_sha256"]) assert.ok(lifecycleSql.includes(field), `missing ${field}`);
  assert.match(lifecycleSql, /validation_change_event_append_only/);
  assert.match(lifecycleSql, /foreign key \(organization_id, destination_version_id\)/);
});

test("rollout marks signed artifacts truthfully without assigning a retroactive version", () => {
  assert.match(rolloutSql, /legacy_unversioned_validation boolean not null default false/g);
  assert.match(rolloutSql, /where report\.validation_version_id is null/);
  assert.match(rolloutSql, /where snapshot\.validation_version_id is null/);
  assert.match(rolloutSql, /warning_acknowledgements/);
  assert.doesNotMatch(rolloutSql, /update clinical\.report[\s\S]*set validation_version_id/);
});

test("initial seeding is replay-safe, discovers the default definition, publishes, and activates a compatible bundle", () => {
  assert.match(seedScript, /readInstallDefinitions/);
  assert.match(seedScript, /defaultPair\.validation/);
  assert.match(seedScript, /status: "already-active"/);
  assert.match(seedScript, /insert into validation\.version/);
  assert.match(seedScript, /insert into app_identity\.active_configuration_bundle/);
  assert.match(seedScript, /sourceKind === "nemsis"/);
  assert.match(seedScript, /rule\.enabled = rule\.enabled && compatible/);
  assert.match(seedScript, /compiledSha256 = compiledValidationBundleSha256\(compiledBundle\)/);
});

test("unsigned reset is migration-only, previewed, confirmed, and verifies the signed boundary", () => {
  assert.match(rolloutSql, /grant execute on function clinical\.reset_unsigned_rollout\(uuid\[\], uuid\[\]\) to open_triage_migration_executor/);
  assert.match(rolloutSql, /revoke all on function clinical\.reset_unsigned_rollout\(uuid\[\], uuid\[\]\) from public/);
  assert.match(rolloutSql, /snapshot\.report_id=requested\.id/);
  assert.match(resetScript, /unsigned_clinical_reset_preview/);
  assert.match(resetScript, /DELETE-UNSIGNED-CLINICAL-WORK/);
  assert.match(resetScript, /Signed reset boundary verification failed/);
});
