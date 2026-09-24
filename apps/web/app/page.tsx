"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SyntheticEvent } from "react";
import { MedicationDialog } from "../components/medication-dialog";
import { ProcedureDialog } from "../components/procedure-dialog";
import { QuickActionIcon } from "../components/quick-action-icon";
import { StationaryRecord } from "../components/stationary-record";
import { TimePicker } from "../components/time-picker";
import { DialogValidationMessage } from "../components/dialog-validation-message";
import type { QuickActionId } from "./encounter-definition";
import {
  INITIAL_SHELL_STATE,
  MISSING_VITALS_FINDING_ID,
  reviewEncounter,
  standardEncounterReducer,
  type EncounterEvent,
  type ReviewFinding,
  type ShellView,
  type VitalField,
  bundledEncounterDefinition,
} from "./standard-encounter";
import { nullOptionsFor, validateVitals } from "./vital-validation";
import { localClinicalDate } from "./time-picker";
import { documentTimeline, incidentSummary } from "./incident-document";
import { encounterEvents } from "./canonical-events";
import { ClinicianSessionGate } from "../components/clinician-session-gate";
import {
  createReportTextNote,
  deleteReportTextNote,
  DraftSaveRejectedError,
  signDraftReport,
  type ActiveDraftReport,
  dispatchCancellationNotice,
  updateReportTextNote,
} from "./draft-report";
import { DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES, type ClinicianSession, type DispatchConflict, type DispatchConflictDisposition, type EncounterValue, type ReportAudioNote, type ReportNote, type ReportPhotoNote, type ReportTextNote } from "@open-triage/contracts";
import { sessionRequestToken } from "./clinician-session";
import { advanceCachedReportRevision, nextDraftChange } from "./offline-reports";
import type { PresentationMode } from "./presentation-mode";
import { useReportWorkspace } from "./report-workspace";
import { DEMO_CLEAR_EVENT, DEMO_POPULATE_EVENT } from "./demo-provenance";
import { stationarySectionForGroup } from "./stationary-record";
import { actionableStationaryFindings, stationaryReviewFindings, validateStationaryRecord, type StationaryValidationFinding } from "./stationary-validation";
import { stationarySigningBlockers } from "./stationary-signing";
import { repeatingDialogPath } from "./stationary-repeating-group";
import { canUseClinicalDemoDraftActions } from "./clinical-demo";
import { browserRequestConfiguration } from "./browser-api";
import { hasPendingProtectedMedia, holdProtectedReportForCompletion, protectedPhotoEntries, subscribeProtectedPhotos, updateProtectedPhoto } from "./protected-clinical-storage";
import { completeReportTimeline, REPORT_TEXT_NOTE_MAX_CHARACTERS, validateReportTextNote } from "./report-text-notes";
import { EncounterTimeline } from "../components/encounter-timeline";
import { loadStationaryTimelineOpen, storeStationaryTimelineOpen } from "./stationary-timeline-preference";
import { PhotoNoteDialog } from "../components/photo-note";
import { AudioNoteDialog, stopActiveAudio } from "../components/audio-note";
import { createReportPhotoNote, fetchReportPhoto } from "./report-photo-api";

type SigningFinding = ReviewFinding | StationaryValidationFinding;
type TextNoteDraft = {
  readonly id: string;
  readonly capturedAt: string;
  readonly capturedUtcOffsetMinutes: number;
  readonly content: string;
  readonly author?: ReportTextNote["author"];
  readonly persistenceState?: ReportTextNote["persistenceState"];
  readonly isNew: boolean;
};

const tabs: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "checklist", label: "Checklist" },
];

const quickActionText = {
  vitals: "Vitals",
  medication: "Medications",
  procedure: "Procedures",
} as const;
const structuredQuickActions = ["vitals", "medication", "procedure"] as const;

function mergeProtectedPhotos(notes: ReadonlyArray<ReportNote>, reportId: string): ReadonlyArray<ReportNote> {
  const local = protectedPhotoEntries(reportId).map(({ note }) => note);
  const localIds = new Set(local.map(({ id }) => id));
  return [...local, ...notes.filter(({ id }) => !localIds.has(id))]
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt) || right.id.localeCompare(left.id));
}

function localClinicalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function validationTimestampFor(document: unknown, clinicalForm: unknown): string {
  void document;
  void clinicalForm;
  return new Date().toISOString();
}

function EncounterWorkspace({ session, report, presentationMode, onSaveAndClose, onReportCompleted, onSessionEnded, onErrorStateChange }: {
  readonly session: ClinicianSession;
  readonly report: ActiveDraftReport | null;
  readonly presentationMode: PresentationMode;
  readonly onSaveAndClose: () => void;
  readonly onReportCompleted: () => void;
  readonly onSessionEnded: () => void;
  readonly onErrorStateChange: (hasErrors: boolean) => void;
}) {
  const [shell, dispatch] = useReducer(standardEncounterReducer, INITIAL_SHELL_STATE);
  const [procedureSearch, setProcedureSearch] = useState("");
  const [openNullField, setOpenNullField] = useState<VitalField | null>(null);
  const [editingFinding, setEditingFinding] = useState<SigningFinding | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const [reportNotes, setReportNotes] = useState<ReadonlyArray<ReportNote>>(report?.notes ?? []);
  const [textNoteDraft, setTextNoteDraft] = useState<TextNoteDraft | null>(null);
  const [photoDialog, setPhotoDialog] = useState<ReportPhotoNote | "new" | null>(null);
  const [photoExpectedRevision, setPhotoExpectedRevision] = useState(0);
  const [audioDialog, setAudioDialog] = useState<ReportAudioNote | "new" | null>(null);
  const [audioExpectedRevision, setAudioExpectedRevision] = useState(0);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [confirmingNoteDelete, setConfirmingNoteDelete] = useState(false);
  const [noteStatusMessage, setNoteStatusMessage] = useState<string | null>(null);
  const [stationaryTimelineOpen, setStationaryTimelineOpen] = useState(false);
  const noteSummary = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const timelineToggle = useRef<HTMLButtonElement>(null);
  const photoUploadActive = useRef(false);
  const [photoQueueVersion, setPhotoQueueVersion] = useState(0);
  const encounter = shell.encounter;
  const incident = useMemo(() => incidentSummary(encounter.document), [encounter.document]);
  const incidentEvents = useMemo(
    () => documentTimeline(encounter.document, report?.agencyTimeZone),
    [encounter.document, report?.agencyTimeZone],
  );
  const clinicalEvents = useMemo(() => encounterEvents(encounter.document, bundledEncounterDefinition), [encounter.document]);
  const timelineEvents = useMemo(() => completeReportTimeline(
    [...incidentEvents, ...clinicalEvents], reportNotes, report?.agencyTimeZone,
  ), [incidentEvents, clinicalEvents, report?.agencyTimeZone, reportNotes]);
  const noteDefinition = bundledEncounterDefinition.events.note;
  const procedureDefinition = bundledEncounterDefinition.events.procedure;
  const medicationDefinition = bundledEncounterDefinition.events.medication;
  const vitalDefinition = bundledEncounterDefinition.events.vitals;
  const reviewFindings = useMemo(() => reviewEncounter(shell), [shell]);
  const validationEvaluationTimestamp = useMemo(() => validationTimestampFor(encounter.document, report?.clinicalForm),
    [encounter.document, report?.clinicalForm]);
  const stationaryFindings = useMemo(() => validateStationaryRecord(encounter.document, report?.clinicalForm,
    validationEvaluationTimestamp), [encounter.document, report?.clinicalForm, validationEvaluationTimestamp]);
  const configuredStationaryFindings: ReadonlyArray<SigningFinding> = useMemo(
    () => [...stationaryFindings.map((finding) => ({ ...finding,
      acknowledged: finding.severity === "warning" && shell.acknowledgedWarnings.includes(finding.id),
    })), ...stationaryReviewFindings(reviewFindings, report?.clinicalForm)],
    [report?.clinicalForm, reviewFindings, shell.acknowledgedWarnings, stationaryFindings],
  );
  const stationarySectionFindings = useMemo(() => configuredStationaryFindings.flatMap((finding) =>
    finding.severity === "information" ? [] : [{ severity: finding.severity, target: finding.target }]),
  [configuredStationaryFindings]);
  const activeFindings: ReadonlyArray<SigningFinding> = presentationMode === "stationary" ? configuredStationaryFindings : reviewFindings;
  const reviewErrors = activeFindings.filter((finding) => finding.severity === "error");
  const reviewWarnings = activeFindings.filter((finding) => finding.severity === "warning");
  const {
    restored, recoveryNotice, recoveryNoticeHeading, bestEffortNoticeInDemoBanner, syncStatus, revision: revisionRef, dispatchConflicts, dispatchCancellation,
    conflictError, editingBlocked, mediaPolicy, flushSave, completeReport: completeWorkspaceReport, resolveConflict,
  } = useReportWorkspace({
    session, report, presentationMode, shell, dispatch,
    validationErrorCount: reviewErrors.length, online,
    onSessionEnded,
    onReportCompleted,
    onNotesChange: (notes) => setReportNotes(report ? mergeProtectedPhotos(notes, report.id) : notes),
  });
  useEffect(() => subscribeProtectedPhotos((reportId) => {
    if (reportId !== report?.id) return;
    setPhotoQueueVersion((version) => version + 1);
    setReportNotes((notes) => mergeProtectedPhotos(notes, reportId));
  }), [report]);
  useEffect(() => {
    queueMicrotask(() => {
      setPhotoDialog(null);
      setAudioDialog(null);
      stopActiveAudio();
      setReportNotes(report ? mergeProtectedPhotos(report.notes ?? [], report.id) : []);
      setTextNoteDraft(null);
    });
  }, [report]);

  useEffect(() => {
    if (!report || !restored || !online || photoUploadActive.current) return;
    const pending = protectedPhotoEntries(report.id).some(({ note }) => note.persistenceState === "saved-on-device");
    if (!pending) return;
    let active = true;
    photoUploadActive.current = true;
    void (async () => {
      try {
        await flushSave();
        while (active && navigator.onLine) {
          const entry = protectedPhotoEntries(report.id).find(({ note }) => note.persistenceState === "saved-on-device");
          if (!entry) break;
          const attemptCommand = entry.attempted ? entry.command : {
            ...entry.command, expectedRevision: revisionRef.current,
          };
          await updateProtectedPhoto(report.id, entry.note.id, (current) => ({ ...current,
            command: attemptCommand, attempted: true,
            note: { ...current.note, persistenceState: "uploading" }, failure: undefined }));
          try {
            const response = await createReportPhotoNote(sessionRequestToken(session), report.id, attemptCommand);
            revisionRef.current = response.revision;
            advanceCachedReportRevision(window.localStorage, report.id, response.revision);
            await updateProtectedPhoto(report.id, entry.note.id, (current) => ({ ...current,
              serverRevision: response.revision, note: { ...response.note, persistenceState: "processing" } }));
            const verified = await fetchReportPhoto(report.id, entry.note.id);
            const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await verified.arrayBuffer()))]
              .map((byte) => byte.toString(16).padStart(2, "0")).join("");
            if (verified.type !== "image/jpeg" || verified.size !== response.note.byteSize || digest !== response.note.sha256) {
              throw new Error("The server copy could not be verified.");
            }
            await updateProtectedPhoto(report.id, entry.note.id, (current) => ({ ...current,
              note: { ...response.note, persistenceState: "ready" }, failure: undefined }));
            setReportNotes((notes) => mergeProtectedPhotos([response.note, ...notes.filter(({ id }) => id !== response.note.id)], report.id));
          } catch (error) {
            const message = error instanceof Error ? error.message : "The photo upload failed.";
            const resumable = message === "session" || !navigator.onLine || message.includes("connection") || message.includes("could not be opened");
            await updateProtectedPhoto(report.id, entry.note.id, (current) => ({ ...current, failure: message,
              note: { ...current.note, persistenceState: resumable ? "saved-on-device" : "failed" } }));
            if (message === "session") onSessionEnded();
            break;
          }
        }
      } finally { photoUploadActive.current = false; }
    })();
    return () => { active = false; };
  }, [flushSave, onSessionEnded, online, photoQueueVersion, report, restored, revisionRef, session]);
  useEffect(() => {
    queueMicrotask(() => setStationaryTimelineOpen(loadStationaryTimelineOpen(window.localStorage, session.user.id)));
  }, [session.user.id]);
  useEffect(() => {
    onErrorStateChange(reviewErrors.length > 0 || Boolean((recoveryNotice && !bestEffortNoticeInDemoBanner) || signError || conflictError));
  }, [bestEffortNoticeInDemoBanner, conflictError, onErrorStateChange, recoveryNotice, reviewErrors.length, signError]);
  const validationClear = reviewErrors.length === 0 && reviewWarnings.length === 0;
  const eventValidationStatuses = useMemo(() => {
    const statuses = new Map<string, "warning" | "error">();
    for (const finding of reviewFindings) {
      if (finding.severity === "error" || !statuses.has(finding.target.eventId)) statuses.set(finding.target.eventId, finding.severity);
    }
    return statuses;
  }, [reviewFindings]);
  const unresolvedDispatchConflicts = dispatchConflicts.filter(({ disposition }) => disposition === null);
  const signingBlockers = stationarySigningBlockers({
    presentationMode, restored, online, syncStatus, errorCount: reviewErrors.length,
    warnings: reviewWarnings, unresolvedDispatchConflictCount: unresolvedDispatchConflicts.length,
  });
  const canFinish = signingBlockers.length === 0;
  const vitalDraftValidation = shell.vitalDraft ? validateVitals(shell.vitalDraft.time, shell.vitalDraft.values, bundledEncounterDefinition) : null;
  const editingVitalField = editingFinding && "vitalField" in editingFinding.target ? editingFinding.target.vitalField : undefined;
  const vitalFindingActive = !!(editingFinding?.category === vitalDefinition.labels.category && vitalDraftValidation && [...Object.values(vitalDraftValidation.errors), ...Object.values(vitalDraftValidation.warnings)].includes(editingFinding.message));
  const activeDialog = audioDialog ? "audio" : photoDialog ? "photo" : textNoteDraft ? "note" : shell.medicationDraft ? "medication" : shell.procedureDraft ? "procedure" : shell.vitalDraft ? "vitals" : null;
  const textNoteValidation = textNoteDraft ? validateReportTextNote(textNoteDraft.content) : null;
  const editingActionableFinding = editingFinding && editingFinding.severity !== "information"
    ? { severity: editingFinding.severity, message: editingFinding.message }
    : undefined;

  useEffect(() => {
    if (presentationMode === "mobile" && shell.view === "review") dispatch({ type: "view-selected", view: "timeline" });
  }, [presentationMode, shell.view]);

  useEffect(() => {
    const authorized = () => canUseClinicalDemoDraftActions(report) && navigator.onLine &&
      browserRequestConfiguration().mode === "server" && session.capabilities?.includes("clinical:demo") === true;
    const populate = () => { if (authorized()) dispatch({ type: "demo-populated" }); };
    const clear = () => { if (authorized()) dispatch({ type: "demo-cleared" }); };
    window.addEventListener(DEMO_POPULATE_EVENT, populate);
    window.addEventListener(DEMO_CLEAR_EVENT, clear);
    return () => {
      window.removeEventListener(DEMO_POPULATE_EVENT, populate);
      window.removeEventListener(DEMO_CLEAR_EVENT, clear);
    };
  }, [report, session.capabilities]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const closeActiveDialog = useCallback(() => {
    if (activeDialog === "audio") { setAudioDialog(null); setNoteError(null); stopActiveAudio(); }
    else if (activeDialog === "photo") { setPhotoDialog(null); setNoteError(null); }
    else if (activeDialog === "note") {
      setTextNoteDraft(null);
      setNoteError(null);
      setConfirmingNoteDelete(false);
    }
    else if (activeDialog === "medication") dispatch({ type: "medication-cancelled" });
    else if (activeDialog === "procedure") dispatch({ type: "procedure-cancelled" });
    else if (activeDialog === "vitals") {
      setOpenNullField(null);
      dispatch({ type: "vitals-cancelled" });
    }
  }, [activeDialog]);

  useEffect(() => {
    if (textNoteDraft) noteSummary.current?.focus();
  }, [textNoteDraft]);

  useEffect(() => {
    if (!activeDialog) {
      const trigger = returnFocus.current;
      if (trigger?.isConnected) trigger.focus();
      else if (presentationMode === "stationary" && stationaryTimelineOpen) timelineToggle.current?.focus();
      returnFocus.current = null;
      return;
    }

    returnFocus.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const target = (activeDialog === "vitals" && openNullField ? dialog.current?.querySelector<HTMLElement>(".null-value-menu button") : null)
        ?? dialog.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?? dialog.current?.querySelector<HTMLElement>("button, input, select, textarea");
      target?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingNoteDelete) {
          setConfirmingNoteDelete(false);
          return;
        }
        closeActiveDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const controls = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")]
        .filter((control) => control.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDialog, closeActiveDialog, confirmingNoteDelete, openNullField, presentationMode, stationaryTimelineOpen]);

  function rememberTrigger(element: HTMLElement) {
    returnFocus.current = element;
  }

  function navigateToStationaryFinding(finding: SigningFinding) {
    dispatch({ type: "view-selected", view: "timeline" });
    const target = finding.target;
    window.requestAnimationFrame(() => {
      const section = stationarySectionForGroup(target.groupId);
      if (section) document.getElementById(section.hash)?.scrollIntoView({ block: "start" });
      const escape = (value: string) => CSS.escape(value);
      const instanceId = "groupInstanceId" in target ? target.groupInstanceId : target.instanceId;
      const focusTarget = () => {
        const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog']");
        const group = document.querySelector<HTMLElement>(`[data-group-id="${escape(target.groupId)}"]`);
        const scope = dialogs.item(dialogs.length - 1) ?? group;
        const elementId = "fieldId" in target ? target.fieldId : target.elementId;
        const occurrenceId = "occurrenceId" in target ? target.occurrenceId : undefined;
        const occurrence = occurrenceId ? scope?.querySelector<HTMLElement>(`[data-occurrence-id="${escape(occurrenceId)}"]`) : null;
        const field = elementId ? scope?.querySelector<HTMLElement>(`[data-element-id="${escape(elementId)}"]`) : null;
        const destination = occurrence ?? field ?? scope;
        destination?.scrollIntoView({ block: "center" });
        (destination?.matches("button, input, select, textarea") ? destination : destination?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]"))?.focus();
        setNavigationMessage(`Opened ${finding.reference} for correction.`);
      };
      const dialogPath = instanceId ? repeatingDialogPath(shell.encounter.document, target.groupId, instanceId) : [];
      const openDialog = (index: number) => {
        if (index >= dialogPath.length) return window.requestAnimationFrame(focusTarget);
        const step = dialogPath[index]!;
        const dialogs = document.querySelectorAll<HTMLElement>("[role='dialog']");
        const scope: ParentNode = dialogs.item(dialogs.length - 1) ?? document;
        const group = scope.querySelector<HTMLElement>(`[data-group-id="${escape(step.groupId)}"]`);
        const row = group?.querySelector<HTMLElement>(`[data-group-instance-id="${escape(step.instanceId)}"]`)?.closest("tr");
        const edit = row?.querySelector<HTMLButtonElement>("button.stationary-icon-action.edit, button");
        if (!edit) return focusTarget();
        edit.click();
        window.requestAnimationFrame(() => openDialog(index + 1));
      };
      if (dialogPath.length) openDialog(0);
      else {
        const group = document.querySelector<HTMLElement>(`[data-group-id="${escape(target.groupId)}"]`);
        if (!instanceId) group?.querySelector<HTMLButtonElement>(".stationary-group-add-controls button, button")?.click();
        window.requestAnimationFrame(focusTarget);
      }
    });
  }

  function editValidationFinding(finding: SigningFinding, trigger: HTMLElement) {
    rememberTrigger(trigger);
    setEditingFinding(finding);
    setOpenNullField(null);
    if (presentationMode === "stationary") {
      navigateToStationaryFinding(finding);
      return;
    }
    if (!("eventType" in finding)) return;
    if (finding.id === MISSING_VITALS_FINDING_ID) {
      dispatch({ type: "view-selected", view: "timeline" });
      dispatch({ type: "vitals-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
      return;
    }
    dispatch({ type: "review-finding-selected", id: finding.id });
  }

  function startPhoto(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setNoteStatusMessage(null);
    setPhotoExpectedRevision(revisionRef.current);
    setPhotoDialog("new");
  }

  function openPhoto(note: ReportPhotoNote, trigger: HTMLElement) {
    rememberTrigger(trigger);
    setEditingFinding(null);
    setPhotoExpectedRevision(revisionRef.current);
    setPhotoDialog(note);
  }

  function startAudio(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setNoteStatusMessage(null);
    setAudioExpectedRevision(revisionRef.current);
    setAudioDialog("new");
  }

  function openAudio(note: ReportAudioNote, trigger: HTMLElement) {
    rememberTrigger(trigger);
    setEditingFinding(null);
    setAudioExpectedRevision(revisionRef.current);
    setAudioDialog(note);
  }

  function startNote(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setNoteError(null);
    setConfirmingNoteDelete(false);
    setTextNoteDraft({
      id: crypto.randomUUID(), capturedAt: new Date().toISOString(),
      capturedUtcOffsetMinutes: -new Date().getTimezoneOffset(), content: "", isNew: true,
    });
  }

  function openTextNote(note: ReportTextNote, trigger: HTMLElement) {
    rememberTrigger(trigger);
    setEditingFinding(null);
    setNoteError(null);
    setConfirmingNoteDelete(false);
    setTextNoteDraft({
      id: note.id, capturedAt: note.capturedAt, capturedUtcOffsetMinutes: note.capturedUtcOffsetMinutes,
      content: note.content, author: note.author, persistenceState: note.persistenceState, isNew: false,
    });
  }

  function openTimelineEvent(event: EncounterEvent, trigger: HTMLElement) {
    rememberTrigger(trigger);
    if (event.vitals) setOpenNullField(null);
    dispatch({ type: event.vitals ? "vitals-opened" : event.kind === "procedure" ? "procedure-opened" : event.kind === "medication" ? "medication-opened" : "note-opened", id: event.id });
  }

  function toggleStationaryTimeline() {
    setStationaryTimelineOpen((open) => {
      const next = !open;
      storeStationaryTimelineOpen(window.localStorage, session.user.id, next);
      return next;
    });
  }

  function startVitals(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setOpenNullField(null);
    dispatch({ type: "vitals-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }

  function startProcedure(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    setProcedureSearch("");
    dispatch({ type: "procedure-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }

  function startMedication(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditingFinding(null);
    dispatch({ type: "medication-started", id: crypto.randomUUID(), date: localClinicalDate(), time: localClinicalTime() });
  }

  const quickActionHandlers: Record<QuickActionId, (event: React.MouseEvent<HTMLButtonElement>) => void> = {
    vitals: startVitals, medication: startMedication, procedure: startProcedure, note: startNote,
  };

  async function signRecord() {
    if (!report || !canFinish || signing) return;
    setSigning(true);
    setSignError(null);
    let releaseProtectedHold: () => void = () => undefined;
    try {
      await flushSave();
      releaseProtectedHold = await holdProtectedReportForCompletion(report.id);
    } catch {
      setSignError("The record must finish protected storage before it can be signed.");
      setSigning(false);
      return;
    }
    if (!navigator.onLine || nextDraftChange(window.localStorage, report.id)) {
      releaseProtectedHold();
      setSignError("The record must finish syncing before it can be signed.");
      setSigning(false);
      return;
    }
    try {
      await signDraftReport(sessionRequestToken(session), report.id, revisionRef.current, session.user.id,
        reviewWarnings.filter(({ acknowledged }) => acknowledged).map((finding) => ({
          id: finding.id,
          acknowledgement: "acknowledgement" in finding ? finding.acknowledgement : undefined,
        })), validationEvaluationTimestamp);
      completeWorkspaceReport();
    } catch (error) {
      setSignError(error instanceof Error ? error.message : "The record could not be signed.");
    } finally {
      releaseProtectedHold();
      setSigning(false);
    }
  }

  async function disposeConflict(conflict: DispatchConflict, disposition: DispatchConflictDisposition) {
    await resolveConflict(conflict, disposition);
  }

  async function saveTextNote() {
    if (!report || !textNoteDraft || !textNoteValidation || noteSaving) return;
    if (textNoteValidation.error) {
      setNoteError(textNoteValidation.error);
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      await flushSave();
      const commandId = crypto.randomUUID();
      const response = textNoteDraft.isNew
        ? await createReportTextNote(sessionRequestToken(session), report.id, {
            commandId,
            expectedRevision: revisionRef.current,
            noteId: textNoteDraft.id,
            capturedAt: textNoteDraft.capturedAt,
            capturedUtcOffsetMinutes: textNoteDraft.capturedUtcOffsetMinutes,
            content: textNoteValidation.content,
          })
        : await updateReportTextNote(sessionRequestToken(session), report.id, textNoteDraft.id, {
            commandId,
            expectedRevision: revisionRef.current,
            content: textNoteValidation.content,
          });
      revisionRef.current = response.revision;
      setReportNotes((notes) => [response.note, ...notes.filter(({ id }) => id !== response.note.id)]
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id)));
      setTextNoteDraft(null);
      setNoteStatusMessage(textNoteDraft.isNew ? "Text note ready." : "Text note changes ready.");
    } catch (error) {
      if (error instanceof DraftSaveRejectedError && error.category === "server-conflict") {
        setNoteError("The report changed before this note could be saved. Wait for synchronization and try again.");
      } else if (error instanceof DraftSaveRejectedError) {
        setNoteError("The note was rejected. Remove control characters and keep it within 10,000 characters.");
      } else if (error instanceof Error && error.message === "session") {
        onSessionEnded();
      } else {
        setNoteError(error instanceof Error ? error.message : "The text note could not be saved.");
      }
    } finally {
      setNoteSaving(false);
    }
  }

  async function confirmDeleteTextNote() {
    if (!report || !textNoteDraft || textNoteDraft.isNew || noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      await flushSave();
      const response = await deleteReportTextNote(sessionRequestToken(session), report.id, textNoteDraft.id, {
        commandId: crypto.randomUUID(), expectedRevision: revisionRef.current,
      });
      revisionRef.current = response.revision;
      setReportNotes((notes) => notes.filter(({ id }) => id !== response.noteId));
      setTextNoteDraft(null);
      setConfirmingNoteDelete(false);
      setNoteStatusMessage("Text note deleted.");
    } catch (error) {
      setConfirmingNoteDelete(false);
      if (error instanceof DraftSaveRejectedError && error.category === "server-conflict") {
        setNoteError("The report changed before this note could be deleted. Wait for synchronization and try again.");
      } else if (error instanceof Error && error.message === "session") {
        onSessionEnded();
      } else {
        setNoteError(error instanceof Error ? error.message : "The text note could not be deleted.");
      }
    } finally {
      setNoteSaving(false);
    }
  }

  const blockProtectedEdit = (event: SyntheticEvent<HTMLElement>) => {
    if (!editingBlocked) return;
    const target = event.target as HTMLElement;
    if (!target.closest("button, input, select, textarea, label, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <main className={`app-shell ${presentationMode}-presentation${presentationMode === "stationary" && stationaryTimelineOpen ? " stationary-timeline-open" : ""}`} data-presentation-mode={presentationMode}
      data-editing-blocked={editingBlocked || undefined} onClickCapture={blockProtectedEdit}
      onBeforeInputCapture={blockProtectedEdit} onKeyDownCapture={blockProtectedEdit}>
      {recoveryNotice && !bestEffortNoticeInDemoBanner && <aside className="safety-notice" role="status"><strong>{recoveryNoticeHeading}</strong><span>{recoveryNotice}</span></aside>}
      {dispatchCancellation && <aside className="dispatch-canceled-notice" role="status">
        <strong>Dispatch canceled this response</strong>
        <span>{dispatchCancellationNotice(dispatchCancellation)}</span>
      </aside>}
      {navigationMessage && <p className="visually-hidden" role="status" aria-live="polite">{navigationMessage}</p>}
      {noteStatusMessage && <p className="visually-hidden" role="status" aria-live="polite">{noteStatusMessage}</p>}

      <header className="encounter-header">
        {presentationMode === "stationary" ? <div className="encounter-summary" aria-label="Call information">
          <span><small>Response</small><strong>{incident.responseNumber || "Not provided"}</strong></span>
          <span><small>Unit</small><strong>{incident.callSign || "Not provided"}</strong></span>
          <span><small>Priority</small><strong>{incident.dispatchPriority || "Not provided"}</strong></span>
          <span className="encounter-location"><small>Location</small><strong>{incident.location || "Not provided"}</strong></span>
        </div> : <>
          <div className="header-kicker"><span>{incidentEvents[0]?.time ?? "--:--"}</span></div>
          <div className="incident-line"><div>
            <span>{bundledEncounterDefinition.labels.incident} {incident.incidentNumber}</span>
            <span>Response {incident.responseNumber}</span>
            <span>Unit {incident.callSign}</span>
            <span>Priority {incident.dispatchPriority || "Not provided"}</span>
            <strong>{incident.location}</strong>
          </div></div>
        </>}
        {report && <div className="draft-actions">
          <span className={`sync-status sync-${syncStatus.toLocaleLowerCase().replaceAll(" ", "-")}`} role="status" aria-live="polite">{syncStatus}</span>
          {presentationMode === "stationary" && <button ref={timelineToggle} className="timeline-toggle-action" type="button" aria-expanded={stationaryTimelineOpen} aria-controls="stationary-timeline-sidebar" onClick={toggleStationaryTimeline}>Timeline <span aria-hidden="true">· {timelineEvents.length}</span></button>}
          {presentationMode === "stationary" && <button className="review-record-action" type="button" onClick={() => {
            if (shell.view === "review") dispatch({ type: "view-selected", view: "timeline" });
            else {
              dispatch({ type: "review-opened" });
              void flushSave();
            }
          }}>{shell.view === "review" ? "Return to record" : "Review & sign"}</button>}
          <button type="button" onClick={async () => {
            if (report && hasPendingProtectedMedia(report.id) && !window.confirm("Photo uploads may pause after closing. Saved-on-device media will resume while the app is open or in your next authenticated session. Save and close anyway?")) return;
            await flushSave(); onSaveAndClose();
          }}>Save &amp; close</button>
        </div>}
      </header>

      {presentationMode === "mobile" && <nav className="quick-actions" aria-label="Quick documentation">
        {structuredQuickActions.map((id) => <button key={id} className={activeDialog === id ? "active" : undefined} aria-pressed={activeDialog === id}
          title={id === "vitals" ? "Vital signs" : id === "medication" ? "Medication" : "Procedure"} aria-label={`Add ${id === "vitals" ? "vital signs" : id}`}
          type="button" onClick={quickActionHandlers[id]}><QuickActionIcon kind={id} /><span aria-hidden="true">{quickActionText[id]}</span></button>)}
        <button className={activeDialog === "note" ? "active" : undefined} aria-pressed={activeDialog === "note"} aria-label="Text note" title="Text note" type="button" onClick={startNote}><QuickActionIcon kind="note" /><span aria-hidden="true">Text</span></button>
        <button className={activeDialog === "photo" ? "active" : undefined} aria-pressed={activeDialog === "photo"} aria-label="Add photo note" title="Photo note" type="button" disabled={!report || editingBlocked} onClick={startPhoto}><span className="photo-action-icon" aria-hidden="true" /><span aria-hidden="true">Photo</span></button>
        <button className={activeDialog === "audio" ? "active" : undefined} aria-pressed={activeDialog === "audio"} aria-label="Add audio note" title="Spoken-audio note" type="button" disabled={!report || !online} onClick={startAudio}><span className="audio-action-icon" aria-hidden="true" /><span aria-hidden="true">Audio</span></button>
      </nav>}

      {presentationMode === "mobile" && <nav className="view-switcher" aria-label="Encounter views">
        {tabs.map((tab) => (
          <button
            aria-pressed={shell.view === tab.id}
            aria-current={shell.view === tab.id ? "page" : undefined}
            aria-label={tab.id === "checklist" ? `Checklist, ${reviewErrors.length} ${reviewErrors.length === 1 ? "error" : "errors"}, ${reviewWarnings.length} ${reviewWarnings.length === 1 ? "warning" : "warnings"}` : undefined}
            className={shell.view === tab.id ? "active" : undefined}
            key={tab.id}
            onClick={() => dispatch({ type: "view-selected", view: tab.id })}
            type="button"
          >
            {tab.label}
            {tab.id === "timeline" && <span aria-hidden="true"> · {timelineEvents.length}</span>}
            {tab.id === "checklist" && <span className="checklist-counts" aria-hidden="true">
              <span className={`error-count${reviewErrors.length ? "" : " zero-count"}`}>{reviewErrors.length} {reviewErrors.length === 1 ? "error" : "errors"}</span>
              <span className={`warning-count${reviewWarnings.length ? "" : " zero-count"}`}>{reviewWarnings.length} {reviewWarnings.length === 1 ? "warning" : "warnings"}</span>
            </span>}
          </button>
        ))}
      </nav>}

      {presentationMode === "stationary" && (
        <div hidden={shell.view === "review"}>
          <StationaryRecord
            document={encounter.document}
            findings={actionableStationaryFindings(configuredStationaryFindings.filter((finding): finding is StationaryValidationFinding => !("eventType" in finding)))}
            sectionFindings={stationarySectionFindings}
            formDefinition={report?.clinicalForm?.definition}
            catalogFields={report?.clinicalForm?.catalogFields}
            validation={report?.clinicalForm?.validation}
            onDocumentChange={(document) => dispatch({ type: "document-opened", document })}
          />
        </div>
      )}

      {presentationMode === "mobile" && shell.view === "timeline" && <EncounterTimeline
        events={timelineEvents}
        validationStatuses={eventValidationStatuses}
        definition={bundledEncounterDefinition}
        headingId="timeline-heading"
        onOpenTextNote={openTextNote}
        onOpenPhoto={openPhoto}
        onOpenAudio={openAudio}
        onOpenEvent={openTimelineEvent}
      />}
      {presentationMode === "stationary" && stationaryTimelineOpen && <aside id="stationary-timeline-sidebar" className="stationary-timeline-sidebar" aria-label="Encounter timeline" onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setStationaryTimelineOpen(false);
        storeStationaryTimelineOpen(window.localStorage, session.user.id, false);
        timelineToggle.current?.focus();
      }}>
        <EncounterTimeline events={timelineEvents} validationStatuses={eventValidationStatuses} definition={bundledEncounterDefinition}
          headingId="stationary-timeline-heading" onOpenTextNote={openTextNote} onOpenPhoto={openPhoto} onOpenAudio={openAudio} onOpenEvent={openTimelineEvent} />
      </aside>}
      {presentationMode === "mobile" && shell.view === "checklist" && (
        <section className="content-panel checklist-panel" aria-labelledby="checklist-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Warnings and errors</p>
              <h1 id="checklist-heading">Checklist</h1>
            </div>
            <span aria-live="polite">{reviewFindings.length + unresolvedDispatchConflicts.length} open</span>
          </div>
          {!reviewFindings.length && !unresolvedDispatchConflicts.length ? <p className="review-empty checklist-empty">✓ No warnings or errors.</p> : reviewFindings.length ? (
            <ul className="review-findings checklist-findings">
              {reviewFindings.map((finding) => (
                <li key={finding.id} className={finding.severity}>
                  <button type="button" onClick={(event) => editValidationFinding(finding, event.currentTarget)}>
                    <span className="finding-category">{finding.severity === "error" ? "Error" : "Warning"} · {finding.category}</span>
                    <strong>{finding.title}</strong>
                    <span>{finding.message}</span>
                    <small>{"vitalField" in finding.target && finding.target.vitalField ? "Edit value or choose PN/NV × →" : "Edit affected entry →"}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <DispatchConflictList conflicts={dispatchConflicts} onDispose={disposeConflict} />
          {conflictError && <p className="finish-help" role="alert">{conflictError}</p>}
        </section>
      )}

      {presentationMode === "stationary" && shell.view === "review" && (
        <>
        <ReviewPanel
          findings={configuredStationaryFindings}
          errors={reviewErrors}
          warnings={reviewWarnings}
          groups={bundledEncounterDefinition.composition.review.groups}
          canFinish={canFinish}
          validationClear={validationClear}
          signing={signing}
          signError={signError}
          onFinding={editValidationFinding}
          onWarning={(id, acknowledged) => dispatch({ type: "review-warning-acknowledged", id, acknowledged })}
          onSign={() => void signRecord()}
          blockedReason={!restored ? "The report is still loading."
            : !online ? "Signing is unavailable while offline. Reconnect and finish synchronization."
              : syncStatus !== "Saved" ? "Signing is unavailable until all changes finish synchronizing."
                : unresolvedDispatchConflicts.length ? "Resolve every dispatch difference before signing."
                  : undefined}
        />
        <DispatchConflictList conflicts={dispatchConflicts} onDispose={disposeConflict} />
        {conflictError && <p className="finish-help" role="alert">{conflictError}</p>}
        </>
      )}

      {photoDialog && report && <PhotoNoteDialog dialogRef={dialog} reportId={report.id}
        note={photoDialog === "new" ? null : photoDialog} csrfToken={sessionRequestToken(session)} revision={photoExpectedRevision}
        mediaPolicy={mediaPolicy ?? report.mediaPolicy ?? { settingsRevision: 1, reportMediaAllowanceBytes: DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES }}
        author={session.user}
        onClose={closeActiveDialog} onSessionEnded={onSessionEnded}
        onSaved={(saved, nextRevision) => { revisionRef.current = nextRevision; setReportNotes((notes) => [saved, ...notes.filter(({ id }) => id !== saved.id)]
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id))); setPhotoDialog(null); setNoteStatusMessage(photoDialog === "new" ? "Photo note ready." : "Photo caption ready."); }}
        onQueued={(saved) => { setReportNotes((notes) => [saved, ...notes.filter(({ id }) => id !== saved.id)]
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id))); setPhotoDialog(null); setNoteStatusMessage(saved.persistenceState === "failed" ? "Photo upload failed." : "Photo saved on this device."); }}
        onDeleted={(noteId, nextRevision) => { revisionRef.current = nextRevision; setReportNotes((notes) => notes.filter(({ id }) => id !== noteId)); setPhotoDialog(null); setNoteStatusMessage("Photo note deleted."); }} />}

      {audioDialog && report && <AudioNoteDialog dialogRef={dialog} reportId={report.id}
        note={audioDialog === "new" ? null : audioDialog} csrfToken={sessionRequestToken(session)} revision={audioExpectedRevision}
        onClose={closeActiveDialog} onSessionEnded={onSessionEnded}
        onSaved={(saved, nextRevision) => { revisionRef.current = nextRevision; setReportNotes((notes) => [saved, ...notes.filter(({ id }) => id !== saved.id)]
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id))); setAudioDialog(null); setNoteStatusMessage(audioDialog === "new" ? "Audio note ready." : "Audio caption ready."); }}
        onDeleted={(noteId, nextRevision) => { revisionRef.current = nextRevision; setReportNotes((notes) => notes.filter(({ id }) => id !== noteId)); setAudioDialog(null); setNoteStatusMessage("Audio note deleted."); }} />}

      {textNoteDraft && textNoteValidation && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog" role={confirmingNoteDelete ? "alertdialog" : "dialog"} aria-modal="true"
            aria-labelledby="note-dialog-title" aria-describedby={confirmingNoteDelete ? "note-delete-description" : undefined}>
            <div className="note-dialog-heading">
              <div>
                <p className="eyebrow">{confirmingNoteDelete ? "Confirm deletion" : textNoteDraft.isNew ? noteDefinition.labels.newEyebrow : noteDefinition.labels.editEyebrow}</p>
                <h2 id="note-dialog-title">{noteDefinition.labels.editorTitle}</h2>
              </div>
              {!textNoteDraft.isNew && !confirmingNoteDelete && <button className="remove-entry-button" type="button"
                disabled={noteSaving} onClick={() => setConfirmingNoteDelete(true)}>{noteDefinition.labels.remove}</button>}
            </div>
            {confirmingNoteDelete ? <>
              <p id="note-delete-description">Delete this text note from the draft report? This action cannot be undone.</p>
              <div className="note-dialog-actions">
                <button data-dialog-initial-focus type="button" disabled={noteSaving} onClick={() => setConfirmingNoteDelete(false)}>Keep note</button>
                <button className="remove-entry-button" type="button" disabled={noteSaving} onClick={() => void confirmDeleteTextNote()}>
                  {noteSaving ? "Deleting…" : "Delete note"}
                </button>
              </div>
            </> : <>
              <p className="note-metadata">
                Captured {new Date(textNoteDraft.capturedAt).toLocaleString([], report?.agencyTimeZone ? { timeZone: report.agencyTimeZone } : undefined)}
                {textNoteDraft.author ? ` · ${textNoteDraft.author.displayName}` : ` · ${session.user.displayName}`}
                {!textNoteDraft.isNew ? " · Ready" : ""}
              </p>
              <label htmlFor="report-text-note">{noteDefinition.labels.summary}</label>
              <textarea
                ref={noteSummary}
                id="report-text-note"
                data-dialog-initial-focus
                rows={8}
                placeholder={noteDefinition.labels.summaryPlaceholder}
                required
                maxLength={REPORT_TEXT_NOTE_MAX_CHARACTERS}
                aria-invalid={Boolean(noteError || (textNoteDraft.content && textNoteValidation.error))}
                aria-describedby="report-text-note-count report-text-note-error"
                value={textNoteDraft.content}
                onChange={(event) => {
                  setNoteError(null);
                  setTextNoteDraft((draft) => draft ? { ...draft, content: event.target.value } : null);
                }}
              />
              <small id="report-text-note-count">{textNoteValidation.characterCount.toLocaleString()} / {REPORT_TEXT_NOTE_MAX_CHARACTERS.toLocaleString()} characters</small>
              <p id="report-text-note-error" className="finish-help" role={noteError || textNoteValidation.error ? "alert" : undefined}>
                {noteError ?? (textNoteDraft.content ? textNoteValidation.error : null)}
              </p>
              <div className="note-dialog-actions">
                <button type="button" disabled={noteSaving} onClick={closeActiveDialog}>{noteDefinition.labels.cancel}</button>
                <button type="button" disabled={noteSaving} onClick={() => void saveTextNote()}>
                  {noteSaving ? "Saving…" : textNoteDraft.isNew ? "Save text note" : noteDefinition.labels.save}
                </button>
              </div>
            </>}
          </section>
        </div>
      )}
      {shell.medicationDraft && <MedicationDialog definition={bundledEncounterDefinition} dialogRef={dialog} draft={shell.medicationDraft} dispatch={dispatch} finding={editingFinding?.category === medicationDefinition.labels.category ? editingActionableFinding : undefined} />}

      {shell.procedureDraft && <ProcedureDialog dialogRef={dialog} draft={shell.procedureDraft} definition={procedureDefinition} search={procedureSearch} onSearch={setProcedureSearch} dispatch={dispatch} finding={editingFinding && "eventType" in editingFinding ? editingFinding : undefined} />}

      {shell.vitalDraft && (
        <div className="dialog-backdrop" role="presentation">
          <section ref={dialog} className="note-dialog vital-dialog" role="dialog" aria-modal="true" aria-labelledby="vital-dialog-title">
            <div className="note-dialog-heading">
              <div><p className="eyebrow">{shell.vitalDraft.isNew ? vitalDefinition.labels.newEyebrow : vitalDefinition.labels.editEyebrow}</p><h2 id="vital-dialog-title">{vitalDefinition.labels.editorTitle}</h2></div>
              <button className="remove-entry-button" type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-removed" }); }}>{vitalDefinition.labels.remove}</button>
            </div>
            <TimePicker className={vitalFindingActive && editingFinding && !editingVitalField ? `finding-frame ${editingFinding.severity}` : undefined} initialFocus label={vitalDefinition.labels.time} date={shell.vitalDraft.date} onDateChange={(value) => dispatch({ type: "vitals-date-changed", value })} value={shell.vitalDraft.time} onChange={(value) => dispatch({ type: "vitals-time-changed", value })} />
            <DialogValidationMessage finding={vitalFindingActive && !editingVitalField ? editingActionableFinding : undefined} />
            <div className="vital-grid">
              {vitalDefinition.fields.map((configuredField) => {
                const field = configuredField.id;
                return (
                <div className={`vital-field ${vitalFindingActive && editingVitalField === field ? `finding-frame ${editingFinding!.severity}` : ""}`.trim()} key={field}>
                  <label htmlFor={`vital-${field}`}>{configuredField.label} <small>{configuredField.unit}</small></label>
                  <div className="vital-inputs">
                    <input id={`vital-${field}`} inputMode="numeric" required={configuredField.required} placeholder={`${configuredField.boundaries.min}–${configuredField.boundaries.max}`} value={shell.vitalDraft!.values[field]} onChange={(event) => dispatch({ type: "vitals-value-changed", field, value: event.target.value })} />
                    <button
                      type="button"
                      className={`null-value-trigger ${shell.vitalDraft!.values.nullValues[field] ? "active" : ""}`}
                      aria-label={`Set unavailable or pertinent-negative value for ${configuredField.label}`}
                      aria-expanded={openNullField === field}
                      onClick={() => setOpenNullField((current) => current === field ? null : field)}
                    >×</button>
                    {openNullField === field && (
                      <div className="null-value-menu" role="menu" aria-label={`${configuredField.label} unavailable or pertinent-negative value`}>
                        {shell.vitalDraft!.values.nullValues[field] && (
                          <button
                            autoFocus
                            type="button"
                            role="menuitem"
                            onClick={() => { dispatch({ type: "vitals-null-changed", field, value: "" }); setOpenNullField(null); }}
                          >Clear exceptional value</button>
                        )}
                        {nullOptionsFor(configuredField).filter((option) => option.value).map((option, index) => (
                          <button
                            autoFocus={!shell.vitalDraft!.values.nullValues[field] && index === 0}
                            key={option.value}
                            type="button"
                            role="menuitem"
                            onClick={() => { dispatch({ type: "vitals-null-changed", field, value: option.value }); setOpenNullField(null); }}
                          >{option.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <DialogValidationMessage finding={vitalFindingActive && editingVitalField === field ? editingActionableFinding : undefined} />
                </div>
              );})}
            </div>
            <p className="null-help">{vitalDefinition.labels.absenceHelp}</p>
            <div className="note-dialog-actions"><button type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-cancelled" }); }}>{vitalDefinition.labels.cancel}</button><button type="button" onClick={() => { setOpenNullField(null); dispatch({ type: "vitals-saved" }); }}>{shell.vitalDraft.isNew ? vitalDefinition.labels.add : vitalDefinition.labels.save}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return <ClinicianSessionGate>{({ session, report, presentationMode, closeReport, completeReport, sessionEnded, reportErrorStateChanged }) => (
    <EncounterWorkspace key={report?.id ?? "standalone"} session={session} report={report} presentationMode={presentationMode} onSaveAndClose={closeReport} onReportCompleted={completeReport} onSessionEnded={sessionEnded} onErrorStateChange={reportErrorStateChanged} />
  )}</ClinicianSessionGate>;
}

function conflictValue(value: EncounterValue | null): string {
  if (value === null) return "Retracted by dispatch";
  const pn = value.pertinentNegative ? ` — ${value.pertinentNegative.display ?? value.pertinentNegative.code}` : "";
  if (value.kind === "coded") return `${value.display ?? value.code}${pn}`;
  if (value.kind === "pertinent-negative") return value.display ?? value.code;
  if (value.kind === "null") return value.notValue?.display ?? value.notValue?.code ?? "Null";
  if (value.kind === "absent") return "Not documented";
  return `${String(value.value)}${pn}`;
}

function DispatchConflictList({ conflicts, onDispose }: {
  readonly conflicts: ReadonlyArray<DispatchConflict>;
  readonly onDispose: (conflict: DispatchConflict, disposition: DispatchConflictDisposition) => void;
}) {
  const unresolved = conflicts.filter(({ disposition }) => disposition === null);
  return (
    <section className="review-group dispatch-conflicts" aria-labelledby="dispatch-conflicts-heading">
      <h2 id="dispatch-conflicts-heading">Dispatch differences <span>{unresolved.length}</span></h2>
      {!unresolved.length ? <p className="review-empty">✓ No unresolved dispatch differences.</p> : (
        <ul className="review-findings">
          {unresolved.map((conflict) => <li key={conflict.id} className="warning">
            <span className="finding-category">Dispatch revision {conflict.dispatchRevision} · {conflict.elementId}</span>
            <strong>Clinician value: {conflictValue(conflict.clinicianValue)}</strong>
            <span>Dispatch proposes: {conflictValue(conflict.dispatchValue)}</span>
            <div className="dispatch-conflict-actions">
              <button type="button" onClick={() => onDispose(conflict, "keep")}>Keep my value</button>
              <button type="button" onClick={() => onDispose(conflict, "accept")}>Accept dispatch value</button>
              <button type="button" onClick={() => onDispose(conflict, "acknowledge")}>Acknowledge difference</button>
            </div>
          </li>)}
        </ul>
      )}
    </section>
  );
}

function ReviewPanel({ findings, errors, warnings, groups, canFinish, validationClear, signing, signError, blockedReason, onFinding, onWarning, onSign }: {
  readonly findings: ReadonlyArray<SigningFinding>;
  readonly errors: ReadonlyArray<SigningFinding>;
  readonly warnings: ReadonlyArray<SigningFinding>;
  readonly groups: typeof bundledEncounterDefinition.composition.review.groups;
  readonly canFinish: boolean;
  readonly validationClear: boolean;
  readonly signing: boolean;
  readonly signError: string | null;
  readonly blockedReason?: string;
  readonly onFinding: (finding: SigningFinding, trigger: HTMLElement) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
  readonly onSign: () => void;
}) {
  return (
    <section className="content-panel review-panel" aria-labelledby="review-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Consolidated validation</p><h1 id="review-heading">Review and sign</h1></div>
        <span>{errors.length} errors · {warnings.length} warnings</span>
      </div>
      <p className="review-intro">Resolve every blocking error and acknowledge each warning before signing the record.</p>

      {groups.map((group) => <FindingGroup key={group.severity} title={group.title} empty={group.empty} findings={findings.filter((finding) => finding.severity === group.severity)} onFinding={onFinding} onWarning={onWarning} />)}
      <FindingGroup title="Information" empty="No informational findings." findings={findings.filter((finding) => finding.severity === "information")} onFinding={onFinding} onWarning={onWarning} />

      <div className="review-actions">
        <button className={validationClear ? "validation-clear" : undefined} type="button" disabled={!canFinish || signing} onClick={onSign}>{signing ? "Signing…" : "Sign record"}</button>
      </div>
      {!canFinish && <p className="finish-help" role="status">{blockedReason ?? "Signing stays blocked until errors are fixed and every warning is acknowledged."}</p>}
      {signError && <p className="finish-help" role="alert">{signError}</p>}
    </section>
  );
}

function FindingGroup({ title, empty, findings, onFinding, onWarning }: {
  readonly title: string;
  readonly empty: string;
  readonly findings: ReadonlyArray<SigningFinding>;
  readonly onFinding: (finding: SigningFinding, trigger: HTMLElement) => void;
  readonly onWarning: (id: string, acknowledged: boolean) => void;
}) {
  return (
    <section className="review-group">
      <h2>{title} <span className={findings.length ? undefined : "zero-count"}>{findings.length}</span></h2>
      {!findings.length ? <p className="review-empty">✓ {empty}</p> : (
        <ul className="review-findings">
          {findings.map((finding) => (
            <li key={finding.id} className={finding.severity}>
              <button type="button" onClick={(event) => onFinding(finding, event.currentTarget)}>
                <span className="finding-category">{finding.category} · {finding.reference}</span>
                <strong>{finding.title}</strong>
                <span>{finding.message}</span>
                <small>Open affected entry →</small>
              </button>
              {finding.severity === "warning" && (
                <label className="review-acknowledgement">
                  <input type="checkbox" checked={finding.acknowledged} onChange={(event) => onWarning(finding.id, event.target.checked)} />
                  I reviewed and acknowledge this warning
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
