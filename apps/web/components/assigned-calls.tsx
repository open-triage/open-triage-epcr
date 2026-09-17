"use client";

import type { AssignedCall, ClinicianSession, OpenAssignmentResponse } from "@open-triage/contracts";
import { sessionRequestToken } from "../app/clinician-session";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  fetchAssignedCalls,
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
  suppressedCallNumbers = [],
  focusAssignmentId = null,
}: {
  readonly session: ClinicianSession;
  readonly onOpened?: (opened: OpenAssignmentResponse, call: AssignedCall) => void | Promise<void>;
  readonly refreshRequest?: number;
  readonly suppressedCallNumbers?: ReadonlyArray<string>;
  readonly focusAssignmentId?: string | null;
}) {
  const [calls, setCalls] = useState<AssignedCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const callsRef = useRef<AssignedCall[]>([]);
  const handledRefreshRequest = useRef(refreshRequest);
  const csrfToken = sessionRequestToken(session);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchAssignedCalls();
      const visible = response.assignedCalls.filter((call) => !suppressedCallNumbers.includes(call.callNumber));
      callsRef.current = visible;
      setCalls(visible);
      setLoaded(true);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Assigned calls could not be refreshed.");
    }
  }, [suppressedCallNumbers]);

  const open = useCallback(async (call: AssignedCall) => {
    setOpeningId(call.id);
    setError(null);
    try {
      const opened = await openAssignedCall(csrfToken, call.id);
      const nextCalls = callsRef.current.filter((candidate) => candidate.id !== call.id);
      if (opened.replacementAssignment && !nextCalls.some((candidate) => candidate.id === opened.replacementAssignment!.id)) {
        nextCalls.unshift(opened.replacementAssignment);
      }
      callsRef.current = nextCalls;
      setCalls(nextCalls);
      await onOpened?.(opened, call);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The call could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }, [csrfToken, onOpened]);

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

  useEffect(() => {
    if (handledRefreshRequest.current === refreshRequest) return;
    handledRefreshRequest.current = refreshRequest;
    void refresh();
  }, [refresh, refreshRequest]);

  useEffect(() => {
    if (!focusAssignmentId || !calls.some(({ id }) => id === focusAssignmentId)) return;
    const card = document.querySelector<HTMLElement>(`[data-assignment-id="${CSS.escape(focusAssignmentId)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [calls, focusAssignmentId]);

  return (
    <section className="assigned-calls" aria-labelledby="assigned-calls-title">
      <div className="assigned-calls-heading">
        <div>
          <p className="eyebrow">Demo unit</p>
          <h1 id="assigned-calls-title">Assigned calls</h1>
        </div>
      </div>
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <p className="assignment-empty">Loading assigned calls…</p>}
      {loaded && calls.length === 0 && <p className="assignment-empty">No calls are currently assigned.</p>}
      {calls.length > 0 && (
        <ul className="assigned-call-list">
          {calls.map((call) => (
            <li key={call.id} className="assigned-call-card" data-assignment-id={call.id}>
              <div className="assigned-call-title">
                <strong>{call.callNumber}</strong>
                <span>{call.status}</span>
              </div>
              <p>{call.dispatchReason || "Dispatch reason not provided"}</p>
              <dl>
                <div><dt>Unit</dt><dd>{call.unit.callSign}</dd></div>
                <div><dt>Priority</dt><dd>{call.dispatchPriority?.display ?? "Not provided"}</dd></div>
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
