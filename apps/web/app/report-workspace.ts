"use client";

import type { ClinicianSession, DispatchCancellation, DispatchConflict, DispatchConflictDisposition, ReportMediaPolicy, ReportNote } from "@open-triage/contracts";
import { sessionRequestToken } from "./clinician-session";
import { sameJsonValue } from "./json-values";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type MutableRefObject } from "react";
import { resolveDispatchConflict } from "./assigned-calls";
import {
  ACTIVE_REPORT_POLL_INTERVAL_MS,
  applyDraftMutationDelta,
  demoActionMutationDelta,
  recoveryMutationBatches,
  reconciledDraftSyncStatus,
  DRAFT_CONFLICT_RECOVERY_LIMIT,
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SYNC_RETRY_MS,
  DraftSaveRejectedError,
  draftMutationDelta,
  encounterDocumentToDraftMutations,
  fetchActiveReport,
  saveDraftReport,
  shellStateToDraftMutations,
  shouldQueueInitialDraftSnapshot,
  type ActiveDraftReport,
  type DraftSyncStatus,
} from "./draft-report";
import { clearShellState, loadShellStateResult, saveReportSyncStatus, saveShellState } from "./local-persistence";
import {
  acceptDraftChange,
  cacheLocalReportDocument,
  discardQueuedDraftChanges,
  expectedRevisionForNextChange,
  markDraftChangeAttempted,
  nextDraftChange,
  rebaseQueuedDraftChanges,
  reconcileCachedActiveReport,
  removeSignedOfflineReport,
  queueDraftChange,
  queuedDraftChanges,
  saveCachedValidationErrorCount,
} from "./offline-reports";
import { pendingDraftTargets, reconcileActiveReportDocument } from "./active-report-reconciliation";
import type { PresentationMode } from "./presentation-mode";
import { bundledEncounterDefinition, type ShellAction, type ShellState } from "./standard-encounter";
import { DEMO_CLEAR_EVENT, DEMO_POPULATE_EVENT } from "./demo-provenance";
import { canUseClinicalDemoDraftActions } from "./clinical-demo";
import { browserRequestConfiguration } from "./browser-api";
import { recordFeedbackInteraction } from "./feedback-telemetry";
import { markProtectedReportCompleted, offlineEditingAvailable, protectedStorageStatus, subscribeProtectedStorageStatus } from "./protected-clinical-storage";

const NO_PROTECTED_REPORT_STATUS = { mode: "online-only", explanation: null } as const;

export interface ReportWorkspace {
  readonly restored: boolean;
  readonly recoveryNotice: string | null;
  readonly recoveryNoticeHeading: string;
  readonly bestEffortNoticeInDemoBanner: boolean;
  readonly syncStatus: DraftSyncStatus;
  readonly revision: MutableRefObject<number>;
  readonly dispatchConflicts: ReadonlyArray<DispatchConflict>;
  readonly dispatchCancellation: DispatchCancellation | null;
  readonly conflictError: string | null;
  readonly editingBlocked: boolean;
  readonly mediaPolicy: ReportMediaPolicy | undefined;
  readonly flushSave: () => Promise<void>;
  readonly completeReport: () => void;
  readonly resolveConflict: (conflict: DispatchConflict, disposition: DispatchConflictDisposition) => Promise<void>;
}

/** Shared persistence and reconciliation boundary consumed by both report presentations. */
export function useReportWorkspace({
  session,
  report,
  shell,
  dispatch,
  validationErrorCount,
  online,
  onSessionEnded,
  onReportCompleted,
  onNotesChange,
}: {
  readonly session: ClinicianSession;
  readonly report: ActiveDraftReport | null;
  readonly presentationMode: PresentationMode;
  readonly shell: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly validationErrorCount: number;
  readonly online: boolean;
  readonly onSessionEnded: () => void;
  readonly onReportCompleted: () => void;
  readonly onNotesChange: (notes: ReadonlyArray<ReportNote>) => void;
}): ReportWorkspace {
  const [restored, setRestored] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<DraftSyncStatus>("Saved");
  const [dispatchConflicts, setDispatchConflicts] = useState<ReadonlyArray<DispatchConflict>>(report?.dispatchConflicts ?? []);
  const [dispatchCancellation, setDispatchCancellation] = useState<DispatchCancellation | null>(report?.dispatchCancellation ?? null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [mediaPolicy, setMediaPolicy] = useState<ReportMediaPolicy | undefined>(report?.mediaPolicy);
  const [conflictRecoveryRequest, setConflictRecoveryRequest] = useState(0);
  const protectedStatus = useSyncExternalStore(
    useCallback((changed) => subscribeProtectedStorageStatus((reportId) => {
      if (reportId === report?.id) changed();
    }), [report?.id]),
    useCallback(() => report ? protectedStorageStatus(report.id) : NO_PROTECTED_REPORT_STATUS, [report]),
    () => NO_PROTECTED_REPORT_STATUS,
  );
  const revision = useRef(report?.revision ?? 0);
  const csrfToken = sessionRequestToken(session);
  const persistedDraft = useRef<ReturnType<typeof shellStateToDraftMutations>>({ groups: [], occurrences: [] });
  const activeEtag = useRef<string | undefined>(undefined);
  const shellRef = useRef(shell);
  const skipReconciledQueue = useRef(false);
  const activeSave = useRef<Promise<void> | null>(null);
  const recoverConflictingQueue = useRef(false);
  const conflictRecoveryAttempts = useRef(0);
  const skipInitialQueue = useRef(false);
  const queueInitialSnapshot = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const completed = useRef(false);
  const pendingDemoAction = useRef<"populate" | "clear" | null>(null);

  useEffect(() => { shellRef.current = shell; }, [shell]);
  useEffect(() => {
    const authorized = () => canUseClinicalDemoDraftActions(report) && navigator.onLine &&
      browserRequestConfiguration().mode === "server" && session.capabilities?.includes("clinical:demo") === true;
    const populated = () => { if (authorized()) pendingDemoAction.current = "populate"; };
    const cleared = () => { if (authorized()) pendingDemoAction.current = "clear"; };
    window.addEventListener(DEMO_POPULATE_EVENT, populated);
    window.addEventListener(DEMO_CLEAR_EVENT, cleared);
    return () => {
      window.removeEventListener(DEMO_POPULATE_EVENT, populated);
      window.removeEventListener(DEMO_CLEAR_EVENT, cleared);
    };
  }, [report, session.capabilities]);

  const completeReport = useCallback(() => {
    if (!report) return;
    completed.current = true;
    clearShellState(window.localStorage, report.id);
    removeSignedOfflineReport(window.localStorage, report.id);
    onReportCompleted();
  }, [onReportCompleted, report]);

  useEffect(() => {
    completed.current = false;
    recoverConflictingQueue.current = false;
    conflictRecoveryAttempts.current = 0;
    persistedDraft.current = report?.document
      ? encounterDocumentToDraftMutations(report.id, report.document)
      : { groups: [], occurrences: [] };
    queueMicrotask(() => setMediaPolicy(report?.mediaPolicy));
    const result = loadShellStateResult(
      window.localStorage,
      bundledEncounterDefinition,
      report?.id,
      report?.document?.formProfile && {
        ...report.document.formProfile,
        catalogFields: report.clinicalForm?.catalogFields,
      },
    );
    queueInitialSnapshot.current = shouldQueueInitialDraftSnapshot(
      result.status,
      report?.revision ?? 0,
      Boolean(report?.document),
      Boolean(report && nextDraftChange(window.localStorage, report.id)),
    );
    if (result.status === "restored") {
      skipInitialQueue.current = true;
      dispatch({ type: "state-restored", state: result.state });
    } else if (result.status === "incompatible") {
      queueMicrotask(() => setRecoveryNotice(`Saved encounter ${result.savedDefinition.id ?? "(unknown)"} version ${result.savedDefinition.version ?? "(unknown)"} is incompatible. Its original JSON was preserved in ${result.recoveryKey}.`));
    } else if (result.status === "invalid") {
      queueMicrotask(() => setRecoveryNotice(`Saved encounter could not be loaded: ${result.reason}. Its original JSON was preserved in ${result.recoveryKey}.`));
    } else if (report?.document) dispatch({ type: "document-opened", document: report.document });
    queueMicrotask(() => {
      if (report && nextDraftChange(window.localStorage, report.id)) setSyncStatus("Pending sync");
      setRestored(true);
    });
  }, [dispatch, report]);

  const flushSave = useCallback(async (): Promise<void> => {
    if (!report) return;
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (activeSave.current) await activeSave.current;
    while (true) {
      const queued = nextDraftChange(window.localStorage, report.id);
      if (!queued) {
        setSyncStatus("Saved");
        return;
      }
      setSyncStatus("Saving");
      markDraftChangeAttempted(window.localStorage, report.id, queued.command.commandId);
      let requestConflictRecovery = false;
      const attempt = (async () => {
        try {
          const saved = await saveDraftReport(csrfToken, report.id, queued.command);
          if (saved.status === "signed") {
            acceptDraftChange(window.localStorage, report.id, queued.command.commandId, saved);
            persistedDraft.current = applyDraftMutationDelta(persistedDraft.current, queued.command);
            if (!nextDraftChange(window.localStorage, report.id)) {
              completeReport();
              return;
            }
            return;
          }
          revision.current = saved.revision;
          if (conflictRecoveryAttempts.current > 0) recordFeedbackInteraction("draft-sync.recovered");
          conflictRecoveryAttempts.current = 0;
          acceptDraftChange(window.localStorage, report.id, queued.command.commandId, saved);
          persistedDraft.current = applyDraftMutationDelta(persistedDraft.current, queued.command);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "offline";
          if (reason === "session") {
            setSyncStatus("Pending sync");
            onSessionEnded();
            return;
          }
          if (reason === "completed") {
            markProtectedReportCompleted(report.id);
            setSyncStatus("Pending sync");
            return;
          }
          if (reason === "purged") {
            completeReport();
            return;
          }
          if (error instanceof DraftSaveRejectedError) {
            recordFeedbackInteraction(`draft-sync.${error.category}`);
          }
          if (error instanceof DraftSaveRejectedError && error.category === "server-conflict" &&
              conflictRecoveryAttempts.current < DRAFT_CONFLICT_RECOVERY_LIMIT) {
            recoverConflictingQueue.current = true;
            conflictRecoveryAttempts.current += 1;
            activeEtag.current = undefined;
            setSyncStatus("Saving");
            requestConflictRecovery = true;
            return;
          }
          if (error instanceof DraftSaveRejectedError) {
            if (error.category === "server-conflict") recordFeedbackInteraction("draft-sync.retry-exhausted");
            setSyncStatus("Conflict");
            return;
          }
          setSyncStatus("Pending sync");
        }
      })();
      activeSave.current = attempt;
      await attempt;
      activeSave.current = null;
      if (requestConflictRecovery) {
        setConflictRecoveryRequest((request) => request + 1);
        return;
      }
      if (nextDraftChange(window.localStorage, report.id)?.command.commandId === queued.command.commandId) return;
    }
  }, [completeReport, csrfToken, onSessionEnded, report]);

  useEffect(() => {
    if (!report?.expiresAt) return;
    const remaining = Date.parse(report.expiresAt) - Date.now();
    if (remaining <= 0) {
      queueMicrotask(completeReport);
      return;
    }
    const timer = window.setTimeout(completeReport, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [completeReport, report?.expiresAt]);

  useEffect(() => {
    if (!restored || completed.current) return;
    saveShellState(window.localStorage, shell, report?.id);
    if (!report) return;
    cacheLocalReportDocument(window.localStorage, report.id, shell.encounter.document);
  }, [restored, shell, report]);

  useEffect(() => {
    if (!restored || completed.current || !report) return;
    const projected = shellStateToDraftMutations(report.id, shellRef.current, persistedDraft.current);
    const pendingChanges = queuedDraftChanges(window.localStorage, report.id);
    const optimisticDraft = pendingChanges.reduce(
      (baseline, queued) => applyDraftMutationDelta(baseline, queued.command),
      persistedDraft.current,
    );
    const unscopedMutations = queueInitialSnapshot.current ? projected : draftMutationDelta(
      projected,
      optimisticDraft,
    );
    if (skipReconciledQueue.current) {
      skipReconciledQueue.current = false;
      return;
    }
    if (skipInitialQueue.current) {
      skipInitialQueue.current = false;
      if (nextDraftChange(window.localStorage, report.id)) {
        if (navigator.onLine) queueMicrotask(() => void flushSave());
        else queueMicrotask(() => setSyncStatus("Pending sync"));
      }
      return;
    }
    const demoAction = pendingDemoAction.current ?? undefined;
    const last = pendingChanges.at(-1);
    const existing = last && !last.attempted && last.command.demoAction === demoAction ? last : undefined;
    const mutations = demoAction
      ? demoActionMutationDelta(demoAction, unscopedMutations, optimisticDraft)
      : unscopedMutations;
    if (!mutations.groups.length && !mutations.occurrences.length) {
      pendingDemoAction.current = null;
      return;
    }
    queueInitialSnapshot.current = false;
    queueDraftChange(window.localStorage, report.id, {
      commandId: existing && !existing.attempted ? existing.command.commandId : crypto.randomUUID(),
      expectedRevision: expectedRevisionForNextChange(window.localStorage, report.id, revision.current, demoAction),
      authorId: session.user.id,
      // Presentation is a view choice, not a synchronization identity. Keeping
      // this stable prevents mobile/stationary switches from looking like a new
      // target writer while the report remains open.
      deviceId: `web:${report.id}`,
      clientTime: existing && !existing.attempted ? existing.command.clientTime : new Date().toISOString(),
      ...(demoAction ? { demoAction } : {}),
      ...mutations,
    });
    pendingDemoAction.current = null;
    queueMicrotask(() => setSyncStatus(navigator.onLine ? "Saving" : "Pending sync"));
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (navigator.onLine) saveTimer.current = window.setTimeout(() => void flushSave(), DRAFT_SAVE_DEBOUNCE_MS);
  }, [flushSave, restored, shell.encounter.document, report, session.user.id]);

  useEffect(() => {
    if (report) saveReportSyncStatus(window.localStorage, report.id, syncStatus);
  }, [report, syncStatus]);

  useEffect(() => {
    if (report) saveCachedValidationErrorCount(window.localStorage, report.id, validationErrorCount);
  }, [report, validationErrorCount]);

  useEffect(() => {
    const retry = () => { if (report) void flushSave(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [flushSave, report]);

  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, [report?.id]);

  useEffect(() => {
    if (!report || syncStatus !== "Pending sync") return;
    const retryTimer = window.setTimeout(() => {
      if (navigator.onLine) void flushSave();
    }, DRAFT_SYNC_RETRY_MS);
    return () => window.clearTimeout(retryTimer);
  }, [flushSave, report, syncStatus]);

  useEffect(() => {
    if (!report || !restored) return;
    let pollTimer: number | null = null;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling || document.visibilityState !== "visible" || activeSave.current) return;
      polling = true;
      let retryRecoveredChange = false;
      const previousEtag = activeEtag.current;
      try {
        const response = await fetchActiveReport(report.id, previousEtag);
        if (!response || stopped) return;
        // A response started before a successful autosave can arrive afterward.
        // Never replace the newer local revision with that older snapshot.
        if (response.resource.reportRevision < revision.current) return;
        activeEtag.current = response.etag || previousEtag;
        const local = shellRef.current.encounter.document;
        const pending = queuedDraftChanges(window.localStorage, report.id);
        const queued = pending[0];
        const localDraft = encounterDocumentToDraftMutations(report.id, local);
        const optimisticDraft = pending.reduce(
          (baseline, change) => applyDraftMutationDelta(baseline, change.command),
          persistedDraft.current,
        );
        const localDelta = draftMutationDelta(localDraft, optimisticDraft);
        const hasUnqueuedChanges = localDelta.groups.length > 0 || localDelta.occurrences.length > 0;
        const hasPending = pending.length > 0 || hasUnqueuedChanges;
        setSyncStatus((current) => reconciledDraftSyncStatus(current, hasPending));
        const queuedTargets = queued ? pendingDraftTargets({
          groups: pending.flatMap(({ command }) => command.groups),
          occurrences: pending.flatMap(({ command }) => command.occurrences),
        }, persistedDraft.current) : undefined;
        const localTargets = hasUnqueuedChanges ? pendingDraftTargets(localDelta, persistedDraft.current) : undefined;
        const targets = hasPending ? {
          groupIds: new Set([...(queuedTargets?.groupIds ?? []), ...(localTargets?.groupIds ?? [])]),
          occurrenceIds: new Set([...(queuedTargets?.occurrenceIds ?? []), ...(localTargets?.occurrenceIds ?? [])]),
        } : undefined;
        const merged = reconcileActiveReportDocument(report.id, local, response.resource.document, hasPending, targets);
        const serverDraft = encounterDocumentToDraftMutations(report.id, response.resource.document);
        revision.current = response.resource.reportRevision;
        if (queued) {
          if (recoverConflictingQueue.current) {
            const recoveredDraft = encounterDocumentToDraftMutations(report.id, merged);
            const retryDelta = draftMutationDelta(recoveredDraft, serverDraft);
            discardQueuedDraftChanges(window.localStorage, report.id, response.resource.reportRevision, new Date().toISOString());
            recoverConflictingQueue.current = false;
            if (!retryDelta.groups.length && !retryDelta.occurrences.length) {
              conflictRecoveryAttempts.current = 0;
            } else {
              recoveryMutationBatches(retryDelta, serverDraft).forEach((batch, index) => {
                queueDraftChange(window.localStorage, report.id, {
                  ...queued.command,
                  commandId: crypto.randomUUID(),
                  expectedRevision: response.resource.reportRevision + index,
                  clientTime: new Date().toISOString(),
                  demoAction: batch.demoAction,
                  groups: batch.groups,
                  occurrences: batch.occurrences,
                });
              });
              retryRecoveredChange = true;
            }
            // Recovery already materializes the exact retry delta. The
            // document-opened dispatch must not synthesize a duplicate queue.
            skipReconciledQueue.current = !hasUnqueuedChanges;
            skipInitialQueue.current = false;
            setSyncStatus(retryRecoveredChange ? "Saving" : "Saved");
          } else {
            rebaseQueuedDraftChanges(window.localStorage, report.id, response.resource.reportRevision);
            // The queued command already owns the pending targets. Do not let
            // the document-opened dispatch synthesize another command on each
            // poll, especially after a terminal rejected retry.
            skipReconciledQueue.current = !hasUnqueuedChanges;
          }
          persistedDraft.current = serverDraft;
        }
        else {
          persistedDraft.current = serverDraft;
          skipReconciledQueue.current = !hasUnqueuedChanges;
        }
        reconcileCachedActiveReport(window.localStorage, report.id, response.resource, merged);
        setDispatchConflicts((current) => sameJsonValue(current, response.resource.dispatchConflicts)
          ? current : response.resource.dispatchConflicts);
        setDispatchCancellation((current) => sameJsonValue(current, response.resource.dispatchCancellation)
          ? current : response.resource.dispatchCancellation);
        setMediaPolicy((current) => !response.resource.mediaPolicy || sameJsonValue(current, response.resource.mediaPolicy)
          ? current : response.resource.mediaPolicy);
        onNotesChange(response.resource.notes ?? []);
        if (!sameJsonValue(local, merged)) dispatch({ type: "document-opened", document: merged });
        else skipReconciledQueue.current = false;
        if (retryRecoveredChange) queueMicrotask(() => void flushSave());
      } catch (error) {
        if (!(error instanceof Error)) return;
        if (error.message === "session") onSessionEnded();
        else if (error.message === "completed") {
          markProtectedReportCompleted(report.id);
          if (nextDraftChange(window.localStorage, report.id)) {
            setSyncStatus("Pending sync");
            void flushSave();
          } else completeReport();
        }
        else if (error.message === "purged") completeReport();
        else if (recoverConflictingQueue.current) setSyncStatus("Conflict");
      } finally {
        polling = false;
      }
    };
    const startOrPause = () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = document.visibilityState === "visible"
        ? window.setInterval(() => void poll(), ACTIVE_REPORT_POLL_INTERVAL_MS)
        : null;
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") void poll();
      startOrPause();
    };
    void poll();
    startOrPause();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stopped = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [completeReport, conflictRecoveryRequest, dispatch, flushSave, onNotesChange, onSessionEnded, report, restored]);

  const resolveConflict = useCallback(async (conflict: DispatchConflict, disposition: DispatchConflictDisposition) => {
    if (!report) return;
    setConflictError(null);
    try {
      const resolved = await resolveDispatchConflict(csrfToken, report.id, conflict.id, disposition);
      setDispatchConflicts((current) => current.map((candidate) => candidate.id === resolved.id ? resolved : candidate));
      revision.current += 1;
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : "The dispatch difference could not be resolved.");
    }
  }, [csrfToken, report]);

  return {
    restored,
    recoveryNotice: recoveryNotice ?? protectedStatus.explanation,
    recoveryNoticeHeading: recoveryNotice
      ? "Saved data needs recovery"
      : protectedStatus.mode === "best-effort"
        ? "Best-effort offline storage"
        : protectedStatus.mode === "online-only"
          ? "Offline storage unavailable"
          : "Saved data needs recovery",
    bestEffortNoticeInDemoBanner: !recoveryNotice && protectedStatus.mode === "best-effort" && online &&
      browserRequestConfiguration().mode === "server" && session.capabilities?.includes("clinical:demo") === true,
    syncStatus,
    revision,
    dispatchConflicts,
    dispatchCancellation,
    conflictError,
    editingBlocked: protectedStatus.mode === "read-only" || protectedStatus.mode === "locked" ||
      (!online && !offlineEditingAvailable(protectedStatus.mode)),
    mediaPolicy,
    flushSave,
    completeReport,
    resolveConflict,
  };
}
