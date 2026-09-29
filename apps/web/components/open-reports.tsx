"use client";

import type {
  ClinicianSession,
  OpenCall as OpenReportSummary,
  ReopenOpenCallResponse as ReopenOpenReportResponse,
} from "@open-triage/contracts";
import { useAgencyTimeZone } from "../app/agency-time-zone";
import { formatClinicalDate, formatClinicalNumber, useRegionalFormat } from "../app/regional-format";
import { reauthenticateClinicianSession, sessionRequestToken } from "../app/clinician-session";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  fetchOpenCalls as fetchOpenReports,
  reopenOpenCall as reopenOpenReport,
} from "../app/assigned-calls";
import { browserRequestConfiguration } from "../app/browser-api";
import { sameJsonValue } from "../app/json-values";
import { RecoveryReauthenticationGate } from "../app/recovery-reauthentication-gate";
import { saveDraftReport } from "../app/draft-report";
import { clearShellState, purgeCompletedReportCaches } from "../app/local-persistence";
import {
  acceptDraftChange,
  cacheOpenCallSummary as cacheOpenReportSummary,
  cacheReopenedReport,
  cachedOpenCalls as cachedOpenReportSummaries,
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
import { LoadingStatus } from "./loading-status";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import {
  flushProtectedReport,
  prepareProtectedReport,
  recoverProtectedReport,
  RecoveryReauthenticationRequiredError,
} from "../app/protected-clinical-storage";

function savedTime(value: string, region: ReturnType<typeof useRegionalFormat>, zone: string | null): string {
  return formatClinicalDate(value, region, undefined, zone);
}
export function OpenReports({
  session,
  language,
  activeReportId,
  onCompleted,
  onReopened,
  onSessionEnded,
  refreshRequest = 0,
  paused = false,
}: {
  readonly paused?: boolean;
  readonly session: ClinicianSession;
  readonly language: AgencyLanguage;
  readonly activeReportId?: string;
  readonly onCompleted?: (reportId: string) => void;
  readonly onReopened?: (opened: ReopenOpenReportResponse) => void;
  readonly onSessionEnded?: () => void;
  readonly refreshRequest?: number;
}) {
  const region = useRegionalFormat();
  const zone = useAgencyTimeZone();
  const [reports, setReports] = useState<OpenReportSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reauthenticationId, setReauthenticationId] = useState<string | null>(null);
  const [reauthenticating, setReauthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reportsRef = useRef<OpenReportSummary[]>([]);
  const syncingCachedReports = useRef(false);
  const refreshing = useRef(false);
  const pauseEpoch = useRef(0);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; pauseEpoch.current += 1; }, [paused]);
  const recoveryReauthentication = useRef(new RecoveryReauthenticationGate());
  const handledRefreshRequest = useRef(refreshRequest);
  const csrfToken = sessionRequestToken(session);
  const t = useCallback((key: string, params?: Record<string, string | number>) => resolveMessage(language, key, params), [language]);
  const showReports = useCallback((next: OpenReportSummary[]) => {
    if (sameJsonValue(reportsRef.current, next)) return;
    reportsRef.current = next;
    setReports(next);
  }, []);

  const syncCachedReports = useCallback(async () => {
    if (pausedRef.current || activeReportId || syncingCachedReports.current) return;
    syncingCachedReports.current = true;
    try {
      purgeExpiredOfflineReports(window.localStorage).forEach((reportId) => clearShellState(window.localStorage, reportId));
      for (const cached of cachedOpenReportSummaries(window.localStorage, session.user.id)) {
        while (true) {
          const queued = nextDraftChange(window.localStorage, cached.reportId);
          if (!queued) break;
          markDraftChangeAttempted(window.localStorage, cached.reportId, queued.command.commandId);
          try {
            const saved = await saveDraftReport(csrfToken, cached.reportId, queued.command);
            if (saved.status === "signed") {
              acceptDraftChange(window.localStorage, cached.reportId, queued.command.commandId, saved);
              if (!nextDraftChange(window.localStorage, cached.reportId)) {
                clearShellState(window.localStorage, cached.reportId);
                removeSignedOfflineReport(window.localStorage, cached.reportId);
                reportsRef.current = reportsRef.current.filter((report) => report.reportId !== cached.reportId);
                setReports(reportsRef.current);
                break;
              }
              continue;
            }
            acceptDraftChange(window.localStorage, cached.reportId, queued.command.commandId, saved);
          } catch (syncError) {
            if (syncError instanceof Error && syncError.message === "session") onSessionEnded?.();
            if (syncError instanceof Error && syncError.message === "purged") {
              clearShellState(window.localStorage, cached.reportId);
              removeSignedOfflineReport(window.localStorage, cached.reportId);
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
    if (pausedRef.current || refreshing.current) return;
    const epoch = pauseEpoch.current;
    refreshing.current = true;
    try {
      purgeExpiredOfflineReports(window.localStorage).forEach((reportId) => clearShellState(window.localStorage, reportId));
      const response = await fetchOpenReports();
      if (pausedRef.current || pauseEpoch.current !== epoch) return;
      const completedReportIds = response.completedReportIds ?? [];
      const completedIds = new Set(completedReportIds);
      const removed = reportsRef.current.filter((report) => completedIds.has(report.reportId));
      for (const reportId of completedReportIds) {
        if (!recoveryReauthentication.current.shouldAttempt(reportId)) continue;
        if (cachedOpenReportSummaries(window.localStorage, session.user.id).some((cached) => cached.reportId === reportId)) continue;
        try {
          const recovered = await recoverProtectedReport(csrfToken, reportId, {
            onNoRetainedWork: () => recoveryReauthentication.current.checked(reportId),
          });
          if (recovered && restoreRecoveredReport(window.localStorage, session.user.id, reportId, recovered)) {
            recoveryReauthentication.current.checked(reportId);
          }
        } catch (recoveryError) {
          if (!(recoveryError instanceof RecoveryReauthenticationRequiredError)) throw recoveryError;
          recoveryReauthentication.current.requireReauthentication(reportId);
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
      showReports(visible);
      setLoaded(true);
      setError(null);
      await syncCachedReports();
      purgeCompletedOfflineReports(window.localStorage, completedReportIds);
      const syncedVisible = (browserRequestConfiguration().mode === "server"
        ? cachedOpenReportSummaries(window.localStorage, session.user.id)
        : response.openCalls).filter((report) => !completedIds.has(report.reportId));
      showReports(syncedVisible);
      if (!activeReportId && removed.length > 0) setNotice(removed.length === 1
        ? t("reports.completedOne", { call: removed[0]!.callNumber })
        : t("reports.completedMany", { count: removed.length }));
      if (activeReportId && completedIds.has(activeReportId)
          && !nextDraftChange(window.localStorage, activeReportId)) onCompleted?.(activeReportId);
    } catch (refreshError) {
      if (pausedRef.current || pauseEpoch.current !== epoch) return;
      if (refreshError instanceof Error && refreshError.message === "Your shift session has ended.") {
        onSessionEnded?.();
        return;
      }
      const cached = cachedOpenReportSummaries(window.localStorage, session.user.id);
      showReports(cached);
      setLoaded(true);
      setError(cached.length ? null : refreshError instanceof Error ? refreshError.message : t("reports.refreshFailed"));
    } finally {
      refreshing.current = false;
    }
  }, [activeReportId, csrfToken, onCompleted, onSessionEnded, session, showReports, syncCachedReports, t]);

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
      setError(reopenError instanceof Error ? reopenError.message : t("reports.reopenFailed"));
    } finally {
      setReopeningId(null);
    }
  }, [csrfToken, onReopened, session, t]);

  const reauthenticateAndReopen = useCallback(async (event: FormEvent<HTMLFormElement>, report: OpenReportSummary) => {
    event.preventDefault();
    setReauthenticating(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get("currentPassword") ?? "");
    try {
      await reauthenticateClinicianSession(password, csrfToken);
      recoveryReauthentication.current.reauthenticated();
      setReauthenticationId(null);
      await reopen(report);
    } catch (reauthenticationError) {
      setError(reauthenticationError instanceof Error ? reauthenticationError.message : t("reports.reauthFailed"));
    } finally {
      setReauthenticating(false);
    }
  }, [csrfToken, reopen, t]);

  useEffect(() => {
    if (paused) return;
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
  }, [refresh, session.user.id, paused]);

  useEffect(() => {
    if (handledRefreshRequest.current === refreshRequest) return;
    handledRefreshRequest.current = refreshRequest;
    void refresh();
  }, [refresh, refreshRequest]);

  return (
    <section className="assigned-calls open-reports" aria-labelledby="open-reports-title">
      <div className="assigned-calls-heading">
        <div>
          <p className="eyebrow">{t("reports.yourDocumentation")}</p>
          <h1 id="open-reports-title">{t("reports.openReports")}</h1>
        </div>
      </div>
      <TransientNotice message={notice} onDismiss={() => setNotice(null)} />
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <LoadingStatus className="assignment-empty">{t("reports.loading")}</LoadingStatus>}
      {loaded && reports.length === 0 && <p className="assignment-empty">{t("reports.none")}</p>}
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
                <span>{report.syncStatus === "pending" ? t("reports.pending") : t("reports.saved")}</span>
              </div>
              <dl>
                <div><dt>{t("calls.priority")}</dt><dd>{report.dispatchPriority?.display ?? t("calls.notProvided")}</dd></div>
                <div><dt>{t("reports.lastSaved")}</dt><dd><time dateTime={report.lastSavedAt}>{savedTime(report.lastSavedAt, region, zone)}</time></dd></div>
                <div><dt>{t("reports.savedChecks")}</dt><dd>{t("reports.reviewBeforeSigning", { count: formatClinicalNumber(report.validationErrorCount, region) })}</dd></div>
              </dl>
              <button type="button" onClick={() => void reopen(report)} disabled={reopeningId !== null}>
                {reopeningId === report.reportId ? t("reports.reopening") : t("reports.reopen")}
              </button>
              {reauthenticationId === report.reportId && <form className="report-reauthentication"
                onSubmit={(event) => void reauthenticateAndReopen(event, report)}>
                <p>{t("reports.reauthHelp")}</p>
                <label>{t("reports.currentPassword")}<input name="currentPassword" type="password"
                  autoComplete="current-password" required /></label>
                <button type="submit" disabled={reauthenticating}>
                  {reauthenticating ? t("reports.confirming") : t("reports.confirmRecover")}
                </button>
              </form>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
