"use client";

import type { ClinicianSession, DispatchCancellation, DispatchConflict, DispatchConflictDisposition } from "@open-triage/contracts";
import { sessionRequestToken } from "./clinician-session";
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import { resolveDispatchConflict } from "./assigned-calls";
import {
  ACTIVE_REPORT_POLL_INTERVAL_MS,
  applyDraftMutationDelta,
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SYNC_RETRY_MS,
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
  saveCachedValidationErrorCount,
} from "./offline-reports";
import { pendingDraftTargets, reconcileActiveReportDocument } from "./active-report-reconciliation";
import type { PresentationMode } from "./presentation-mode";
import { bundledEncounterDefinition, type ShellAction, type ShellState } from "./standard-encounter";
import { DEMO_CLEAR_EVENT, DEMO_POPULATE_EVENT } from "./demo-provenance";
import { canUseClinicalDemoDraftActions } from "./clinical-demo";
import { browserRequestConfiguration } from "./browser-api";

export interface ReportWorkspace {
  readonly restored: boolean;
  readonly recoveryNotice: string | null;
  readonly syncStatus: DraftSyncStatus;
  readonly revision: MutableRefObject<number>;
  readonly dispatchConflicts: ReadonlyArray<DispatchConflict>;
  readonly dispatchCancellation: DispatchCancellation | null;
  readonly conflictError: string | null;
  readonly flushSave: () => Promise<void>;
  readonly completeReport: () => void;
  readonly resolveConflict: (conflict: DispatchConflict, disposition: DispatchConflictDisposition) => Promise<void>;
}

/** Shared persistence and reconciliation boundary consumed by both report presentations. */
export function useReportWorkspace({
  session,
  report,
  presentationMode,
  shell,
  dispatch,
  validationErrorCount,
  onSessionEnded,
  onReportCompleted,
}: {
  readonly session: ClinicianSession;
  readonly report: ActiveDraftReport | null;
  readonly presentationMode: PresentationMode;
  readonly shell: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly validationErrorCount: number;
  readonly onSessionEnded: () => void;
  readonly onReportCompleted: () => void;
}): ReportWorkspace {
  const [restored, setRestored] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<DraftSyncStatus>("Saved");
  const [dispatchConflicts, setDispatchConflicts] = useState<ReadonlyArray<DispatchConflict>>(report?.dispatchConflicts ?? []);
  const [dispatchCancellation, setDispatchCancellation] = useState<DispatchCancellation | null>(report?.dispatchCancellation ?? null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictRecoveryRequest, setConflictRecoveryRequest] = useState(0);
  const revision = useRef(report?.revision ?? 0);
  const csrfToken = sessionRequestToken(session);
  const persistedDraft = useRef<ReturnType<typeof shellStateToDraftMutations>>({ groups: [], occurrences: [] });
  const activeEtag = useRef<string | undefined>(undefined);
  const shellRef = useRef(shell);
  const presentationRef = useRef(presentationMode);
  const skipReconciledQueue = useRef(false);
  const activeSave = useRef<Promise<void> | null>(null);
  const recoverConflictingQueue = useRef(false);
  const conflictRecoveryUsed = useRef(false);
  const skipInitialQueue = useRef(false);
  const queueInitialSnapshot = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const completed = useRef(false);
  const pendingDemoAction = useRef<"populate" | "clear" | null>(null);

  useEffect(() => { shellRef.current = shell; }, [shell]);
  useEffect(() => { presentationRef.current = presentationMode; }, [presentationMode]);

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
    conflictRecoveryUsed.current = false;
    persistedDraft.current = report?.document
      ? encounterDocumentToDraftMutations(report.id, report.document)
      : { groups: [], occurrences: [] };
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
            completeReport();
            return;
          }
          revision.current = saved.revision;
          conflictRecoveryUsed.current = false;
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
            completeReport();
            return;
          }
          if (reason === "purged") {
            completeReport();
            return;
          }
          if ((reason === "conflict" || reason === "invalid") && !conflictRecoveryUsed.current) {
            recoverConflictingQueue.current = true;
            conflictRecoveryUsed.current = true;
            activeEtag.current = undefined;
            setSyncStatus("Saving");
            requestConflictRecovery = true;
            return;
          }
          setSyncStatus(reason === "conflict" || reason === "invalid" ? "Conflict" : "Pending sync");
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
    const projected = shellStateToDraftMutations(report.id, shell, persistedDraft.current);
    const mutations = queueInitialSnapshot.current ? projected : draftMutationDelta(
      projected,
      persistedDraft.current,
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
    if (!mutations.groups.length && !mutations.occurrences.length) return;
    queueInitialSnapshot.current = false;
    const existing = nextDraftChange(window.localStorage, report.id);
    const demoAction = pendingDemoAction.current ?? existing?.command.demoAction;
    queueDraftChange(window.localStorage, report.id, {
      commandId: existing && !existing.attempted ? existing.command.commandId : crypto.randomUUID(),
      expectedRevision: expectedRevisionForNextChange(window.localStorage, report.id, revision.current),
      authorId: session.user.id,
      deviceId: `web:${presentationRef.current}:${report.id}`,
      clientTime: existing && !existing.attempted ? existing.command.clientTime : new Date().toISOString(),
      ...(demoAction ? { demoAction } : {}),
      ...mutations,
    });
    pendingDemoAction.current = null;
    queueMicrotask(() => setSyncStatus(navigator.onLine ? "Saving" : "Pending sync"));
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (navigator.onLine) saveTimer.current = window.setTimeout(() => void flushSave(), DRAFT_SAVE_DEBOUNCE_MS);
  }, [flushSave, restored, shell, report, session.user.id]);

  useEffect(() => {
    if (report) saveReportSyncStatus(window.localStorage, report.id, syncStatus);
  }, [report, syncStatus]);

  useEffect(() => {
    if (report) saveCachedValidationErrorCount(window.localStorage, report.id, validationErrorCount);
  }, [report, validationErrorCount]);

  useEffect(() => {
    const retry = () => { if (report && nextDraftChange(window.localStorage, report.id)) void flushSave(); };
    window.addEventListener("online", retry);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      window.removeEventListener("online", retry);
    };
  }, [flushSave, report]);

  useEffect(() => {
    if (!report || syncStatus !== "Pending sync") return;
    const retryTimer = window.setTimeout(() => {
      if (navigator.onLine && nextDraftChange(window.localStorage, report.id)) void flushSave();
    }, DRAFT_SYNC_RETRY_MS);
    return () => window.clearTimeout(retryTimer);
  }, [flushSave, report, syncStatus]);

  useEffect(() => {
    if (!report || !restored) return;
    let pollTimer: number | null = null;
    let stopped = false;
    const poll = async () => {
      if (stopped || document.visibilityState !== "visible" || activeSave.current) return;
      const previousEtag = activeEtag.current;
      try {
        const response = await fetchActiveReport(report.id, previousEtag);
        if (!response || stopped) return;
        activeEtag.current = response.etag || previousEtag;
        const local = shellRef.current.encounter.document;
        const queued = nextDraftChange(window.localStorage, report.id);
        const hasPending = queued !== null;
        const targets = queued ? pendingDraftTargets(queued.command, persistedDraft.current) : undefined;
        const merged = reconcileActiveReportDocument(report.id, local, response.resource.document, hasPending, targets);
        revision.current = response.resource.reportRevision;
        if (hasPending) {
          if (recoverConflictingQueue.current) {
            discardQueuedDraftChanges(window.localStorage, report.id, response.resource.reportRevision, new Date().toISOString());
            recoverConflictingQueue.current = false;
            skipReconciledQueue.current = false;
            skipInitialQueue.current = false;
            setSyncStatus("Saved");
          } else {
            rebaseQueuedDraftChanges(window.localStorage, report.id, response.resource.reportRevision);
          }
          persistedDraft.current = encounterDocumentToDraftMutations(report.id, response.resource.document);
        }
        else {
          persistedDraft.current = encounterDocumentToDraftMutations(report.id, response.resource.document);
          skipReconciledQueue.current = true;
        }
        reconcileCachedActiveReport(window.localStorage, report.id, response.resource, merged);
        setDispatchConflicts(response.resource.dispatchConflicts);
        setDispatchCancellation(response.resource.dispatchCancellation);
        dispatch({ type: "document-opened", document: merged });
      } catch (error) {
        if (!(error instanceof Error)) return;
        if (error.message === "session") onSessionEnded();
        else if (error.message === "completed") completeReport();
        else if (recoverConflictingQueue.current) setSyncStatus("Conflict");
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
  }, [completeReport, conflictRecoveryRequest, dispatch, onSessionEnded, report, restored]);

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

  return { restored, recoveryNotice, syncStatus, revision, dispatchConflicts, dispatchCancellation, conflictError, flushSave, completeReport, resolveConflict };
}
