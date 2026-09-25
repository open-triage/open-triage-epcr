import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260924150000_auditable_report_note_collaboration.sql",
  import.meta.url,
), "utf8");
const helper = readFileSync(new URL(
  "../../../apps/api/src/reports/report-note-collaboration.ts",
  import.meta.url,
), "utf8");
const persistence = readFileSync(new URL(
  "../../../apps/api/src/reports/report-note.persistence.ts",
  import.meta.url,
), "utf8");

test("note collaboration schema retains content-free lineage, mutation audit, and access audit", () => {
  assert.match(migration, /create table clinical\.report_note_target_state/);
  assert.match(migration, /create table clinical_audit\.report_note_mutation_event/);
  assert.match(migration, /create table clinical_audit\.report_media_access_event/);
  assert.match(migration, /prevent_report_note_provenance_change/);
  assert.doesNotMatch(migration.match(/create table clinical_audit\.report_note_mutation_event[\s\S]*?\);/)?.[0] ?? "", /content|caption|bytes/);
});

test("ordinary timeline metadata loading cannot emit media-access events", () => {
  assert.doesNotMatch(persistence, /report_media_access_event/);
  assert.match(helper, /mediaType === "photo" \? "open" : "retrieve"/);
});
