import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = await readFile(path.join(repoRoot,
  "supabase/migrations/20260924093945_report_text_notes.sql"), "utf8");

test("app-native report notes are private, bounded, indexed, and signed-report immutable", () => {
  assert.match(migration, /create table clinical\.report_note/);
  assert.match(migration, /char_length\(content\) between 1 and 10000/);
  assert.match(migration, /content = btrim\(content\)/);
  assert.match(migration, /regexp_replace\(content,[\s\S]*!~ '\[\[:cntrl:\]\]'/);
  assert.match(migration, /captured_utc_offset_minutes between -840 and 840/);
  assert.match(migration, /report_note_timeline_idx[\s\S]*captured_at desc, id desc/);
  assert.match(migration, /report_note_signed_immutable[\s\S]*clinical\.prevent_signed_report_mutation/);
  assert.match(migration, /revoke all on table clinical\.report_note from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table clinical\.report_note[\s\S]*open_triage_api_runtime/);
  assert.doesNotMatch(migration, /create policy/);
});
