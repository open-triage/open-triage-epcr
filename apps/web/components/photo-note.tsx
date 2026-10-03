"use client";
import { DialogCancelButton, DialogRemoveButton } from "./documentation-dialog-buttons";
import React from "react";
import { PlatformRequestError } from "../app/platform-errors";

import { resolveErrorMessage, resolveMessage, type AgencyLanguage } from "../app/localization";

import { useAgencyTimeZone } from "../app/agency-time-zone";

import type { CreateReportPhotoNoteCommand, ReportMediaPolicy, ReportPhotoNote } from "@open-triage/contracts";
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
import {
  protectedPhotoBlob,
  protectedPhotoEntries,
  protectedPhotoPreview,
  protectedStorageActive,
  removeProtectedPhoto,
  removeProtectedPhotoPreview,
  stageProtectedPhoto,
  stageProtectedPhotoPreview,
  updateProtectedPhotoPreview,
  updateProtectedPhoto,
} from "../app/protected-clinical-storage";
import { browserMediaCapturePreflight, mediaCaptureErrorMessage } from "../app/media-capture-capability";

export function AuthorizedPhotoImage({ reportId, noteId, alt, className, language = "en", contentPath }: {
  readonly reportId: string; readonly noteId: string; readonly alt: string; readonly className?: string; readonly language?: AgencyLanguage;
  readonly contentPath?: string;
}) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const local = contentPath ? null : protectedPhotoBlob(reportId, noteId);
    void (local ? Promise.resolve(local) : fetchReportPhoto(reportId, noteId, contentPath)).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [noteId, reportId, contentPath]);
  if (failed) return <span className="photo-unavailable" role="img" aria-label={t("noteUi.photoUnavailableNamed", { alt })}>{t("noteUi.photoUnavailableLabel")}</span>;
  if (!source) return <span className="photo-loading" role="status">{t("noteUi.loading.photo")}</span>;
  // Canonical bytes are fetched with the authorized session and retained only in an object URL for this mount.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={source} alt={alt} />;
}

type Capture = { blob: Blob; previewUrl: string; quarterTurns: number; capturedAt: string; capturedUtcOffsetMinutes: number };

function RotateCameraIcon({ clockwise }: { readonly clockwise: boolean }) {
  return <svg className={clockwise ? "rotate-camera-icon clockwise" : "rotate-camera-icon"} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 8a8 8 0 1 1-1 7" />
    <path d="M5 3v5h5" />
  </svg>;
}

function blobBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  });
}

export function PhotoNoteDialog({
  dialogRef, reportId, note, csrfToken, revision, mediaPolicy, author, language = "en", onClose, onSaved, onQueued, onDeleted, onSessionEnded,
}: {
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly reportId: string;
  readonly note: ReportPhotoNote | null;
  readonly csrfToken: string;
  readonly revision: number;
  readonly mediaPolicy: ReportMediaPolicy;
  readonly author: ReportPhotoNote["author"];
  readonly language?: AgencyLanguage;
  readonly onClose: () => void;
  readonly onSaved: (note: ReportPhotoNote, revision: number) => void;
  readonly onQueued: (note: ReportPhotoNote) => void;
  readonly onDeleted: (noteId: string, revision: number) => void;
  readonly onSessionEnded: () => void;
}) {
  const zone = useAgencyTimeZone();
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const keepAfterDelete = useRef<HTMLButtonElement>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [cameraQuarterTurns, setCameraQuarterTurns] = useState(0);
  const [caption, setCaption] = useState(note?.caption ?? "");
  const [deviceIds, setDeviceIds] = useState<ReadonlyArray<string>>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mode, setMode] = useState<"camera" | "preview" | "viewer">(note ? "viewer" : "camera");
  const validation = normalizePhotoCaption(caption, language);
  const selectedDeviceId = deviceIds[deviceIndex];
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
    const preview = protectedPhotoPreview(reportId);
    if (!preview) return;
    const bytes = Uint8Array.from(atob(preview.sourceBase64), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: preview.contentType });
    queueMicrotask(() => {
      setCapture({ blob, previewUrl: URL.createObjectURL(blob), quarterTurns: preview.quarterTurns,
        capturedAt: preview.capturedAt, capturedUtcOffsetMinutes: preview.capturedUtcOffsetMinutes });
      setCaption(preview.caption);
      setMode("preview");
    });
  }, [note, reportId]);

  useEffect(() => () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (mode !== "camera") return;
    let active = true;
    async function startCamera() {
      stream.current?.getTracks().forEach((track) => track.stop());
      const unavailable = browserMediaCapturePreflight("camera", undefined, language);
      if (unavailable) { setCameraError(unavailable); return; }
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
      } catch (error) { setCameraError(mediaCaptureErrorMessage("camera", error, language)); }
    }
    void startCamera();
    return () => { active = false; stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; };
  }, [mode, selectedDeviceId, language]);

  async function takePhoto() {
    if (!video.current) return;
    try {
      const blob = await captureVideoFrame(video.current);
      stream.current?.getTracks().forEach((track) => track.stop());
      const capturedAt = new Date().toISOString();
      const capturedUtcOffsetMinutes = -new Date().getTimezoneOffset();
      await stageProtectedPhotoPreview(reportId, { sourceBase64: await blobBase64(blob), contentType: "image/png",
        capturedAt, capturedUtcOffsetMinutes, quarterTurns: cameraQuarterTurns, caption });
      setCapture({ blob, previewUrl: URL.createObjectURL(blob), quarterTurns: cameraQuarterTurns, capturedAt, capturedUtcOffsetMinutes });
      setMode("preview");
    } catch (error) { setCameraError(resolveErrorMessage(language, error instanceof Error ? error.message : null, "noteUi.the.frame.could.not.be.captured")); }
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapture(null);
    setMode("camera");
    void removeProtectedPhotoPreview(reportId);
  }

  async function save() {
    if (saving || validation.error) return;
    setSaving(true);
    setCameraError(null);
    try {
      if (note) {
        if (note.persistenceState !== "ready") {
          await updateProtectedPhoto(reportId, note.id, (entry) => ({ ...entry,
            command: { ...entry.command, caption: validation.caption },
            note: { ...entry.note, caption: validation.caption, updatedAt: new Date().toISOString() },
          }));
          onQueued({ ...note, caption: validation.caption, updatedAt: new Date().toISOString() });
          return;
        }
        const response = await updateReportPhotoCaption(csrfToken, reportId, note.id, {
          commandId: crypto.randomUUID(), expectedRevision: revision, caption: validation.caption,
        });
        if (protectedPhotoEntries(reportId).some(({ note: candidate }) => candidate.id === note.id)) {
          await updateProtectedPhoto(reportId, note.id, (entry) => ({ ...entry, note: response.note }));
        }
        onSaved(response.note, response.revision);
      } else {
        if (!capture) return;
        const canonical = await normalizeCapturedPhoto(capture.blob, capture.quarterTurns);
        if (canonical.blob.size > mediaPolicy.imageMediaLimitBytes) {
          throw new Error(t("noteUi.imageLimit", { limit: Math.round(mediaPolicy.imageMediaLimitBytes / 1024 / 1024) }));
        }
        const command: CreateReportPhotoNoteCommand = {
          commandId: crypto.randomUUID(), expectedRevision: revision, noteId: crypto.randomUUID(),
          capturedAt: capture.capturedAt, capturedUtcOffsetMinutes: capture.capturedUtcOffsetMinutes,
          caption: validation.caption, contentType: "image/jpeg", canonicalBase64: canonical.canonicalBase64,
          sha256: canonical.sha256, width: canonical.width, height: canonical.height,
          settingsRevision: mediaPolicy.settingsRevision,
          effectiveAllowanceBytes: mediaPolicy.reportMediaAllowanceBytes,
          effectiveImageLimitBytes: mediaPolicy.imageMediaLimitBytes,
        };
        if (protectedStorageActive(reportId)) {
          const localNote: ReportPhotoNote = {
            id: command.noteId, reportId, type: "photo", caption: validation.caption,
            capturedAt: command.capturedAt, capturedUtcOffsetMinutes: command.capturedUtcOffsetMinutes,
            author, serverReceivedAt: command.capturedAt, updatedAt: command.capturedAt,
            persistenceState: "saved-on-device", contentType: "image/jpeg",
            byteSize: canonical.blob.size, sha256: canonical.sha256, width: canonical.width, height: canonical.height,
          };
          await stageProtectedPhoto(reportId, { note: localNote, command });
          await removeProtectedPhotoPreview(reportId);
          onQueued(localNote);
        } else {
          const response = await createReportPhotoNote(csrfToken, reportId, command);
          onSaved(response.note, response.revision);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "session") onSessionEnded();
      else setCameraError(error instanceof PlatformRequestError ? error.message : resolveErrorMessage(language, error instanceof Error ? error.message : null, "noteUi.the.photo.could.not.be.saved"));
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!note || saving) return;
    setSaving(true);
    try {
      if (note.persistenceState !== "ready") {
        const entry = protectedPhotoEntries(reportId).find(({ note: candidate }) => candidate.id === note.id);
        if (entry && !entry.attempted) {
          await removeProtectedPhoto(reportId, note.id);
          onDeleted(note.id, revision);
          return;
        }
      }
      // An attempted upload may have failed or committed without a response.
      // Delete its stable identity directly; the server tombstone prevents late revival.
      const response = await deleteReportPhotoNote(csrfToken, reportId, note.id, {
        commandId: crypto.randomUUID(), expectedRevision: revision,
      });
      await removeProtectedPhoto(reportId, note.id);
      onDeleted(note.id, response.revision);
    } catch (error) {
      if (error instanceof Error && error.message === "session") onSessionEnded();
      else setCameraError(error instanceof PlatformRequestError ? error.message : resolveErrorMessage(language, error instanceof Error ? error.message : null, "noteUi.the.photo.could.not.be.deleted"));
      setConfirmingDelete(false);
    } finally { setSaving(false); }
  }

  async function retry() {
    if (!note || note.persistenceState !== "failed") return;
    await updateProtectedPhoto(reportId, note.id, (entry) => ({ ...entry,
      ...(entry.failure === "server-conflict" ? {
        attempted: false, command: { ...entry.command, commandId: crypto.randomUUID(), expectedRevision: revision },
      } : {}),
      failure: undefined, note: { ...entry.note, persistenceState: "saved-on-device" } }));
    onQueued({ ...note, persistenceState: "saved-on-device" });
    onClose();
  }

  return <div className="dialog-backdrop" role="presentation">
    <section ref={dialogRef} className="note-dialog photo-note-dialog" role={confirmingDelete ? "alertdialog" : "dialog"}
      aria-modal="true" aria-labelledby="photo-dialog-title" aria-describedby={confirmingDelete ? "photo-delete-description" : undefined}
      onKeyDownCapture={(event) => { if (confirmingDelete && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelDelete(); } }}>
      <div className="note-dialog-heading">
        <div><p className="eyebrow">{note ? t("noteUi.photoState", { state: t(`noteUi.state.${note.persistenceState}`) }) : mode === "camera" ? t("noteUi.live.camera") : t("noteUi.review.captured.photo")}</p>
          <h2 id="photo-dialog-title">{t("noteUi.photo.note")}</h2></div>
        {note && !confirmingDelete && <DialogRemoveButton language={language} ref={deleteTrigger} onClick={() => setConfirmingDelete(true)} />}
      </div>
      {confirmingDelete ? <>
        <p id="photo-delete-description">{t("noteUi.delete.this.photo.and.its.caption.from.the.draft.report.saved.bytes.cannot.be.recover")}</p>
        <div className="note-dialog-actions"><DialogCancelButton language={language} ref={keepAfterDelete} data-dialog-initial-focus onClick={cancelDelete} />
          <button className="remove-entry-button" type="button" disabled={saving} onClick={() => void remove()}>{saving ? t("noteUi.deleting") : t("noteUi.delete.photo")}</button></div>
      </> : <>
        {mode === "camera" && <div className="camera-stage">
          <div className="camera-live-frame">
            <video ref={video} autoPlay muted playsInline aria-label={t("noteUi.live.camera.preview")}
              style={{ transform: `rotate(${cameraQuarterTurns * 90}deg)` }} />
          </div>
          {cameraError && <p className="finish-help" role="alert">{cameraError}</p>}
          <div className="camera-actions">
            <div className="camera-control-row">
              <button className="camera-rotate-button" type="button" aria-label={t("noteUi.rotate.counterclockwise.90")} title={t("noteUi.rotate.counterclockwise")}
                onClick={() => setCameraQuarterTurns((value) => value - 1)}><RotateCameraIcon clockwise={false} /></button>
              <button className="camera-cycle-button" type="button" aria-label={t("noteUi.cycle.camera")} disabled={deviceIds.length <= 1}
                onClick={() => setDeviceIndex((index) => (index + 1) % deviceIds.length)}>{t("noteUi.cycle.camera")}</button>
              <button className="camera-rotate-button" type="button" aria-label={t("noteUi.rotate.clockwise.90")} title={t("noteUi.rotate.clockwise")}
                onClick={() => setCameraQuarterTurns((value) => value + 1)}><RotateCameraIcon clockwise /></button>
            </div>
            <div className="camera-capture-row">
              <button className="camera-capture-button" data-dialog-initial-focus type="button" disabled={Boolean(cameraError)}
                onClick={() => void takePhoto()}><span className="photo-action-icon" aria-hidden="true" />{t("noteUi.take.photo")}</button>
            </div>
          </div>
        </div>}
        {mode === "preview" && capture && <>
          <div className="photo-preview-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capture.previewUrl} alt={t("noteUi.captured.photo.preview")} style={{ transform: `rotate(${capture.quarterTurns * 90}deg)` }} />
          </div>
        </>}
        {mode === "viewer" && note && <>
          <AuthorizedPhotoImage reportId={reportId} noteId={note.id} language={language} alt={note.caption || t("noteUi.clinical.photo.note")} className="photo-viewer-image" />
          <p className="note-metadata">Captured {new Date(note.capturedAt).toLocaleString(undefined, zone ? { timeZone: zone } : undefined)} · {note.author.displayName} · {note.persistenceState === "saved-on-device" ? "Saved on this device" : note.persistenceState[0]!.toUpperCase() + note.persistenceState.slice(1)}</p>
          {note.persistenceState === "failed" && <button type="button" onClick={() => void retry()}>{t("noteUi.retry.upload")}</button>}
        </>}
        {mode !== "camera" && <>
          <label htmlFor="report-photo-caption">{t("noteUi.caption")} <small>{t("noteUi.optional")}</small></label>
          <textarea id="report-photo-caption" rows={3} maxLength={REPORT_PHOTO_CAPTION_MAX_CHARACTERS}
            value={caption} aria-invalid={Boolean(validation.error || cameraError)} aria-describedby="report-photo-caption-count report-photo-error"
            onChange={(event) => { const value = event.target.value; setCaption(value); setCameraError(null);
              if (capture && protectedStorageActive(reportId)) updateProtectedPhotoPreview(reportId, { caption: value }); }} />
          <small id="report-photo-caption-count">{t("noteUi.captionCount", { count: validation.characterCount.toLocaleString(language === "sv" ? "sv-SE" : "en-US"), max: REPORT_PHOTO_CAPTION_MAX_CHARACTERS.toLocaleString(language === "sv" ? "sv-SE" : "en-US") })}</small>
          <p id="report-photo-error" className="finish-help" role={validation.error || cameraError ? "alert" : undefined}>{validation.error ?? cameraError}</p>
        </>}
        <div className="note-dialog-actions">
          <DialogCancelButton language={language} disabled={saving} onClick={onClose} />
          {mode === "preview" && <button className="button-danger" type="button" disabled={saving} onClick={discard}>{t("noteUi.discard.retake")}</button>}
          {mode !== "camera" && <button className="button-primary" type="button" disabled={saving || Boolean(validation.error)} onClick={() => void save()}>{saving ? t("noteUi.saving") : note ? t("noteUi.save.caption") : t("noteUi.use.photo")}</button>}
        </div>
      </>}
    </section>
  </div>;
}
