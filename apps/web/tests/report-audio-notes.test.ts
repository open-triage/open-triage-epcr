import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatAudioDuration, normalizeAudioCaption, REPORT_AUDIO_MAX_MILLISECONDS } from "../app/report-audio-notes";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("audio duration presentation stays bounded and legible", () => {
  assert.equal(formatAudioDuration(0), "0:00");
  assert.equal(formatAudioDuration(61_001), "1:02");
  assert.equal(formatAudioDuration(REPORT_AUDIO_MAX_MILLISECONDS), "5:00");
});

test("audio capture persists chunks, restores interrupted previews, and exposes the offline lifecycle", async () => {
  const component = await readFile(path.join(webRoot, "components/audio-note.tsx"), "utf8");
  const workspace = await readFile(path.join(webRoot, "app/page.tsx"), "utf8");
  const storage = await readFile(path.join(webRoot, "app/protected-clinical-storage.ts"), "utf8");
  assert.match(component, /stageProtectedAudioChunk/);
  assert.match(component, /protectedAudioPreviewBlob/);
  assert.match(component, /Use interrupted recording/);
  assert.match(component, /Retry upload/);
  assert.match(workspace, /createReportAudioNote/);
  assert.match(workspace, /server audio copy could not be verified/);
  assert.match(workspace, /disabled={!report \|\| editingBlocked}/);
  assert.match(storage, /audioQueue/);
  assert.match(storage, /audioPreview/);
});

test("audio captions normalize safely without introducing transcription", () => {
  assert.deepEqual(normalizeAudioCaption("  Spoken observation  "), { caption: "Spoken observation", characterCount: 18, error: null });
  assert.match(normalizeAudioCaption("unsafe\u0000caption").error ?? "", /control characters/);
  assert.equal(normalizeAudioCaption("   ").caption, null);
});
