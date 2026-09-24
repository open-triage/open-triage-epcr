import type { ReportAudioSourceContentType } from "@open-triage/contracts";

export const REPORT_AUDIO_MAX_MILLISECONDS = 300_000;
export const REPORT_AUDIO_WARNING_MILLISECONDS = 30_000;
export const REPORT_AUDIO_CAPTION_MAX_CHARACTERS = 1_000;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export function audioCaptureConstraints(): MediaStreamConstraints {
  return { video: false, audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
}

export function supportedAudioRecorderType(): { recorderType: string; sourceContentType: ReportAudioSourceContentType } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: ReadonlyArray<{ recorderType: string; sourceContentType: ReportAudioSourceContentType }> = [
    { recorderType: "audio/mp4", sourceContentType: "audio/mp4" },
    { recorderType: "audio/webm;codecs=opus", sourceContentType: "audio/webm" },
    { recorderType: "audio/ogg;codecs=opus", sourceContentType: "audio/ogg" },
  ];
  return candidates.find(({ recorderType }) => MediaRecorder.isTypeSupported(recorderType)) ?? null;
}

export function normalizeAudioCaption(value: string): { caption: string | null; characterCount: number; error: string | null } {
  const caption = value.normalize("NFC").trim();
  const characterCount = [...caption].length;
  return { caption: caption || null, characterCount,
    error: UNSAFE_CONTROL_CHARACTER.test(caption) ? "Audio captions cannot contain control characters."
      : characterCount > REPORT_AUDIO_CAPTION_MAX_CHARACTERS ? `Audio captions are limited to ${REPORT_AUDIO_CAPTION_MAX_CHARACTERS.toLocaleString()} characters.` : null };
}

export function formatAudioDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}
