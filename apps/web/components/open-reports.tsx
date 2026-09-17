"use client";

import type {
  ClinicianSession,
  OpenCall as OpenReportSummary,
  ReopenOpenCallResponse as ReopenOpenReportResponse,
} from "@open-triage/contracts";
import { reauthenticateClinicianSession, sessionRequestToken } from "../app/clinician-session";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  fetchOpenCalls as fetchOpenReports,
  reopenOpenCall as reopenOpenReport,
} from "../app/assigned-calls";
import { browserRequestConfiguration } from "../app/browser-api";
import { saveDraftReport } from "../app/draft-report";
import { clearShellState, purgeCompletedReportCaches } from "../app/local-persistence";
import {
  acceptDraftChange,
  cacheOpenCallSummary as cacheOpenReportSummary,
  cacheReopenedReport,
  cachedOpenCalls as cachedOpenReportSummaries,
  cachedOpenReports,
  cachedReopenResponse,
  markDraftChangeAttempted,
  nextDraftChange,
  purgeCompletedOfflineReports,
  purgeExpiredOfflineReports,
  reconcileServerOpenReports,
  removeSignedOfflineReport,
  restoreRecoveredReport,
} from "../app/offline-reports";
import { TransientNotice } from "./transient-notice";
import {
  flushProtectedReport,
  prepareProtectedReport,
  recoverProtectedReport,
  RecoveryReauthenticationRequiredError,
} from "../app/protected-clinical-storage";

function savedTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function OpenReports({
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
  readonly onReopened?: (opened: ReopenOpenReportResponse) => void;
  readonly onSessionEnded?: () => void;
  readonly refreshRequest?: number;
}) {
  const [reports, setReports] = useState<OpenReportSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reauthenticationId, setReauthenticationId] = useState<string | null>(null);
  const [reauthenticating, setReauthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reportsRef = useRef<OpenReportSummary[]>([]);
  const syncingCachedReports = useRef(false);
  const handledRefreshRequest = useRef(refreshRequest);
  const csrfToken = sessionRequestToken(session);

  const syncCachedReports = useCallback(async () => {
    if (activeReportId || syncingCachedReports.current) return;
    syncingCachedReports.current = true;
    try {
      purgeExpiredOfflineReports(window.localStorage).forEach((reportId) => clearShellState(window.localStorage, reportId));
      for (const cached of cachedOpenReports(window.localStorage, session.user.id)) {
        while (true) {
          const queued = nextDraftChange(window.localStorage, cached.report.id);
          if (!queued) break;
          markDraftChangeAttempted(window.localStorage, cached.report.id, queued.command.commandId);
          try {
            const saved = await saveDraftReport(csrfToken, cached.report.id, queued.command);
            if (saved.status === "signed") {
              acceptDraftChange(window.localStorage, cached.report.id, queued.command.commandId, saved);
              if (!nextDraftChange(window.localStorage, cached.report.id)) {
                clearShellState(window.localStorage, cached.report.id);
                removeSignedOfflineReport(window.localStorage, cached.report.id);
                reportsRef.current = reportsRef.current.filter((report) => report.reportId !== cached.report.id);
                setReports(reportsRef.current);
                break;
              }
              continue;
            }
            acceptDraftChange(window.localStorage, cached.report.id, queued.command.commandId, saved);
          } catch (syncError) {
            if (syncError instanceof Error && syncError.message === "session") onSessionEnded?.();
            if (syncError instanceof Error && syncError.message === "purged") {
              clearShellState(window.localStorage, cached.report.id);
              removeSignedOfflineReport(window.localStorage, cached.report.id);
            }
            break;
          }
        }
      }
    } finally {
      syncingCachedReports.current = false;
    }
  }, [activeReportId, csrfToken, onSessionEnded, session.user.id]);

  const refresh = useCallback(async () => {
    try {
      purgeExpiredOfflineReports(window.localStorage).forEach((reportId) => clearShellState(window.localStorage, reportId));
      const response = await fetchOpenReports();
      const completedReportIds = response.completedReportIds ?? [];
      const completedIds = new Set(completedReportIds);
      const removed = reportsRef.current.filter((report) => completedIds.has(report.reportId));
      for (const reportId of completedReportIds) {
        if (cachedOpenReports(window.localStorage, session.user.id).some((cached) => cached.report.id === reportId)) continue;
        try {
          const recovered = await recoverProtectedReport(csrfToken, reportId);
          if (recovered) restoreRecoveredReport(window.localStorage, session.user.id, reportId, recovered);
        } catch (recoveryError) {
          if (!(recoveryError instanceof RecoveryReauthenticationRequiredError)) throw recoveryError;
        }
      }
      purgeCompletedReportCaches(window.localStorage, completedReportIds);
      purgeCompletedOfflineReports(window.localStorage, completedReportIds);
      response.openCalls.forEach((report) => cacheOpenReportSummary(window.localStorage, session, report));
      if (browserRequestConfiguration().mode === "server") {
        reconcileServerOpenReports(
          window.localStorage,
          session.user.id,
          response.openCalls.map(({ reportId }) => reportId),
        ).forEach((reportId) => clearShellState(window.localStorage, reportId));
      }
      const visible = (browserRequestConfiguration().mode === "server"
        ? cachedOpenReportSummaries(window.localStorage, session.user.id)
        : response.openCalls).filter((report) => !completedIds.has(report.reportId));
      reportsRef.current = visible;
      setReports(visible);
      setLoaded(true);
      setError(null);
      await syncCachedReports();
      purgeCompletedOfflineReports(window.localStorage, completedReportIds);
      const syncedVisible = (browserRequestConfiguration().mode === "server"
        ? cachedOpenReportSummaries(window.localStorage, session.user.id)
        : response.openCalls).filter((report) => !completedIds.has(report.reportId));
      reportsRef.current = syncedVisible;
      setReports(syncedVisible);
      if (!activeReportId && removed.length > 0) setNotice(removed.length === 1
        ? `Call ${removed[0]!.callNumber} was completed on the stationary interface.`
        : `${removed.length} calls were completed on the stationary interface.`);
      if (activeReportId && completedIds.has(activeReportId)
          && !nextDraftChange(window.localStorage, activeReportId)) onCompleted?.(activeReportId);
    } catch (refreshError) {
      if (refreshError instanceof Error && refreshError.message === "Your shift session has ended.") {
        onSessionEnded?.();
        return;
      }
      const cached = cachedOpenReportSummaries(window.localStorage, session.user.id);
      setReports(cached);
      setLoaded(true);
      setError(cached.length ? null : refreshError instanceof Error ? refreshError.message : "Open reports could not be refreshed.");
    }
  }, [activeReportId, csrfToken, onCompleted, onSessionEnded, session, syncCachedReports]);

  const reopen = useCallback(async (report: OpenReportSummary) => {
    setReopeningId(report.reportId);
    setError(null);
    try {
      let opened: ReopenOpenReportResponse;
      try {
        opened = await reopenOpenReport(csrfToken, report.reportId);
        const recovered = await recoverProtectedReport(csrfToken, report.reportId);
        if (recovered) restoreRecoveredReport(window.localStorage, session.user.id, report.reportId, recovered);
        else await prepareProtectedReport(csrfToken, report.reportId);
        cacheReopenedReport(window.localStorage, session, opened);
        await flushProtectedReport(report.reportId);
      } catch (error) {
        if (error instanceof RecoveryReauthenticationRequiredError) throw error;
        const cached = cachedReopenResponse(window.localStorage, session.user.id, report.reportId);
        if (!cached) throw error;
        opened = cached;
      }
      setReauthenticationId(null);
      onReopened?.(opened);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (reopenError) {
      if (reopenError instanceof RecoveryReauthenticationRequiredError) {
        setReauthenticationId(report.reportId);
        return;
      }
      setError(reopenError instanceof Error ? reopenError.message : "The report could not be reopened.");
    } finally {
      setReopeningId(null);
    }
  }, [csrfToken, onReopened, session]);

  const reauthenticateAndReopen = useCallback(async (event: FormEvent<HTMLFormElement>, report: OpenReportSummary) => {
    event.preventDefault();
    setReauthenticating(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get("currentPassword") ?? "");
    try {
      await reauthenticateClinicianSession(password, csrfToken);
      setReauthenticationId(null);
      await reopen(report);
    } catch (reauthenticationError) {
      setError(reauthenticationError instanceof Error ? reauthenticationError.message : "Reauthentication failed.");
    } finally {
      setReauthenticating(false);
    }
  }, [csrfToken, reopen]);

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
      const cached = cachedOpenReportSummaries(window.localStorage, session.user.id);
      if (cached.length) {
        reportsRef.current = cached;
        setReports(cached);
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
    <section className="assigned-calls open-reports" aria-labelledby="open-reports-title">
      <div className="assigned-calls-heading">
        <div>
          <p className="eyebrow">Your documentation</p>
          <h1 id="open-reports-title">Open reports</h1>
        </div>
      </div>
      <TransientNotice message={notice} onDismiss={() => setNotice(null)} />
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <p className="assignment-empty">Loading open reports…</p>}
      {loaded && reports.length === 0 && <p className="assignment-empty">You have no open reports.</p>}
      {reports.length > 0 && (
        <ul className="assigned-call-list">
          {reports.map((report) => (
            <li
              key={report.reportId}
              className={`assigned-call-card open-report-card validation-${report.validationErrorCount > 0 ? "error" : "clear"}`}
              data-validation-status={report.validationErrorCount > 0 ? "error" : "clear"}
            >
              <div className="assigned-call-title">
                <strong>{report.callNumber}</strong>
                <span>{report.syncStatus === "pending" ? "Pending sync" : "Saved"}</span>
              </div>
              <dl>
                <div><dt>Priority</dt><dd>{report.dispatchPriority?.display ?? "Not provided"}</dd></div>
                <div><dt>Last saved</dt><dd><time dateTime={report.lastSavedAt}>{savedTime(report.lastSavedAt)}</time></dd></div>
                <div><dt>Validation errors</dt><dd>{report.validationErrorCount}</dd></div>
              </dl>
              <button type="button" onClick={() => void reopen(report)} disabled={reopeningId !== null}>
                {reopeningId === report.reportId ? "Reopening…" : "Reopen report"}
              </button>
              {reauthenticationId === report.reportId && <form className="report-reauthentication"
                onSubmit={(event) => void reauthenticateAndReopen(event, report)}>
                <p>Confirm your password to recover protected work from this browser.</p>
                <label>Current password<input name="currentPassword" type="password"
                  autoComplete="current-password" required /></label>
                <button type="submit" disabled={reauthenticating}>
                  {reauthenticating ? "Confirming…" : "Confirm and recover"}
                </button>
              </form>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
