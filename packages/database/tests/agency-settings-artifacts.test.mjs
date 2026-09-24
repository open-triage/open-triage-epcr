import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../../../supabase/migrations/20260924094328_agency_media_quota_settings.sql",
  import.meta.url,
), "utf8");

test("Agency Settings are organization-scoped, revisioned, bounded, and default to 50 MiB", () => {
  assert.match(migration, /create table app_identity\.agency_settings/);
  assert.match(migration, /organization_id uuid primary key/);
  assert.match(migration, /report_media_allowance_bytes bigint not null default 52428800/);
  assert.match(migration, /between 1048576 and 2147483648/);
  assert.match(migration, /revision bigint not null default 1/);
  assert.match(migration, /organization_seed_agency_settings/);
});

test("new reports pin the active allowance and settings revision", () => {
  assert.match(migration, /add column media_settings_revision bigint not null default 1/);
  assert.match(migration, /add column report_media_allowance_bytes bigint not null default 52428800/);
  assert.match(migration, /create trigger report_pin_media_settings/);
  assert.match(migration, /where organization_id = new\.organization_id/);
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
