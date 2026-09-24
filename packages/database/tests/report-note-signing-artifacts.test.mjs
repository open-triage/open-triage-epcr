import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL(
  "../../../supabase/migrations/20260924151000_bind_report_notes_to_signed_manifest.sql", import.meta.url), "utf8");
const signing = readFileSync(new URL("../../../apps/api/src/reports/sign-report.service.ts", import.meta.url), "utf8");

test("signed snapshots retain a checked canonical integrity manifest", () => {
  assert.match(migration, /add column integrity_manifest jsonb not null/);
  assert.match(migration, /jsonb_typeof\(integrity_manifest->'notes'\) = 'array'/);
  assert.match(signing, /lockAndValidateReportNotes\(manager, report\)/);
  assert.match(signing, /JSON\.stringify\(payload\)/);
});

test("media note state and integrity metadata remain enforceable and immutable", () => {
  assert.match(migration, /processing_state in \('uploading', 'processing', 'ready', 'failed'\)/);
  assert.match(migration, /prevent_report_media_integrity_change/);
  assert.match(signing, /notes: ReadonlyArray<SignedNoteManifestEntry>/);
});
