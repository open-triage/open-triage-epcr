"use client";

import type { ClinicianSession, OpenCall, ReopenOpenCallResponse } from "@open-triage/contracts";
import { sessionRequestToken } from "../app/clinician-session";
import { useCallback, useEffect, useRef, useState } from "react";
import { ASSIGNED_CALL_POLL_INTERVAL_MS, fetchOpenCalls, reopenOpenCall } from "../app/assigned-calls";
import { saveDraftReport } from "../app/draft-report";
import { clearShellState, purgeCompletedReportCaches } from "../app/local-persistence";
import {
  acceptDraftChange,
  cacheOpenCallSummary,
  cacheReopenedReport,
  cachedOpenCalls,
  cachedOpenReports,
  cachedReopenResponse,
  discardQueuedDraftChanges,
  markDraftChangeAttempted,
  nextDraftChange,
  purgeCompletedOfflineReports,
  removeSignedOfflineReport,
} from "../app/offline-reports";

const CLEARED_PENDING_REPORT_ID = "568e1a08-ed1e-4eb9-8dbf-3d5cbb56c386";
const CLEARED_PENDING_REPORT_REVISION = 43;
const CLEARED_PENDING_REPORT_SAVED_AT = "2026-09-03T15:35:42.682Z";
const PENDING_CLEARANCE_KEY = `open-triage:pending-sync-clear:${CLEARED_PENDING_REPORT_ID}:v2`;

function clearRequestedPendingReport(storage: Storage): void {
  if (storage.getItem(PENDING_CLEARANCE_KEY) || !nextDraftChange(storage, CLEARED_PENDING_REPORT_ID)) return;
  discardQueuedDraftChanges(
    storage,
    CLEARED_PENDING_REPORT_ID,
    CLEARED_PENDING_REPORT_REVISION,
    CLEARED_PENDING_REPORT_SAVED_AT,
  );
  storage.setItem(PENDING_CLEARANCE_KEY, "cleared");
}

function savedTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function OpenCalls({
  session,
  activeReportId,
  onCompleted,
  onReopened,
  onSessionEnded,
  refreshRequest = 0,
}: {
  readonly session: ClinicianSession;
  readonly activeReportId?: string;
  readonly onCompleted?: (reportId: string) => void;
  readonly onReopened?: (opened: ReopenOpenCallResponse) => void;
  readonly onSessionEnded?: () => void;
  readonly refreshRequest?: number;
}) {
  const [calls, setCalls] = useState<OpenCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const callsRef = useRef<OpenCall[]>([]);
  const syncingCachedReports = useRef(false);
  const handledRefreshRequest = useRef(refreshRequest);

  const syncCachedReports = useCallback(async () => {
    if (activeReportId || syncingCachedReports.current) return;
    syncingCachedReports.current = true;
    try {
      for (const cached of cachedOpenReports(window.localStorage, session.user.id)) {
        while (true) {
          const queued = nextDraftChange(window.localStorage, cached.report.id);
          if (!queued) break;
          markDraftChangeAttempted(window.localStorage, cached.report.id, queued.command.commandId);
          try {
            const saved = await saveDraftReport(sessionRequestToken(session), cached.report.id, queued.command);
            if (saved.status === "signed") {
              clearShellState(window.localStorage, cached.report.id);
              removeSignedOfflineReport(window.localStorage, cached.report.id);
              callsRef.current = callsRef.current.filter((call) => call.reportId !== cached.report.id);
              setCalls(callsRef.current);
              break;
            }
            acceptDraftChange(window.localStorage, cached.report.id, queued.command.commandId, saved);
          } catch (syncError) {
            if (syncError instanceof Error && syncError.message === "session") onSessionEnded?.();
            break;
          }
        }
      }
    } finally {
      syncingCachedReports.current = false;
    }
  }, [activeReportId, onSessionEnded, session.accessToken, session.user.id]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchOpenCalls(sessionRequestToken(session));
      const completedReportIds = response.completedReportIds ?? [];
      const completedIds = new Set(completedReportIds);
      const removed = callsRef.current.filter((call) => completedIds.has(call.reportId));
      purgeCompletedReportCaches(window.localStorage, completedReportIds);
      purgeCompletedOfflineReports(window.localStorage, completedReportIds);
      response.openCalls.forEach((call) => cacheOpenCallSummary(window.localStorage, session, call));
      const visible = cachedOpenCalls(window.localStorage, session.user.id).filter((call) => !completedIds.has(call.reportId));
      callsRef.current = visible;
      setCalls(visible);
      setLoaded(true);
      setError(null);
      await syncCachedReports();
      purgeCompletedOfflineReports(window.localStorage, completedReportIds);
      const syncedVisible = cachedOpenCalls(window.localStorage, session.user.id).filter((call) => !completedIds.has(call.reportId));
      callsRef.current = syncedVisible;
      setCalls(syncedVisible);
      if (!activeReportId && removed.length > 0) setNotice(removed.length === 1
        ? `Call ${removed[0]!.callNumber} was completed on the stationary interface.`
        : `${removed.length} calls were completed on the stationary interface.`);
      if (activeReportId && completedIds.has(activeReportId)) onCompleted?.(activeReportId);
    } catch (refreshError) {
      if (refreshError instanceof Error && refreshError.message === "Your shift session has ended.") {
        onSessionEnded?.();
        return;
      }
      const cached = cachedOpenCalls(window.localStorage, session.user.id);
      setCalls(cached);
      setLoaded(true);
      setError(cached.length ? null : refreshError instanceof Error ? refreshError.message : "Open calls could not be refreshed.");
    }
  }, [activeReportId, onCompleted, onSessionEnded, session, syncCachedReports]);

  const reopen = useCallback(async (call: OpenCall) => {
    setReopeningId(call.reportId);
    setError(null);
    try {
      let opened: ReopenOpenCallResponse;
      try {
        opened = await reopenOpenCall(sessionRequestToken(session), call.reportId);
        cacheReopenedReport(window.localStorage, session, opened);
      } catch (error) {
        const cached = cachedReopenResponse(window.localStorage, session.user.id, call.reportId);
        if (!cached) throw error;
        opened = cached;
      }
      onReopened?.(opened);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "The report could not be reopened.");
    } finally {
      setReopeningId(null);
    }
  }, [onReopened, session]);

  useEffect(() => {
    let pollTimer: number | null = null;
    const startOrPausePolling = () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = document.visibilityState === "visible"
        ? window.setInterval(() => void refresh(), ASSIGNED_CALL_POLL_INTERVAL_MS)
        : null;
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") void refresh();
      startOrPausePolling();
    };
    queueMicrotask(() => {
      clearRequestedPendingReport(window.localStorage);
      const cached = cachedOpenCalls(window.localStorage, session.user.id);
      if (cached.length) {
        callsRef.current = cached;
        setCalls(cached);
        setLoaded(true);
      }
      void refresh();
    });
    startOrPausePolling();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh, session.user.id]);

  useEffect(() => {
    if (handledRefreshRequest.current === refreshRequest) return;
    handledRefreshRequest.current = refreshRequest;
    void refresh();
  }, [refresh, refreshRequest]);

  return (
    <section className="assigned-calls open-calls" aria-labelledby="open-calls-title">
      <div className="assigned-calls-heading">
        <div>
          <p className="eyebrow">Your documentation</p>
          <h1 id="open-calls-title">Open calls</h1>
        </div>
      </div>
      {notice && <p className="assignment-notice" role="status">{notice}</p>}
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <p className="assignment-empty">Loading open calls…</p>}
      {loaded && calls.length === 0 && <p className="assignment-empty">You have no open calls.</p>}
      {calls.length > 0 && (
        <ul className="assigned-call-list">
          {calls.map((call) => (
            <li
              key={call.reportId}
              className={`assigned-call-card open-call-card validation-${call.validationErrorCount > 0 ? "error" : "clear"}`}
              data-validation-status={call.validationErrorCount > 0 ? "error" : "clear"}
            >
              <div className="assigned-call-title">
                <strong>{call.callNumber}</strong>
                <span>{call.syncStatus === "pending" ? "Pending sync" : "Saved"}</span>
              </div>
              <dl>
                <div><dt>Priority</dt><dd>{call.dispatchPriority?.display ?? "Not provided"}</dd></div>
                <div><dt>Last saved</dt><dd><time dateTime={call.lastSavedAt}>{savedTime(call.lastSavedAt)}</time></dd></div>
                <div><dt>Validation errors</dt><dd>{call.validationErrorCount}</dd></div>
              </dl>
              <button type="button" onClick={() => void reopen(call)} disabled={reopeningId !== null}>
                {reopeningId === call.reportId ? "Reopening…" : "Reopen call"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
