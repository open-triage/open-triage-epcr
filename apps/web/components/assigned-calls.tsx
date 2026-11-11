"use client";
import { foregroundNetworkAllowed } from "../app/application-foreground";

import type { AssignedCall, ClinicianSession, OpenAssignmentResponse, ProductionJobAccess } from "@open-triage/contracts";
import { useReturnFocus } from "./use-return-focus";
import { PlatformRequestError } from "../app/platform-errors";
import { InstallationContextChangedError } from "../app/installation-transition-generation";
import { useAgencyTimeZone } from "../app/agency-time-zone";
import { formatClinicalDate, useRegionalFormat } from "../app/regional-format";
import { sessionRequestToken } from "../app/clinician-session";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVisiblePolling } from "./use-visible-polling";
import { LoadingStatus } from "./loading-status";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  fetchAssignedCalls,
  openAssignedCall
} from "../app/assigned-calls";

function dispatchTime(value: string, region: ReturnType<typeof useRegionalFormat>, zone: string | null): string {
  return formatClinicalDate(value, region, undefined, zone);
}
export function AssignedCalls({
  session,
  language,
  onOpened,
  onOpeningChange,
  refreshRequest = 0,
  suppressedCallNumbers = [],
  focusAssignmentId = null,
  paused = false,
}: {
  readonly paused?: boolean;
  readonly session: ClinicianSession;
  readonly language: AgencyLanguage;
  readonly onOpeningChange?: (call: AssignedCall | null) => void;
  readonly onOpened?: (opened: OpenAssignmentResponse, call: AssignedCall) => void | Promise<void>;
  readonly refreshRequest?: number;
  readonly suppressedCallNumbers?: ReadonlyArray<string>;
  readonly focusAssignmentId?: string | null;
}) {
  const region = useRegionalFormat();
  const zone = useAgencyTimeZone();
  const [calls, setCalls] = useState<AssignedCall[]>([]);
  const [productionAccess, setProductionAccess] = useState<ProductionJobAccess | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returningFocus,setReturningFocus]=useState(false);
  const openingTrigger=useRef<HTMLButtonElement|null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  useReturnFocus(openingId!==null,false,()=>returningFocus?openingTrigger.current:null);
  const openingRef = useRef(false);
  const refreshEpoch = useRef(0);
  const callsRef = useRef<AssignedCall[]>([]);
  const csrfToken = sessionRequestToken(session);
  const t = useCallback((key: string) => resolveMessage(language, key), [language]);

  const refresh = useCallback(async () => {
    if (paused || openingRef.current || !foregroundNetworkAllowed()) return;
    const epoch = refreshEpoch.current;
    try {
      const response = await fetchAssignedCalls();
      if (openingRef.current || refreshEpoch.current !== epoch) return;
      const visible = response.assignedCalls.filter((call) => !suppressedCallNumbers.includes(call.callNumber));
      callsRef.current = visible;
      setCalls(visible);
      setLoaded(true);
      setProductionAccess(response.productionAccess ?? null);
      setError(null);
    } catch (refreshError) {
      if (openingRef.current || refreshEpoch.current !== epoch) return;
      if (refreshError instanceof InstallationContextChangedError || refreshError instanceof PlatformRequestError && [401, 403].includes(refreshError.status)) {
        callsRef.current = [];
        setCalls([]);
        setProductionAccess(null);
      }
      setError(refreshError instanceof Error ? refreshError.message : t("calls.refreshFailed"));
    }
  }, [paused, suppressedCallNumbers, t]);

  const open = useCallback(async (call: AssignedCall) => {
    if (openingRef.current || !foregroundNetworkAllowed()) return;
    openingRef.current = true;
    setReturningFocus(false);
    refreshEpoch.current += 1;
    onOpeningChange?.(call);
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
      if (openError instanceof InstallationContextChangedError || openError instanceof PlatformRequestError && [401, 403].includes(openError.status)) {
        callsRef.current = [];
        setCalls([]);
        setProductionAccess(null);
      }
      setError(openError instanceof Error ? openError.message : t("calls.openFailed"));
      setReturningFocus(true);
    } finally {
      openingRef.current = false;
      refreshEpoch.current += 1;
      onOpeningChange?.(null);
      setOpeningId(null);
    }
  }, [csrfToken, onOpened, onOpeningChange, t]);

  useVisiblePolling(refresh, ASSIGNED_CALL_POLL_INTERVAL_MS, !paused,
    `${session.organization.id}:${session.user.id}:${refreshRequest}`);

  useEffect(() => {
    window.sessionStorage.removeItem("open-triage.new-job-intent.v1");
  }, []);

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
          <p className="eyebrow">{productionAccess?.unit?.callSign ?? t(productionAccess?.state === "synthetic-only" ? "calls.demoUnit" : "calls.unit")}</p>
          <h1 id="assigned-calls-title">{t("calls.assigned")}</h1>
        </div>
      </div>
      {error && <p className="assignment-error" role="alert">{error}</p>}
      {productionAccess && !["ready", "synthetic-only", "preparation"].includes(productionAccess.state) &&
        <p className="assignment-empty" role="status">{t(`calls.production.${productionAccess.state}`)}</p>}
      {!loaded && !error && <LoadingStatus className="assignment-empty">{t("calls.loading")}</LoadingStatus>}
      {loaded && calls.length === 0 && (!productionAccess || ["ready", "synthetic-only"].includes(productionAccess.state)) &&
        <p className="assignment-empty">{t("calls.none")}</p>}
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
                <div><dt>{t("calls.unitNotified")}</dt><dd><time dateTime={call.dispatchedAt}>{dispatchTime(call.dispatchedAt, region, zone)}</time></dd></div>
              </dl>
              <button type="button" onClick={event => { openingTrigger.current=event.currentTarget;void open(call); }} disabled={openingId !== null}>
                {openingId === call.id ? t("calls.opening") : t("calls.open")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
