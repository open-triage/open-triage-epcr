import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../../../supabase/migrations/20260924094328_agency_media_quota_settings.sql",
  import.meta.url,
), "utf8");
const appearanceMigration = await readFile(new URL(
  "../../../supabase/migrations/20260924143000_agency_appearance_and_profile_settings.sql",
  import.meta.url,
), "utf8");
const demoReadMigration = await readFile(new URL(
  "../../../supabase/migrations/20260924170000_demo_agency_settings_read.sql",
  import.meta.url,
), "utf8");
const imageLimitMigration = await readFile(new URL(
  "../../../supabase/migrations/20260924171000_per_image_media_limit.sql",
  import.meta.url,
), "utf8");
const demoHelperMigration = await readFile(new URL(
  "../../../supabase/migrations/20260924172000_restore_demo_credentials_helper.sql",
  import.meta.url,
), "utf8");
const demographicRepairMigration = await readFile(new URL(
  "../../../supabase/migrations/20260925120000_repair_synthetic_agency_demographic.sql",
  import.meta.url,
), "utf8");
const inventory = await readFile(new URL("../../../docs/agency-settings-hardcoded-inventory.md", import.meta.url), "utf8");

test("Agency Settings are organization-scoped, revisioned, bounded, and default to 50 MiB", () => {
  assert.match(migration, /create table app_identity\.agency_settings/);
  assert.match(migration, /organization_id uuid primary key/);
  assert.match(migration, /report_media_allowance_bytes bigint not null default 52428800/);
  assert.match(migration, /between 1048576 and 2147483648/);
  assert.match(migration, /revision bigint not null default 1/);
  assert.match(migration, /organization_seed_agency_settings/);
});

test("appearance is bounded in the revisioned settings aggregate and audits logo digests only", () => {
  assert.match(appearanceMigration, /add column brand_text text not null/);
  assert.match(appearanceMigration, /add column logo_png_data_url text/);
  assert.match(appearanceMigration, /octet_length\(logo_png_data_url\) <= 174800/);
  assert.match(appearanceMigration, /data:image\/png;base64,iVBORw0KGgo/);
  assert.match(appearanceMigration, /old_logo_sha256 text/);
  assert.match(appearanceMigration, /new_logo_sha256 text/);
  assert.doesNotMatch(appearanceMigration.match(/alter table app_identity\.agency_settings_change_event([\s\S]*?);/)?.[1] ?? "",
    /old_logo_png_data_url|new_logo_png_data_url/);
});

test("dAgency edits append canonical versions with organization-scoped audit evidence", () => {
  assert.match(appearanceMigration, /create table app_identity\.agency_demographic_change_event/);
  assert.match(appearanceMigration,
    /references app_identity\.agency_demographic_version\(organization_id, id, catalog_release_id\)/);
  assert.match(appearanceMigration, /agency_demographic_change_event_append_only/);
  assert.match(appearanceMigration, /grant select, insert on app_identity\.agency_demographic_change_event/);
  assert.match(appearanceMigration, /old_dagency_04_terminology_version/);
  assert.match(appearanceMigration, /new_dagency_04_terminology_version/);
});

test("the durable inventory classifies approved and deferred candidates", () => {
  for (const classification of ["security", "legal retention", "clinical protocol", "interoperability",
    "deployment", "schema invariant", "fixture only"]) assert.match(inventory, new RegExp(classification, "i"));
  assert.match(inventory, /Migrated in #501/);
  assert.match(inventory, /Never expose as a casual setting/);
});

test("new reports pin the active allowance and settings revision", () => {
  assert.match(migration, /add column media_settings_revision bigint not null default 1/);
  assert.match(migration, /add column report_media_allowance_bytes bigint not null default 52428800/);
  assert.match(migration, /create trigger report_pin_media_settings/);
  assert.match(migration, /where organization_id = new\.organization_id/);
});

test("per-image and aggregate limits are stored, audited, and pinned separately", () => {
  assert.match(imageLimitMigration, /image_media_limit_bytes bigint/);
  assert.match(imageLimitMigration, /image_media_limit_bytes <= report_media_allowance_bytes/);
  assert.match(imageLimitMigration, /old_image_media_limit_bytes bigint not null/);
  assert.match(imageLimitMigration, /new_image_media_limit_bytes bigint not null/);
  assert.match(imageLimitMigration, /new\.image_media_limit_bytes := coalesce/);
});

test("new organizations receive the documented demo credential helper by default", () => {
  assert.match(demoHelperMigration,
    /alter column helper_text set default[\s\S]*Demo credentials: username \*\*demo\*\*, password \*\*opentriagedemo\*\*/);
  assert.doesNotMatch(demoHelperMigration, /update app_identity\.agency_settings/);
});

test("the invalid synthetic demographic fixture is repaired without rewriting immutable history", () => {
  assert.match(demographicRepairMigration, /insert into app_identity\.agency_demographic_version/);
  assert.match(demographicRepairMigration, /version \+ 1/);
  assert.match(demographicRepairMigration, /dagency_04 = '9920003'/);
  assert.match(demographicRepairMigration, /'36', 'New York', 'ANSI-STATE'/);
  assert.match(demographicRepairMigration, /version \+ 1, dagency_01, 'DEMO-EMS'/);
  assert.match(demographicRepairMigration, /dagency_02 = 'Demonstration EMS'/);
  assert.doesNotMatch(demographicRepairMigration, /update app_identity\.agency_demographic_version/);
});

test("settings changes use dedicated authority and bounded append-only audit facts", () => {
  assert.match(migration, /'settings:read', 'settings:write'/);
  assert.match(migration, /values \('settings:write', 'settings:read'\)/);
  assert.match(migration, /create table app_identity\.agency_settings_change_event/);
  assert.match(migration, /old_report_media_allowance_bytes bigint not null/);
  assert.match(migration, /new_report_media_allowance_bytes bigint not null/);
  assert.match(migration, /agency_settings_change_event_append_only/);
  assert.doesNotMatch(migration.match(/create table app_identity\.agency_settings_change_event \(([\s\S]*?)\n\);/)?.[1] ?? "",
    /jsonb|text|bytea/);
  assert.match(migration, /revoke all on app_identity\.agency_settings,[\s\S]*agency_settings_change_event from public/);
});

test("protected administrators can edit Agency Settings while Demo is read-only", () => {
  const administrator = demoReadMigration.match(/when 'administrator' then array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? "";
  const demo = demoReadMigration.match(/when 'demo' then array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? "";
  assert.match(administrator, /'settings:read'/);
  assert.match(administrator, /'settings:write'/);
  assert.match(demo, /'settings:read'/);
  assert.doesNotMatch(demo, /'settings:write'/);
  assert.match(demoReadMigration, /where role\.system_key = 'demo' and role\.protected/);
});
