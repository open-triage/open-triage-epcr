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
  assert.match(component, /noteUi.use.interrupted.recording/);
  assert.match(component, /noteUi.retry.upload/);
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

test("hold-to-record feedback occupies stable slots so the recording button does not move", async () => {
  const component = await readFile(path.join(webRoot, "components/audio-note.tsx"), "utf8");
  const styles = await readFile(path.join(webRoot, "app/styles.css"), "utf8");
  assert.match(component, /audio-capture-indicator/);
  assert.match(component, /audio-capture-feedback/);
  assert.match(component, /capture-hidden/);
  assert.doesNotMatch(component, /microphone-icon/);
  assert.doesNotMatch(styles, /\.microphone-icon/);
  assert.match(styles, /\.audio-capture-stage\s*{[^}]*grid-template-rows:/);
  assert.match(styles, /\.audio-hold-button\s*{[^}]*width:\s*min\(290px, 100%\)/);
});
