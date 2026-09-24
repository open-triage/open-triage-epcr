"use client";

import type { ReportAudioNote, ReportAudioSourceContentType } from "@open-triage/contracts";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createReportAudioNote, deleteReportAudioNote, fetchReportAudio, updateReportAudioCaption } from "../app/report-audio-api";
import { audioCaptureConstraints, blobToBase64, formatAudioDuration, normalizeAudioCaption,
  REPORT_AUDIO_CAPTION_MAX_CHARACTERS, REPORT_AUDIO_MAX_MILLISECONDS, REPORT_AUDIO_WARNING_MILLISECONDS,
  supportedAudioRecorderType } from "../app/report-audio-notes";

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
      const blob = await fetchReportAudio(reportId, noteId);
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

export function AudioNoteDialog({ dialogRef, reportId, note, csrfToken, revision, onClose, onSaved, onDeleted, onSessionEnded }: {
  readonly dialogRef: RefObject<HTMLElement | null>; readonly reportId: string; readonly note: ReportAudioNote | null;
  readonly csrfToken: string; readonly revision: number; readonly onClose: () => void;
  readonly onSaved: (note: ReportAudioNote, revision: number) => void; readonly onDeleted: (noteId: string, revision: number) => void;
  readonly onSessionEnded: () => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const elapsedRef = useRef(0);
  const interruptedRef = useRef(false);
  const animation = useRef(0);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
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
  const previewUrl = capture?.previewUrl;

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
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    audioContext.current?.close().catch(() => undefined);
    cancelAnimationFrame(animation.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    stopActiveAudio();
  }, [previewUrl]);

  async function startRecording() {
    if (!recorderSupport) { setError("Spoken-audio capture is unavailable in this browser. Text notes remain available."); return; }
    setError(null); setCapture(null); setElapsed(0); elapsedRef.current = 0; interruptedRef.current = false; chunks.current = [];
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia(audioCaptureConstraints());
      stream.current = nextStream;
      nextStream.getAudioTracks()[0]?.addEventListener("ended", () => finishRecording(true), { once: true });
      const nextRecorder = new MediaRecorder(nextStream, { mimeType: recorderSupport.recorderType, audioBitsPerSecond: 64_000 });
      recorder.current = nextRecorder;
      nextRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.current.push(event.data); });
      nextRecorder.addEventListener("stop", () => {
        const durationMilliseconds = Math.min(REPORT_AUDIO_MAX_MILLISECONDS, Math.max(1, elapsedRef.current));
        const blob = new Blob(chunks.current, { type: recorderSupport.recorderType });
        nextStream.getTracks().forEach((track) => track.stop()); stream.current = null;
        cancelAnimationFrame(animation.current); void audioContext.current?.close(); audioContext.current = null;
        if (!blob.size || durationMilliseconds < 250) { setMode("ready"); setError("No usable speech was captured. Try again."); return; }
        setCapture({ blob, previewUrl: URL.createObjectURL(blob), capturedAt: new Date(startedAt.current).toISOString(),
          capturedUtcOffsetMinutes: -new Date(startedAt.current).getTimezoneOffset(), durationMilliseconds,
          sourceContentType: recorderSupport.sourceContentType, interrupted: interruptedRef.current });
        setMode("preview");
      }, { once: true });
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) {
        const context = new Context(); audioContext.current = context;
        const source = context.createMediaStreamSource(nextStream); const nextAnalyser = context.createAnalyser(); nextAnalyser.fftSize = 256;
        source.connect(nextAnalyser); analyser.current = nextAnalyser;
      }
      startedAt.current = Date.now(); setMode("recording"); nextRecorder.start(1000);
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
      setMode("ready"); setError(caught instanceof DOMException && caught.name === "NotAllowedError"
        ? "Microphone permission is required to add a spoken-audio note." : "The microphone is unavailable. Check it and try again.");
    }
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapture(null); setMode("ready"); setError(null);
  }

  async function save() {
    if (saving || validation.error) return;
    setSaving(true); setError(null);
    try {
      if (note) {
        const response = await updateReportAudioCaption(csrfToken, reportId, note.id, { commandId: crypto.randomUUID(), expectedRevision: revision, caption: validation.caption });
        onSaved(response.note, response.revision);
      } else {
        if (!capture) return;
        const response = await createReportAudioNote(csrfToken, reportId, { commandId: crypto.randomUUID(), expectedRevision: revision,
          noteId: crypto.randomUUID(), capturedAt: capture.capturedAt, capturedUtcOffsetMinutes: capture.capturedUtcOffsetMinutes,
          caption: validation.caption, sourceContentType: capture.sourceContentType, sourceBase64: await blobToBase64(capture.blob) });
        onSaved(response.note, response.revision);
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
      const response = await deleteReportAudioNote(csrfToken, reportId, note.id, { commandId: crypto.randomUUID(), expectedRevision: revision });
      stopActiveAudio(); onDeleted(note.id, response.revision);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "session") onSessionEnded();
      else setError(caught instanceof Error ? caught.message : "The recording could not be deleted.");
      setConfirmingDelete(false);
    } finally { setSaving(false); }
  }

  const remaining = REPORT_AUDIO_MAX_MILLISECONDS - elapsed;
  return <div className="dialog-backdrop" role="presentation"><section ref={dialogRef} className="note-dialog audio-note-dialog"
    role={confirmingDelete ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="audio-dialog-title"
    aria-describedby={confirmingDelete ? "audio-delete-description" : "audio-purpose-description"} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      if (confirmingDelete) { event.preventDefault(); event.stopPropagation(); setConfirmingDelete(false); }
      else if (mode === "recording") { event.preventDefault(); event.stopPropagation(); finishRecording(true); }
    }}>
    <div className="note-dialog-heading"><div><p className="eyebrow">{note ? "Ready audio note" : mode === "recording" ? "Recording spoken observation" : mode === "preview" ? capture?.interrupted ? "Interrupted recording — choose Use or Discard" : "Review recording" : "Live microphone"}</p>
      <h2 id="audio-dialog-title">Audio note</h2></div>{note && !confirmingDelete && <button className="remove-entry-button" type="button" onClick={() => setConfirmingDelete(true)}>Delete audio</button>}</div>
    {confirmingDelete ? <><p id="audio-delete-description">Delete this recording and its caption from the draft report? Saved bytes cannot be recovered or replaced.</p>
      <div className="note-dialog-actions"><button data-dialog-initial-focus type="button" onClick={() => setConfirmingDelete(false)}>Keep audio</button>
        <button className="remove-entry-button" type="button" disabled={saving} onClick={() => void remove()}>{saving ? "Deleting…" : "Delete audio"}</button></div></> : <>
      <p id="audio-purpose-description" className="audio-purpose">For spoken clinical observations only. This is not a diagnostic-sound recorder and it does not transcribe speech.</p>
      {mode === "ready" && <div className="audio-capture-stage"><span className="microphone-icon" aria-hidden="true" /><p>Record up to 5:00. Recording stops if this page is hidden.</p>
        <button data-dialog-initial-focus type="button" disabled={!recorderSupport} onClick={() => void startRecording()}>Start recording</button></div>}
      {mode === "recording" && <div className="audio-capture-stage"><strong className="audio-timer" role="status" aria-live="polite">Recording {formatAudioDuration(elapsed)}</strong>
        <span className="audio-level" aria-label={`Microphone input level ${Math.round(level * 100)} percent`}><span style={{ width: `${Math.max(2, level * 100)}%` }} /></span>
        {remaining <= REPORT_AUDIO_WARNING_MILLISECONDS && <p className="audio-warning">Recording stops in {formatAudioDuration(remaining)}.</p>}
        <button data-dialog-initial-focus type="button" onClick={() => finishRecording(false)}>Stop recording</button></div>}
      {mode === "preview" && capture && <div className="audio-preview"><p role={capture.interrupted ? "alert" : "status"}>{capture.interrupted ? "Recording interrupted. Review it, then explicitly Use or Discard it." : `Captured ${formatAudioDuration(capture.durationMilliseconds)}.`}</p>
        <PreviewAudioButton source={capture.previewUrl} /></div>}
      {mode === "viewer" && note && <div className="audio-preview"><AuthorizedAudioButton reportId={reportId} noteId={note.id} label="Play complete audio note" />
        <p className="note-metadata">{formatAudioDuration(note.durationMilliseconds)} · Captured {new Date(note.capturedAt).toLocaleString()} · {note.author.displayName} · Ready</p></div>}
      {(mode === "preview" || mode === "viewer") && <><label htmlFor="report-audio-caption">Caption <small>(optional)</small></label>
        <textarea id="report-audio-caption" rows={3} maxLength={REPORT_AUDIO_CAPTION_MAX_CHARACTERS} value={caption}
          aria-invalid={Boolean(validation.error || error)} aria-describedby="report-audio-caption-count report-audio-error"
          onChange={(event) => { setCaption(event.target.value); setError(null); }} />
        <small id="report-audio-caption-count">{validation.characterCount.toLocaleString()} / {REPORT_AUDIO_CAPTION_MAX_CHARACTERS.toLocaleString()} characters</small></>}
      <p id="report-audio-error" className="finish-help" role={validation.error || error ? "alert" : undefined}>{validation.error ?? error}</p>
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
