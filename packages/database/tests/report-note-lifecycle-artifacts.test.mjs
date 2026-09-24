import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lifecycle = await readFile(new URL(
  "../../../supabase/migrations/20260924160000_archive_and_purge_report_notes.sql",
  import.meta.url,
), "utf8");
const synthetic = await readFile(new URL(
  "../../../supabase/migrations/20260911270000_expire_synthetic_records.sql",
  import.meta.url,
), "utf8");
const recovery = await readFile(new URL(
  "../../../supabase/migrations/20260917210000_reconcile_offline_completion_and_purge.sql",
  import.meta.url,
), "utf8");
const audioNormalizer = await readFile(new URL(
  "../../../apps/api/src/reports/report-audio-normalizer.service.ts",
  import.meta.url,
), "utf8");

test("archives app-native notes outside NEMSIS with verified canonical media", () => {
  assert.match(lifecycle, /'appNativeNotes', retention\.report_note_archive_payload\(r\.id\)/);
  assert.match(lifecycle, /'archiveFormat', 'open-triage-report-archive-1\.1\.0'/);
  assert.match(lifecycle, /octet_length\(blob\.canonical_bytes\) <> note\.byte_size/);
  assert.match(lifecycle, /digest\(blob\.canonical_bytes, 'sha256'\)[\s\S]*<> note\.sha256/);
  assert.match(lifecycle,
    /'bytes', replace\(encode\(blob\.canonical_bytes, 'base64'\), E'\\n', ''\)/);
  assert.match(lifecycle, /'sha256', encode\(public\.digest\(blob\.canonical_bytes, 'sha256'\), 'hex'\)/);
  assert.doesNotMatch(lifecycle, /nemsis[^\n]*appNativeNotes|appNativeNotes[^\n]*nemsis/i);
});

test("report ownership remains the single ordinary and synthetic note retention boundary", () => {
  assert.match(synthetic, /set_config\('open_triage\.synthetic_purge_report'/);
  assert.match(synthetic, /delete from clinical\.report where id = selected_report\.id/);
  assert.match(synthetic, /purged report % can never be recreated/);
  assert.match(recovery, /report_delete_purges_offline_recovery/);
  assert.match(recovery, /set state = 'purged', wrapping_nonce = null, wrapped_data_key = null/);
  assert.match(recovery, /delete from offline_recovery\.report_recovery_grant where report_id = candidate_report_id/);
});

test("temporary audio sources are process-local and unconditionally removed", () => {
  assert.match(audioNormalizer, /mkdtemp/);
  assert.match(audioNormalizer, /finally/);
  assert.match(audioNormalizer, /rm\(directory, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(audioNormalizer, /insert into|update [a-z_]+\./i);
});

test("purge evidence stays bounded and content-free", () => {
  const syntheticTombstone = synthetic.match(
    /create table clinical_audit\.synthetic_purge_tombstone \(([\s\S]*?)\n\);/,
  )?.[1] ?? "";
  const recoveryTombstone = recovery.match(
    /create table offline_recovery\.report_purge_tombstone \(([\s\S]*?)\n\);/,
  )?.[1] ?? "";
  for (const tombstone of [syntheticTombstone, recoveryTombstone]) {
    assert.doesNotMatch(tombstone, /content|caption|canonical_bytes|ciphertext|wrapped_data_key/i);
  }
});
