"use client";

import type { ClinicianSession, OpenCall, ReopenOpenCallResponse } from "@open-triage/contracts";
import { useCallback, useEffect, useState } from "react";
import { fetchOpenCalls, reopenOpenCall } from "../app/assigned-calls";

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
  onReopened
}: {
  readonly session: ClinicianSession;
  readonly onReopened?: (opened: ReopenOpenCallResponse) => void;
}) {
  const [calls, setCalls] = useState<OpenCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetchOpenCalls(session.accessToken);
      setCalls(response.openCalls);
      setLoaded(true);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Open calls could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }, [session.accessToken]);

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
    queueMicrotask(() => void refresh());
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
