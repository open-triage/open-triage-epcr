import assert from "node:assert/strict";
import test from "node:test";
import { formatAudioDuration, normalizeAudioCaption, REPORT_AUDIO_MAX_MILLISECONDS } from "../app/report-audio-notes";

test("audio duration presentation stays bounded and legible", () => {
  assert.equal(formatAudioDuration(0), "0:00");
  assert.equal(formatAudioDuration(61_001), "1:02");
  assert.equal(formatAudioDuration(REPORT_AUDIO_MAX_MILLISECONDS), "5:00");
});

test("audio captions normalize safely without introducing transcription", () => {
  assert.deepEqual(normalizeAudioCaption("  Spoken observation  "), { caption: "Spoken observation", characterCount: 18, error: null });
  assert.match(normalizeAudioCaption("unsafe\u0000caption").error ?? "", /control characters/);
  assert.equal(normalizeAudioCaption("   ").caption, null);
});
