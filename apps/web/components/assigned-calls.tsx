"use client";

import type { AssignedCall, ClinicianSession, OpenAssignmentResponse } from "@open-triage/contracts";
import { formatClinicalDate, useRegionalFormat } from "../app/regional-format";
import { sessionRequestToken } from "../app/clinician-session";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingStatus } from "./loading-status";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  fetchAssignedCalls,
  openAssignedCall
} from "../app/assigned-calls";

function dispatchTime(value: string, region: ReturnType<typeof useRegionalFormat>): string {
  return formatClinicalDate(value, region);
}
export function AssignedCalls({
  session,
  language,
  onOpened,
  refreshRequest = 0,
  suppressedCallNumbers = [],
  focusAssignmentId = null,
}: {
  readonly session: ClinicianSession;
  readonly language: AgencyLanguage;
  readonly onOpened?: (opened: OpenAssignmentResponse, call: AssignedCall) => void | Promise<void>;
  readonly refreshRequest?: number;
  readonly suppressedCallNumbers?: ReadonlyArray<string>;
  readonly focusAssignmentId?: string | null;
}) {
  const region = useRegionalFormat();
  const [calls, setCalls] = useState<AssignedCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const callsRef = useRef<AssignedCall[]>([]);
  const handledRefreshRequest = useRef(refreshRequest);
  const csrfToken = sessionRequestToken(session);
  const t = useCallback((key: string) => resolveMessage(language, key), [language]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchAssignedCalls();
      const visible = response.assignedCalls.filter((call) => !suppressedCallNumbers.includes(call.callNumber));
      callsRef.current = visible;
      setCalls(visible);
      setLoaded(true);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t("calls.refreshFailed"));
    }
  }, [suppressedCallNumbers, t]);

  const open = useCallback(async (call: AssignedCall) => {
    setOpeningId(call.id);
    setError(null);
    try {
      const opened = await openAssignedCall(csrfToken, call.id);
      // Keep the selected card and its progress state until the protected
      // workspace is ready; preparation may require additional round trips.
      await onOpened?.(opened, call);
      const nextCalls = callsRef.current.filter((candidate) => candidate.id !== call.id);
      if (opened.replacementAssignment && !nextCalls.some((candidate) => candidate.id === opened.replacementAssignment!.id)) {
        nextCalls.unshift(opened.replacementAssignment);
      }
      callsRef.current = nextCalls;
      setCalls(nextCalls);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t("calls.openFailed"));
    } finally {
      setOpeningId(null);
    }
  }, [csrfToken, onOpened, t]);

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
          <p className="eyebrow">{t("calls.demoUnit")}</p>
          <h1 id="assigned-calls-title">{t("calls.assigned")}</h1>
        </div>
      </div>
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {!loaded && !error && <LoadingStatus className="assignment-empty">{t("calls.loading")}</LoadingStatus>}
      {loaded && calls.length === 0 && <p className="assignment-empty">{t("calls.none")}</p>}
      {calls.length > 0 && (
        <ul className="assigned-call-list">
          {calls.map((call) => (
            <li key={call.id} className="assigned-call-card" data-assignment-id={call.id}>
              <div className="assigned-call-title">
                <strong>{call.callNumber}</strong>
                <span>{call.status === "assigned" ? t("calls.status.assigned") : call.status === "open" ? t("calls.status.open") : call.status}</span>
              </div>
              <p>{call.dispatchReason || t("calls.reasonMissing")}</p>
              <dl>
                <div><dt>{t("calls.unit")}</dt><dd>{call.unit.callSign}</dd></div>
                <div><dt>{t("calls.priority")}</dt><dd>{call.dispatchPriority?.display ?? t("calls.notProvided")}</dd></div>
                <div><dt>{t("calls.unitNotified")}</dt><dd><time dateTime={call.dispatchedAt}>{dispatchTime(call.dispatchedAt, region)}</time></dd></div>
              </dl>
              <button type="button" onClick={() => void open(call)} disabled={openingId !== null}>
                {openingId === call.id ? t("calls.opening") : t("calls.open")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
