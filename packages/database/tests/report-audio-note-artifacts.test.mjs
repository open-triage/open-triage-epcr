import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../../supabase/migrations/20260924144000_report_audio_notes.sql", import.meta.url), "utf8");
const persistence = readFileSync(new URL("../../../apps/api/src/reports/report-note.persistence.ts", import.meta.url), "utf8");

test("audio metadata and canonical bytes are private, separate, bounded, indexed, and immutable", () => {
  assert.match(migration, /create table clinical\.report_audio_note/);
  assert.match(migration, /create table clinical\.report_audio_blob[\s\S]*canonical_bytes bytea not null/);
  assert.match(migration, /content_type = 'audio\/mp4'/);
  assert.match(migration, /duration_milliseconds between 1 and 300000/);
  assert.match(migration, /processing_state = 'ready'/);
  assert.match(migration, /report_audio_note_timeline_idx[\s\S]*captured_at desc, id desc/);
  assert.match(migration, /report_audio_blob_immutable[\s\S]*prevent_audio_blob_replacement/);
  assert.match(migration, /revoke all on table clinical\.report_audio_note, clinical\.report_audio_blob from public/);
  assert.doesNotMatch(migration, /grant update[^\n]*canonical_bytes/);
});

test("ordinary timeline queries never select canonical audio bytes", () => {
  assert.match(persistence, /from clinical\.report_audio_note note/);
  assert.doesNotMatch(persistence, /report_audio_blob/);
});
