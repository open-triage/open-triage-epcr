"use client";

import type { ReportPhotoNote } from "@open-triage/contracts";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createReportPhotoNote,
  deleteReportPhotoNote,
  fetchReportPhoto,
  updateReportPhotoCaption,
} from "../app/report-photo-api";
import {
  cameraRequestConstraints,
  captureVideoFrame,
  normalizeCapturedPhoto,
  normalizePhotoCaption,
  REPORT_PHOTO_CAPTION_MAX_CHARACTERS,
} from "../app/report-photo-notes";

export function AuthorizedPhotoImage({ reportId, noteId, alt, className }: {
  readonly reportId: string; readonly noteId: string; readonly alt: string; readonly className?: string;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void fetchReportPhoto(reportId, noteId).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [noteId, reportId]);
  if (failed) return <span className="photo-unavailable" role="img" aria-label={`${alt} unavailable`}>Photo unavailable</span>;
  if (!source) return <span className="photo-loading" role="status">Loading photo…</span>;
  // Canonical bytes are fetched with the authorized session and retained only in an object URL for this mount.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={source} alt={alt} />;
}

type Capture = { blob: Blob; previewUrl: string; quarterTurns: number; capturedAt: string; capturedUtcOffsetMinutes: number };

export function PhotoNoteDialog({
  dialogRef, reportId, note, csrfToken, revision, onClose, onSaved, onDeleted, onSessionEnded,
}: {
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly reportId: string;
  readonly note: ReportPhotoNote | null;
  readonly csrfToken: string;
  readonly revision: number;
  readonly onClose: () => void;
  readonly onSaved: (note: ReportPhotoNote, revision: number) => void;
  readonly onDeleted: (noteId: string, revision: number) => void;
  readonly onSessionEnded: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [caption, setCaption] = useState(note?.caption ?? "");
  const [deviceIds, setDeviceIds] = useState<ReadonlyArray<string>>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mode, setMode] = useState<"camera" | "preview" | "viewer">(note ? "viewer" : "camera");
  const validation = normalizePhotoCaption(caption);
  const selectedDeviceId = deviceIds[deviceIndex];
  const previewUrl = capture?.previewUrl;

  useEffect(() => () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (mode !== "camera") return;
    let active = true;
    async function startCamera() {
      stream.current?.getTracks().forEach((track) => track.stop());
      try {
        const next = await navigator.mediaDevices.getUserMedia(cameraRequestConstraints(selectedDeviceId));
        if (!active) { next.getTracks().forEach((track) => track.stop()); return; }
        stream.current = next;
        if (video.current) { video.current.srcObject = next; await video.current.play(); }
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(({ kind }) => kind === "videoinput");
        const ids = cameras.map(({ deviceId }) => deviceId).filter(Boolean);
        const activeDeviceId = next.getVideoTracks()[0]?.getSettings().deviceId;
        setDeviceIds(ids);
        setDeviceIndex(Math.max(0, ids.indexOf(activeDeviceId ?? "")));
        setCameraError(null);
      } catch (error) {
        setCameraError(error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission is required to add a photo note."
          : "The live camera is unavailable. Check the camera and try again.");
      }
    }
    void startCamera();
    return () => { active = false; stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; };
  }, [mode, selectedDeviceId]);

  async function takePhoto() {
    if (!video.current) return;
    try {
      const blob = await captureVideoFrame(video.current);
      stream.current?.getTracks().forEach((track) => track.stop());
      setCapture({ blob, previewUrl: URL.createObjectURL(blob), quarterTurns: 0, capturedAt: new Date().toISOString(), capturedUtcOffsetMinutes: -new Date().getTimezoneOffset() });
      setMode("preview");
    } catch (error) { setCameraError(error instanceof Error ? error.message : "The frame could not be captured."); }
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapture(null);
    setMode("camera");
  }

  async function save() {
    if (saving || validation.error) return;
    setSaving(true);
    setCameraError(null);
    try {
      if (note) {
        const response = await updateReportPhotoCaption(csrfToken, reportId, note.id, {
          commandId: crypto.randomUUID(), expectedRevision: revision, caption: validation.caption,
        });
        onSaved(response.note, response.revision);
      } else {
        if (!capture) return;
        const canonical = await normalizeCapturedPhoto(capture.blob, capture.quarterTurns);
        const response = await createReportPhotoNote(csrfToken, reportId, {
          commandId: crypto.randomUUID(), expectedRevision: revision, noteId: crypto.randomUUID(),
          capturedAt: capture.capturedAt, capturedUtcOffsetMinutes: capture.capturedUtcOffsetMinutes,
          caption: validation.caption, contentType: "image/jpeg", canonicalBase64: canonical.canonicalBase64,
          sha256: canonical.sha256, width: canonical.width, height: canonical.height,
        });
        onSaved(response.note, response.revision);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "session") onSessionEnded();
      else setCameraError(error instanceof Error ? error.message : "The photo could not be saved.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!note || saving) return;
    setSaving(true);
    try {
      const response = await deleteReportPhotoNote(csrfToken, reportId, note.id, {
        commandId: crypto.randomUUID(), expectedRevision: revision,
      });
      onDeleted(note.id, response.revision);
    } catch (error) {
      if (error instanceof Error && error.message === "session") onSessionEnded();
      else setCameraError(error instanceof Error ? error.message : "The photo could not be deleted.");
      setConfirmingDelete(false);
    } finally { setSaving(false); }
  }

  return <div className="dialog-backdrop" role="presentation">
    <section ref={dialogRef} className="note-dialog photo-note-dialog" role={confirmingDelete ? "alertdialog" : "dialog"}
      aria-modal="true" aria-labelledby="photo-dialog-title" aria-describedby={confirmingDelete ? "photo-delete-description" : undefined}>
      <div className="note-dialog-heading">
        <div><p className="eyebrow">{note ? "Ready photo note" : mode === "camera" ? "Live camera" : "Review captured photo"}</p>
          <h2 id="photo-dialog-title">Photo note</h2></div>
        {note && !confirmingDelete && <button className="remove-entry-button" type="button" onClick={() => setConfirmingDelete(true)}>Delete photo</button>}
      </div>
      {confirmingDelete ? <>
        <p id="photo-delete-description">Delete this photo and its caption from the draft report? Saved bytes cannot be recovered or replaced.</p>
        <div className="note-dialog-actions"><button data-dialog-initial-focus type="button" onClick={() => setConfirmingDelete(false)}>Keep photo</button>
          <button className="remove-entry-button" type="button" disabled={saving} onClick={() => void remove()}>{saving ? "Deleting…" : "Delete photo"}</button></div>
      </> : <>
        {mode === "camera" && <div className="camera-stage">
          <video ref={video} autoPlay muted playsInline aria-label="Live camera preview" />
          {cameraError && <p className="finish-help" role="alert">{cameraError}</p>}
          <div className="camera-actions">
            {deviceIds.length > 1 && <button type="button" onClick={() => setDeviceIndex((index) => (index + 1) % deviceIds.length)}>Cycle camera</button>}
            <button data-dialog-initial-focus type="button" disabled={Boolean(cameraError)} onClick={() => void takePhoto()}>Take photo</button>
          </div>
          <p className="camera-help">Live camera only. Photos on this device are never offered for selection.</p>
        </div>}
        {mode === "preview" && capture && <>
          <div className="photo-preview-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capture.previewUrl} alt="Captured photo preview" style={{ transform: `rotate(${capture.quarterTurns * 90}deg)` }} />
          </div>
          <div className="rotation-actions" aria-label="Photo orientation">
            <button type="button" onClick={() => setCapture((value) => value && ({ ...value, quarterTurns: value.quarterTurns - 1 }))}>Rotate counterclockwise 90°</button>
            <button type="button" onClick={() => setCapture((value) => value && ({ ...value, quarterTurns: value.quarterTurns + 1 }))}>Rotate clockwise 90°</button>
          </div>
        </>}
        {mode === "viewer" && note && <>
          <AuthorizedPhotoImage reportId={reportId} noteId={note.id} alt={note.caption || "Clinical photo note"} className="photo-viewer-image" />
          <p className="note-metadata">Captured {new Date(note.capturedAt).toLocaleString()} · {note.author.displayName} · Ready</p>
        </>}
        {mode !== "camera" && <>
          <label htmlFor="report-photo-caption">Caption <small>(optional)</small></label>
          <textarea id="report-photo-caption" rows={3} maxLength={REPORT_PHOTO_CAPTION_MAX_CHARACTERS}
            value={caption} aria-invalid={Boolean(validation.error || cameraError)} aria-describedby="report-photo-caption-count report-photo-error"
            onChange={(event) => { setCaption(event.target.value); setCameraError(null); }} />
          <small id="report-photo-caption-count">{validation.characterCount.toLocaleString()} / {REPORT_PHOTO_CAPTION_MAX_CHARACTERS.toLocaleString()} characters</small>
          <p id="report-photo-error" className="finish-help" role={validation.error || cameraError ? "alert" : undefined}>{validation.error ?? cameraError}</p>
        </>}
        <div className="note-dialog-actions">
          {mode === "preview" ? <button type="button" disabled={saving} onClick={discard}>Discard &amp; retake</button> : <button type="button" disabled={saving} onClick={onClose}>Close</button>}
          {mode !== "camera" && <button type="button" disabled={saving || Boolean(validation.error)} onClick={() => void save()}>{saving ? "Saving…" : note ? "Save caption" : "Use photo"}</button>}
        </div>
      </>}
    </section>
  </div>;
}
