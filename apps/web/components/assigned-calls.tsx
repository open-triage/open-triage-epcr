"use client";

import type { AssignedCall, ClinicianSession, OpenAssignmentResponse } from "@open-triage/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  fetchAssignedCalls,
  canceledAssignedCalls,
  openAssignedCall
} from "../app/assigned-calls";

function dispatchTime(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone ?? "America/New_York",
  }).format(new Date(value));
}

export function AssignedCalls({
  session,
  onOpened,
  refreshRequest = 0,
}: {
  readonly session: ClinicianSession;
  readonly onOpened?: (opened: OpenAssignmentResponse, call: AssignedCall) => void;
  readonly refreshRequest?: number;
}) {
  const [calls, setCalls] = useState<AssignedCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const callsRef = useRef<AssignedCall[]>([]);
  const noticeTimer = useRef<number | null>(null);
  const handledRefreshRequest = useRef(refreshRequest);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchAssignedCalls(session.accessToken);
      const removed = canceledAssignedCalls(callsRef.current, response.assignedCalls, response.canceledAssignmentIds);
      callsRef.current = response.assignedCalls;
      setCalls(response.assignedCalls);
      setLoaded(true);
      setError(null);
      if (removed.length > 0) {
        setNotice(`${removed.length === 1 ? `Call ${removed[0]!.callNumber}` : `${removed.length} calls`} assignment canceled.`);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 5_000);
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Assigned calls could not be refreshed.");
    }
  }, [session.accessToken]);

  const open = useCallback(async (call: AssignedCall) => {
    setOpeningId(call.id);
    setError(null);
    try {
      const opened = await openAssignedCall(session.accessToken, call.id);
      const nextCalls = callsRef.current.filter((candidate) => candidate.id !== call.id);
      if (opened.replacementAssignment && !nextCalls.some((candidate) => candidate.id === opened.replacementAssignment!.id)) {
        nextCalls.unshift(opened.replacementAssignment);
      }
      callsRef.current = nextCalls;
      setCalls(nextCalls);
      onOpened?.(opened, call);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The call could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }, [onOpened, session.accessToken]);

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
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (handledRefreshRequest.current === refreshRequest) return;
    handledRefreshRequest.current = refreshRequest;
    void refresh();
  }, [refresh, refreshRequest]);

  return (
    <section className="assigned-calls" aria-labelledby="assigned-calls-title">
      <div className="assigned-calls-heading">
        <div>
          <p className="eyebrow">Demo unit</p>
          <h1 id="assigned-calls-title">Assigned calls</h1>
        </div>
      </div>
      {notice && <p className="assignment-notice" role="status">{notice}</p>}
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <p className="assignment-empty">Loading assigned calls…</p>}
      {loaded && calls.length === 0 && <p className="assignment-empty">No calls are currently assigned.</p>}
      {calls.length > 0 && (
        <ul className="assigned-call-list">
          {calls.map((call) => (
            <li key={call.id} className="assigned-call-card">
              <div className="assigned-call-title">
                <strong>{call.callNumber}</strong>
                <span>{call.status}</span>
              </div>
              <p>{call.dispatchReason || "Dispatch reason not provided"}</p>
              <dl>
                <div><dt>Unit</dt><dd>{call.unit.callSign}</dd></div>
                <div><dt>Unit notified</dt><dd><time dateTime={call.dispatchedAt}>{dispatchTime(call.dispatchedAt, call.agencyTimeZone)}</time></dd></div>
              </dl>
              <button type="button" onClick={() => void open(call)} disabled={openingId !== null}>
                {openingId === call.id ? "Opening…" : "Open call"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
