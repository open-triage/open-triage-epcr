"use client";

import type { ClinicianSession, OpenCall, ReopenOpenCallResponse } from "@open-triage/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ASSIGNED_CALL_POLL_INTERVAL_MS, fetchOpenCalls, reopenOpenCall } from "../app/assigned-calls";
import { purgeCompletedReportCaches } from "../app/local-persistence";

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
  onReopened
}: {
  readonly session: ClinicianSession;
  readonly activeReportId?: string;
  readonly onCompleted?: (reportId: string) => void;
  readonly onReopened?: (opened: ReopenOpenCallResponse) => void;
}) {
  const [calls, setCalls] = useState<OpenCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const callsRef = useRef<OpenCall[]>([]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetchOpenCalls(session.accessToken);
      const completedReportIds = response.completedReportIds ?? [];
      const completedIds = new Set(completedReportIds);
      const removed = callsRef.current.filter((call) => completedIds.has(call.reportId));
      purgeCompletedReportCaches(window.localStorage, completedReportIds);
      callsRef.current = response.openCalls;
      setCalls(response.openCalls);
      setLoaded(true);
      setError(null);
      if (removed.length > 0) setNotice(removed.length === 1
        ? `Call ${removed[0]!.callNumber} was completed on the stationary interface.`
        : `${removed.length} calls were completed on the stationary interface.`);
      if (activeReportId && completedIds.has(activeReportId)) onCompleted?.(activeReportId);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Open calls could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }, [activeReportId, onCompleted, session.accessToken]);

  const reopen = useCallback(async (call: OpenCall) => {
    setReopeningId(call.reportId);
    setError(null);
    try {
      const opened = await reopenOpenCall(session.accessToken, call.reportId);
      onReopened?.(opened);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "The report could not be reopened.");
    } finally {
      setReopeningId(null);
    }
  }, [onReopened, session.accessToken]);

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
    queueMicrotask(() => void refresh());
    startOrPausePolling();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);

  return (
    <section className="assigned-calls open-calls" aria-labelledby="open-calls-title">
      <div className="assigned-calls-heading">
        <div>
          <p className="eyebrow">Your documentation</p>
          <h1 id="open-calls-title">Open calls</h1>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {notice && <p className="assignment-notice" role="status">{notice}</p>}
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <p className="assignment-empty">Loading open calls…</p>}
      {loaded && calls.length === 0 && <p className="assignment-empty">You have no open calls.</p>}
      {calls.length > 0 && (
        <ul className="assigned-call-list">
          {calls.map((call) => (
            <li key={call.reportId} className="assigned-call-card open-call-card">
              <div className="assigned-call-title">
                <strong>{call.callNumber}</strong>
                <span>{call.syncStatus}</span>
              </div>
              <dl>
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
