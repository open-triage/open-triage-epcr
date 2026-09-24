import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = await readFile(path.join(repoRoot,
  "supabase/migrations/20260924140000_report_photo_notes.sql"), "utf8");
const indexes = await readFile(path.join(repoRoot,
  "supabase/migrations/20260924141000_report_photo_fk_indexes.sql"), "utf8");
const privileges = await readFile(path.join(repoRoot,
  "supabase/migrations/20260924142000_tighten_report_photo_privileges.sql"), "utf8");
const persistence = await readFile(path.join(repoRoot,
  "apps/api/src/reports/report-note.persistence.ts"), "utf8");

test("photo metadata and canonical bytes are private, separate, bounded, indexed, and immutable", () => {
  assert.match(migration, /create table clinical\.report_photo_note/);
  assert.match(migration, /create table clinical\.report_photo_blob[\s\S]*canonical_bytes bytea not null/);
  assert.match(migration, /width integer not null check \(width between 1 and 2560\)/);
  assert.match(migration, /height integer not null check \(height between 1 and 2560\)/);
  assert.match(migration, /sha256 text not null check/);
  assert.match(migration, /report_photo_note_timeline_idx[\s\S]*captured_at desc, id desc/);
  assert.match(migration, /report_photo_blob_immutable[\s\S]*prevent_photo_blob_replacement/);
  assert.match(migration, /revoke all on table clinical\.report_photo_note, clinical\.report_photo_blob from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, delete on table clinical\.report_photo_blob to open_triage_api_runtime/);
  assert.match(privileges, /grant update \(caption, updated_by, updated_at\) on table clinical\.report_photo_note/);
  assert.match(privileges, /revoke delete on table clinical\.report_photo_blob from open_triage_api_runtime/);
  assert.doesNotMatch(migration, /grant select, insert, update, delete on table clinical\.report_photo_blob/);
  assert.match(indexes, /report_photo_note_organization_report_idx/);
  assert.match(indexes, /report_photo_note_organization_created_by_idx/);
  assert.match(indexes, /report_photo_note_organization_updated_by_idx/);
  assert.match(indexes, /report_photo_blob_organization_report_idx/);
});

test("ordinary report note queries select photo metadata without touching canonical bytes", () => {
  assert.match(persistence, /from clinical\.report_photo_note note/);
  assert.doesNotMatch(persistence, /report_photo_blob/);
  assert.doesNotMatch(persistence, /canonical_bytes/);
});
