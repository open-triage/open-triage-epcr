"use client";

import { useAgencyTimeZone } from "../app/agency-time-zone";

import type { CreateReportAudioNoteCommand, ReportAudioNote, ReportAudioSourceContentType, ReportMediaPolicy } from "@open-triage/contracts";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createReportAudioNote, deleteReportAudioNote, fetchReportAudio, updateReportAudioCaption } from "../app/report-audio-api";
import { audioCaptureConstraints, blobToBase64, formatAudioDuration, normalizeAudioCaption,
  REPORT_AUDIO_CAPTION_MAX_CHARACTERS, REPORT_AUDIO_MAX_MILLISECONDS, REPORT_AUDIO_WARNING_MILLISECONDS,
  supportedAudioRecorderType } from "../app/report-audio-notes";
import {
  finishProtectedAudioPreview,
  protectedAudioBlob,
  protectedAudioEntries,
  protectedAudioPreview,
  protectedAudioPreviewBlob,
  protectedStorageActive,
  removeProtectedAudio,
  removeProtectedAudioPreview,
  stageProtectedAudio,
  stageProtectedAudioChunk,
  startProtectedAudioPreview,
  updateProtectedAudio,
  updateProtectedAudioPreview,
} from "../app/protected-clinical-storage";
import { browserMediaCapturePreflight, mediaCaptureErrorMessage } from "../app/media-capture-capability";

const PLAYBACK_EVENT = "open-triage-audio-playback";
let activeAudio: { key: string; element: HTMLAudioElement; url: string } | null = null;

function announcePlayback(key: string | null) {
  window.dispatchEvent(new CustomEvent(PLAYBACK_EVENT, { detail: key }));
}

export function stopActiveAudio() {
  if (!activeAudio) return;
  activeAudio.element.pause();
  URL.revokeObjectURL(activeAudio.url);
  activeAudio = null;
  announcePlayback(null);
}

export function AuthorizedAudioButton({ reportId, noteId, label = "Play audio note", className }: {
  readonly reportId: string; readonly noteId: string; readonly label?: string; readonly className?: string;
}) {
  const key = `${reportId}:${noteId}`;
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const update = (event: Event) => setPlaying((event as CustomEvent<string | null>).detail === key);
    window.addEventListener(PLAYBACK_EVENT, update);
    return () => window.removeEventListener(PLAYBACK_EVENT, update);
  }, [key]);

  async function toggle() {
    if (activeAudio?.key === key) { stopActiveAudio(); return; }
    setLoading(true); setError(null); stopActiveAudio();
    try {
      const blob = protectedAudioBlob(reportId, noteId) ?? await fetchReportAudio(reportId, noteId);
      const url = URL.createObjectURL(blob);
      const element = new Audio(url);
      element.preload = "auto";
      element.addEventListener("ended", stopActiveAudio, { once: true });
      element.addEventListener("error", stopActiveAudio, { once: true });
      activeAudio = { key, element, url };
      await element.play();
      announcePlayback(key);
    } catch { stopActiveAudio(); setError("Audio unavailable"); }
    finally { setLoading(false); }
  }

  return <span className="audio-playback-control"><button className={className} type="button" aria-label={playing ? "Pause audio note" : label}
    aria-pressed={playing} disabled={loading} onClick={() => void toggle()}>{loading ? "Loading…" : playing ? "Pause" : "Play"}</button>
    {error && <small role="alert">{error}</small>}</span>;
}

type Capture = { blob: Blob; previewUrl: string; capturedAt: string; capturedUtcOffsetMinutes: number;
  durationMilliseconds: number; sourceContentType: ReportAudioSourceContentType; interrupted: boolean };

export function AudioNoteDialog({ dialogRef, reportId, note, csrfToken, revision, mediaPolicy, author,
  onClose, onSaved, onQueued, onDeleted, onSessionEnded }: {
  readonly dialogRef: RefObject<HTMLElement | null>; readonly reportId: string; readonly note: ReportAudioNote | null;
  readonly csrfToken: string; readonly revision: number; readonly onClose: () => void;
  readonly mediaPolicy: ReportMediaPolicy; readonly author: ReportAudioNote["author"];
  readonly onSaved: (note: ReportAudioNote, revision: number) => void; readonly onDeleted: (noteId: string, revision: number) => void;
  readonly onQueued: (note: ReportAudioNote) => void;
  readonly onSessionEnded: () => void;
}) {
  const zone = useAgencyTimeZone();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const chunkWrites = useRef<Promise<void>>(Promise.resolve());
  const chunkSequence = useRef(0);
  const startedAt = useRef(0);
  const elapsedRef = useRef(0);
  const interruptedRef = useRef(false);
  const holdingRef = useRef(false);
  const startingRef = useRef(false);
  const animation = useRef(0);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const keepAfterDelete = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"ready" | "recording" | "preview" | "viewer">(note ? "viewer" : "ready");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [caption, setCaption] = useState(note?.caption ?? "");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const validation = normalizeAudioCaption(caption);
  const recorderSupport = supportedAudioRecorderType();
  const captureUnavailable = note ? null : browserMediaCapturePreflight("microphone", Boolean(recorderSupport));
  const previewUrl = capture?.previewUrl;

  useEffect(() => {
    if (confirmingDelete) keepAfterDelete.current?.focus();
  }, [confirmingDelete]);

  function cancelDelete() {
    setConfirmingDelete(false);
    window.requestAnimationFrame(() => deleteTrigger.current?.focus());
  }

  useEffect(() => {
    if (note) return;
    const preview = protectedAudioPreview(reportId);
    const blob = protectedAudioPreviewBlob(reportId);
    if (!preview) return;
    if (!blob || !preview.chunks.length) { void removeProtectedAudioPreview(reportId); return; }
    queueMicrotask(() => {
      setCapture({ blob, previewUrl: URL.createObjectURL(blob), capturedAt: preview.capturedAt,
        capturedUtcOffsetMinutes: preview.capturedUtcOffsetMinutes, durationMilliseconds: preview.durationMilliseconds,
        sourceContentType: preview.sourceContentType, interrupted: true });
      setCaption(preview.caption);
      setMode("preview");
    });
  }, [note, reportId]);

  const finishRecording = useCallback((interrupted = false) => {
    interruptedRef.current ||= interrupted;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  useEffect(() => {
    if (mode !== "recording") return;
    const interrupt = () => { if (document.visibilityState !== "visible") finishRecording(true); };
    const pageHide = () => finishRecording(true);
    document.addEventListener("visibilitychange", interrupt);
    window.addEventListener("pagehide", pageHide);
    return () => { document.removeEventListener("visibilitychange", interrupt); window.removeEventListener("pagehide", pageHide); };
  }, [finishRecording, mode]);

  useEffect(() => () => {
    holdingRef.current = false;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    audioContext.current?.close().catch(() => undefined);
    cancelAnimationFrame(animation.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    stopActiveAudio();
  }, [previewUrl]);

  async function startRecording() {
    if (startingRef.current || recorder.current?.state === "recording") return;
    if (!recorderSupport || captureUnavailable) {
      setError(captureUnavailable ?? "Spoken-audio recording is not supported by this browser. Text notes remain available.");
      return;
    }
    startingRef.current = true;
    setError(null); setCapture(null); setElapsed(0); elapsedRef.current = 0; interruptedRef.current = false;
    chunks.current = []; chunkWrites.current = Promise.resolve(); chunkSequence.current = 0;
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia(audioCaptureConstraints());
      if (!holdingRef.current) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = nextStream;
      nextStream.getAudioTracks()[0]?.addEventListener("ended", () => finishRecording(true), { once: true });
      const nextRecorder = new MediaRecorder(nextStream, { mimeType: recorderSupport.recorderType, audioBitsPerSecond: 64_000 });
      recorder.current = nextRecorder;
      startedAt.current = Date.now();
      if (protectedStorageActive(reportId)) await startProtectedAudioPreview(reportId, {
        recorderContentType: recorderSupport.recorderType, sourceContentType: recorderSupport.sourceContentType,
        capturedAt: new Date(startedAt.current).toISOString(), capturedUtcOffsetMinutes: -new Date(startedAt.current).getTimezoneOffset(),
        durationMilliseconds: 0, caption, interrupted: true, complete: false,
      });
      if (!holdingRef.current) {
        nextStream.getTracks().forEach((track) => track.stop()); stream.current = null;
        await removeProtectedAudioPreview(reportId);
        return;
      }
      nextRecorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size) return;
        chunks.current.push(event.data);
        if (!protectedStorageActive(reportId)) return;
        const sequence = chunkSequence.current++;
        const duration = Math.max(1, elapsedRef.current);
        chunkWrites.current = chunkWrites.current.then(async () => stageProtectedAudioChunk(reportId,
          { sequence, sourceBase64: await blobToBase64(event.data) }, duration));
      });
      nextRecorder.addEventListener("stop", () => { void (async () => {
        const durationMilliseconds = Math.min(REPORT_AUDIO_MAX_MILLISECONDS, Math.max(1, elapsedRef.current));
        await chunkWrites.current;
        const blob = new Blob(chunks.current, { type: recorderSupport.recorderType });
        nextStream.getTracks().forEach((track) => track.stop()); stream.current = null;
        cancelAnimationFrame(animation.current); void audioContext.current?.close(); audioContext.current = null;
        if (!blob.size || durationMilliseconds < 250) {
          await removeProtectedAudioPreview(reportId);
          setMode("ready"); setError("No usable speech was captured. Try again."); return;
        }
        await finishProtectedAudioPreview(reportId, { durationMilliseconds,
          interrupted: interruptedRef.current, complete: true });
        setCapture({ blob, previewUrl: URL.createObjectURL(blob), capturedAt: new Date(startedAt.current).toISOString(),
          capturedUtcOffsetMinutes: -new Date(startedAt.current).getTimezoneOffset(), durationMilliseconds,
          sourceContentType: recorderSupport.sourceContentType, interrupted: interruptedRef.current });
        setMode("preview");
      })().catch((caught) => {
        setMode("ready");
        setError(caught instanceof Error ? caught.message : "The interrupted recording could not be protected.");
      }); }, { once: true });
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) {
        const context = new Context(); audioContext.current = context;
        const source = context.createMediaStreamSource(nextStream); const nextAnalyser = context.createAnalyser(); nextAnalyser.fftSize = 256;
        source.connect(nextAnalyser); analyser.current = nextAnalyser;
      }
      setMode("recording"); nextRecorder.start(1000);
      const sample = () => {
        const nextElapsed = Math.min(REPORT_AUDIO_MAX_MILLISECONDS, Date.now() - startedAt.current);
        elapsedRef.current = nextElapsed; setElapsed(nextElapsed);
        if (analyser.current) {
          const values = new Uint8Array(analyser.current.fftSize); analyser.current.getByteTimeDomainData(values);
          const peak = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value - 128)), 0) / 128; setLevel(peak);
        }
        if (nextElapsed >= REPORT_AUDIO_MAX_MILLISECONDS) finishRecording(false);
        else animation.current = requestAnimationFrame(sample);
      };
      animation.current = requestAnimationFrame(sample);
    } catch (caught) {
      stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
      await removeProtectedAudioPreview(reportId);
      setMode("ready"); setError(mediaCaptureErrorMessage("microphone", caught));
    } finally { startingRef.current = false; }
  }

  function beginHold() {
    if (mode !== "ready") return;
    holdingRef.current = true;
    void startRecording();
  }

  function endHold() {
    holdingRef.current = false;
    finishRecording(false);
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapture(null); setMode("ready"); setError(null);
    void removeProtectedAudioPreview(reportId);
  }

  async function save() {
    if (saving || validation.error) return;
    setSaving(true); setError(null);
    try {
      if (note) {
        if (note.persistenceState !== "ready") {
          await updateProtectedAudio(reportId, note.id, (entry) => ({ ...entry,
            command: { ...entry.command, caption: validation.caption },
            note: { ...entry.note, caption: validation.caption, updatedAt: new Date().toISOString() },
          }));
          onQueued({ ...note, caption: validation.caption, updatedAt: new Date().toISOString() });
          return;
        }
        const response = await updateReportAudioCaption(csrfToken, reportId, note.id, { commandId: crypto.randomUUID(), expectedRevision: revision, caption: validation.caption });
        if (protectedAudioEntries(reportId).some(({ note: candidate }) => candidate.id === note.id)) {
          await updateProtectedAudio(reportId, note.id, (entry) => ({ ...entry, note: response.note }));
        }
        onSaved(response.note, response.revision);
      } else {
        if (!capture) return;
        const sourceBase64 = await blobToBase64(capture.blob);
        const command: CreateReportAudioNoteCommand = { commandId: crypto.randomUUID(), expectedRevision: revision,
          noteId: crypto.randomUUID(), capturedAt: capture.capturedAt, capturedUtcOffsetMinutes: capture.capturedUtcOffsetMinutes,
          caption: validation.caption, sourceContentType: capture.sourceContentType, sourceBase64,
          settingsRevision: mediaPolicy.settingsRevision, effectiveAllowanceBytes: mediaPolicy.reportMediaAllowanceBytes };
        if (protectedStorageActive(reportId)) {
          const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await capture.blob.arrayBuffer()))]
            .map((byte) => byte.toString(16).padStart(2, "0")).join("");
          const localNote: ReportAudioNote = {
            id: command.noteId, reportId, type: "audio", caption: validation.caption,
            capturedAt: command.capturedAt, capturedUtcOffsetMinutes: command.capturedUtcOffsetMinutes,
            author, serverReceivedAt: command.capturedAt, updatedAt: command.capturedAt,
            persistenceState: "saved-on-device", contentType: "audio/mp4", byteSize: capture.blob.size,
            sha256: digest, durationMilliseconds: capture.durationMilliseconds,
          };
          await stageProtectedAudio(reportId, { note: localNote, command });
          onQueued(localNote);
        } else {
          const response = await createReportAudioNote(csrfToken, reportId, command);
          onSaved(response.note, response.revision);
        }
      }
    } catch (caught) {
      if (caught instanceof Error && caught.message === "session") onSessionEnded();
      else setError(caught instanceof Error ? caught.message : "The recording could not be saved.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!note || saving) return;
    setSaving(true);
    try {
      if (note.persistenceState !== "ready") {
        const entry = protectedAudioEntries(reportId).find(({ note: candidate }) => candidate.id === note.id);
        if (entry && !entry.attempted) {
          await removeProtectedAudio(reportId, note.id);
          onDeleted(note.id, revision);
          return;
        }
      }
      // Delete even when the attempted upload was rejected; never require it to succeed first.
      const response = await deleteReportAudioNote(csrfToken, reportId, note.id, { commandId: crypto.randomUUID(), expectedRevision: revision });
      await removeProtectedAudio(reportId, note.id);
      stopActiveAudio(); onDeleted(note.id, response.revision);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "session") onSessionEnded();
      else setError(caught instanceof Error ? caught.message : "The recording could not be deleted.");
      setConfirmingDelete(false);
    } finally { setSaving(false); }
  }

  async function retry() {
    if (!note || note.persistenceState !== "failed") return;
    await updateProtectedAudio(reportId, note.id, (entry) => ({ ...entry,
      ...(entry.failure === "server-conflict" ? {
        attempted: false, command: { ...entry.command, commandId: crypto.randomUUID(), expectedRevision: revision },
      } : {}),
      failure: undefined, note: { ...entry.note, persistenceState: "saved-on-device" },
    }));
    onQueued({ ...note, persistenceState: "saved-on-device" });
    onClose();
  }

  const remaining = REPORT_AUDIO_MAX_MILLISECONDS - elapsed;
  return <div className="dialog-backdrop" role="presentation"><section ref={dialogRef} className="note-dialog audio-note-dialog"
    role={confirmingDelete ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="audio-dialog-title"
    aria-describedby={confirmingDelete ? "audio-delete-description" : "audio-purpose-description"} onKeyDownCapture={(event) => {
      if (event.key !== "Escape") return;
      if (confirmingDelete) { event.preventDefault(); event.stopPropagation(); cancelDelete(); }
      else if (mode === "recording") { event.preventDefault(); event.stopPropagation(); holdingRef.current = false; finishRecording(true); }
    }}>
    <div className="note-dialog-heading"><div><p className="eyebrow">{note ? `${note.persistenceState === "ready" ? "Ready" : note.persistenceState === "saved-on-device" ? "Saved on this device" : note.persistenceState[0]!.toUpperCase() + note.persistenceState.slice(1)} audio note` : mode === "recording" ? "Recording spoken observation" : mode === "preview" ? capture?.interrupted ? "Interrupted recording — choose Use or Discard" : "Review recording" : "Live microphone"}</p>
      <h2 id="audio-dialog-title">Audio note</h2></div>{note && !confirmingDelete && <button ref={deleteTrigger} className="remove-entry-button" type="button" onClick={() => setConfirmingDelete(true)}>Delete audio</button>}</div>
    {confirmingDelete ? <><p id="audio-delete-description">Delete this recording and its caption from the draft report? Saved bytes cannot be recovered or replaced.</p>
      <div className="note-dialog-actions"><button ref={keepAfterDelete} data-dialog-initial-focus type="button" onClick={cancelDelete}>Keep audio</button>
        <button className="remove-entry-button" type="button" disabled={saving} onClick={() => void remove()}>{saving ? "Deleting…" : "Delete audio"}</button></div></> : <>
      <p id="audio-purpose-description" className="audio-purpose">For spoken clinical observations only. This is not a diagnostic-sound recorder and it does not transcribe speech.</p>
      {(mode === "ready" || mode === "recording") && <div className="audio-capture-stage">
        <div className="audio-capture-indicator">
          <strong className={`audio-timer${mode === "ready" ? " capture-hidden" : ""}`} role="status" aria-live="polite">Recording {formatAudioDuration(elapsed)}</strong>
        </div>
        <div className="audio-capture-feedback">
          <p className={mode === "recording" ? "capture-hidden" : undefined}>Press and hold to record for up to 5:00. Recording stops if this page is hidden.</p>
          <span className={`audio-level${mode === "ready" ? " capture-hidden" : ""}`} aria-label={`Microphone input level ${Math.round(level * 100)} percent`}><span style={{ width: `${Math.max(2, level * 100)}%` }} /></span>
        </div>
        <p className={`audio-warning${mode === "ready" || remaining > REPORT_AUDIO_WARNING_MILLISECONDS ? " capture-hidden" : ""}`}>Recording stops in {formatAudioDuration(remaining)}.</p>
        <button className="audio-hold-button" data-dialog-initial-focus type="button" disabled={Boolean(captureUnavailable)}
          aria-describedby={captureUnavailable ? "report-audio-error" : undefined}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); beginHold(); }}
          onPointerUp={(event) => { event.preventDefault(); endHold(); }}
          onPointerCancel={endHold} onLostPointerCapture={endHold}
          onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); beginHold(); } }}
          onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); endHold(); } }}
          onClick={(event) => event.preventDefault()}>{mode === "recording" ? "Recording — release to stop" : "Hold to record"}</button></div>}
      {mode === "preview" && capture && <div className="audio-preview"><p role={capture.interrupted ? "alert" : "status"}>{capture.interrupted ? "Recording interrupted. Review it, then explicitly Use or Discard it." : `Captured ${formatAudioDuration(capture.durationMilliseconds)}.`}</p>
        <PreviewAudioButton source={capture.previewUrl} /></div>}
      {mode === "viewer" && note && <div className="audio-preview"><AuthorizedAudioButton reportId={reportId} noteId={note.id} label="Play complete audio note" />
        <p className="note-metadata">{formatAudioDuration(note.durationMilliseconds)} · Captured {new Date(note.capturedAt).toLocaleString(undefined, zone ? { timeZone: zone } : undefined)} · {note.author.displayName} · {note.persistenceState === "saved-on-device" ? "Saved on this device" : note.persistenceState[0]!.toUpperCase() + note.persistenceState.slice(1)}</p>
        {note.persistenceState === "failed" && <button type="button" onClick={() => void retry()}>Retry upload</button>}</div>}
      {(mode === "preview" || mode === "viewer") && <><label htmlFor="report-audio-caption">Caption <small>(optional)</small></label>
        <textarea id="report-audio-caption" rows={3} maxLength={REPORT_AUDIO_CAPTION_MAX_CHARACTERS} value={caption}
          aria-invalid={Boolean(validation.error || error)} aria-describedby="report-audio-caption-count report-audio-error"
          onChange={(event) => { const value = event.target.value; setCaption(value); setError(null);
            if (capture && protectedStorageActive(reportId)) updateProtectedAudioPreview(reportId, { caption: value }); }} />
        <small id="report-audio-caption-count">{validation.characterCount.toLocaleString()} / {REPORT_AUDIO_CAPTION_MAX_CHARACTERS.toLocaleString()} characters</small></>}
      <p id="report-audio-error" className="finish-help" role={validation.error || error ? "alert" : captureUnavailable ? "status" : undefined}>{validation.error ?? error ?? captureUnavailable}</p>
      <div className="note-dialog-actions">{mode === "preview" ? <button type="button" disabled={saving} onClick={discard}>Discard</button> : <button type="button" disabled={saving || mode === "recording"} onClick={onClose}>Close</button>}
        {mode === "preview" && <button type="button" disabled={saving || Boolean(validation.error)} onClick={() => void save()}>{saving ? "Processing…" : capture?.interrupted ? "Use interrupted recording" : "Use recording"}</button>}
        {mode === "viewer" && <button type="button" disabled={saving || Boolean(validation.error)} onClick={() => void save()}>{saving ? "Saving…" : "Save caption"}</button>}</div>
    </>}
  </section></div>;
}

function PreviewAudioButton({ source }: { readonly source: string }) {
  const audio = useRef<HTMLAudioElement>(null); const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  return <><audio ref={audio} src={source} preload="metadata" onEnded={() => setPlaying(false)} />
    <button type="button" aria-pressed={playing} onClick={() => { const element = audio.current; if (!element) return;
      if (element.paused) { stopActiveAudio(); void element.play(); setPlaying(true); } else { element.pause(); setPlaying(false); } }}>{playing ? "Pause preview" : "Play preview"}</button></>;
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
