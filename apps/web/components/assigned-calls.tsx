"use client";

import type { AssignedCall, ClinicianSession, OpenAssignmentResponse, ProductionJobAccess } from "@open-triage/contracts";
import { useNewJobConfirmation, NewJobCanceledError } from "./new-job-confirmation";
import { useRecoveryFormFocus } from "./use-recovery-form-focus";
import { useReturnFocus } from "./use-return-focus";
import { PlatformRequestError } from "../app/platform-errors";
import { InstallationContextChangedError } from "../app/installation-transition-generation";
import { useAgencyTimeZone } from "../app/agency-time-zone";
import { formatClinicalDate, useRegionalFormat } from "../app/regional-format";
import { PersonalAuthenticationRedirect, reauthenticateClinicianSession, sessionRequestToken } from "../app/clinician-session";
import { RecoveryReauthenticationRequiredError } from "../app/protected-clinical-storage";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useVisiblePolling } from "./use-visible-polling";
import { PersonalAuthenticationField } from "./personal-authentication";
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
  const confirmNewJob = useNewJobConfirmation();
  const region = useRegionalFormat();
  const zone = useAgencyTimeZone();
  const [calls, setCalls] = useState<AssignedCall[]>([]);
  const [productionAccess, setProductionAccess] = useState<ProductionJobAccess | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returningFocus,setReturningFocus]=useState(false);
  const openingTrigger=useRef<HTMLButtonElement|null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [reauthenticationId, setReauthenticationId] = useState<string | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [shiftReauthentication, setShiftReauthentication] = useState(false);
  const [reauthenticating, setReauthenticating] = useState(false);
  const recoveryForm = useRef<HTMLFormElement>(null);
  useRecoveryFormFocus(recoveryForm, reauthenticationId !== null && !paused && !reauthenticating && openingId === null);
  useReturnFocus(openingId!==null,reauthenticating,()=>returningFocus?openingTrigger.current:null);
  const openingRef = useRef(false);
  const refreshEpoch = useRef(0);
  const callsRef = useRef<AssignedCall[]>([]);
  const csrfToken = sessionRequestToken(session);
  const t = useCallback((key: string) => resolveMessage(language, key), [language]);

  const refresh = useCallback(async () => {
    if (paused || openingRef.current) return;
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
    if (openingRef.current) return;
    openingRef.current = true;
    setReturningFocus(false);
    refreshEpoch.current += 1;
    onOpeningChange?.(call);
    setOpeningId(call.id);
    setReauthenticationId(null);
    setError(null);
    try {
      const opened = await openAssignedCall(csrfToken, call.id, confirmNewJob);
      // Keep the selected card and its progress state until the protected
      // workspace is ready; preparation may require additional round trips.
      await onOpened?.(opened, call);
      setReauthenticationId(null);
      const nextCalls = callsRef.current.filter((candidate) => candidate.id !== call.id);
      if (opened.replacementAssignment && !nextCalls.some((candidate) => candidate.id === opened.replacementAssignment!.id)) {
        nextCalls.unshift(opened.replacementAssignment);
      }
      callsRef.current = nextCalls;
      setCalls(nextCalls);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".encounter-header")?.scrollIntoView());
    } catch (openError) {
      if (openError instanceof NewJobCanceledError) {
        setReturningFocus(openError.restoreFocus);
        return;
      }
      if (openError instanceof RecoveryReauthenticationRequiredError || openError instanceof PlatformRequestError && openError.code === "calls.shiftReauthenticationRequired") {
        setShiftReauthentication(openError instanceof PlatformRequestError);
        setReauthenticationId(call.id);
        return;
      }
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
  }, [csrfToken, onOpened, onOpeningChange, t, confirmNewJob]);

  const reauthenticateAndOpen = async (event: FormEvent<HTMLFormElement>, call?: AssignedCall) => {
    event.preventDefault();
    setReauthenticating(true);
    setError(null);
    const password = recoveryPassword;
    setRecoveryPassword("");
    try {
      if (call) window.sessionStorage.setItem("open-triage.new-job-intent.v1", JSON.stringify({ assignmentId: call.id, userId: session.user.id, organizationId: session.organization.id, createdAt: Date.now() }));
      await reauthenticateClinicianSession(password, csrfToken, shiftReauthentication || productionAccess?.state === "reauthentication-required");
      window.sessionStorage.removeItem("open-triage.new-job-intent.v1");
      if (call) await open(call);
      else await refresh();
    } catch (reason) {
      if (reason instanceof PersonalAuthenticationRedirect) return;
      window.sessionStorage.removeItem("open-triage.new-job-intent.v1");
      setError(reason instanceof Error ? reason.message : t("reports.reauthFailed"));
    } finally { setReauthenticating(false); }
  };

  useVisiblePolling(refresh, ASSIGNED_CALL_POLL_INTERVAL_MS, !paused && reauthenticationId === null,
    `${session.organization.id}:${session.user.id}:${refreshRequest}`);

  useEffect(() => {
    if (!loaded) return;
    const encoded = window.sessionStorage.getItem("open-triage.new-job-intent.v1");
    if (!encoded) return;
    window.sessionStorage.removeItem("open-triage.new-job-intent.v1");
    try {
      const intent = JSON.parse(encoded);
      if (intent.userId !== session.user.id || intent.organizationId !== session.organization.id ||
        !Number.isFinite(intent.createdAt) || Date.now() - intent.createdAt > 600_000 || intent.createdAt > Date.now()) return;
      const call = calls.find(candidate => candidate.id === intent.assignmentId);
      if (call) window.requestAnimationFrame(() => void open(call));
    } catch { /* Malformed intent confers no authority. */ }
  }, [calls, loaded, open, session.organization.id, session.user.id]);

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
      {productionAccess && !["ready", "synthetic-only"].includes(productionAccess.state) &&
        <p className="assignment-empty" role="status">{t(`calls.production.${productionAccess.state}`)}</p>}
      {productionAccess?.state === "reauthentication-required" && <form className="report-reauthentication"
        onSubmit={event => void reauthenticateAndOpen(event)} aria-describedby="assigned-shift-help">
        <p id="assigned-shift-help">{t("calls.shiftReauthHelp")}</p>
        <PersonalAuthenticationField language={language} value={recoveryPassword} onChange={setRecoveryPassword} label={t("reports.currentPassword")} />
        <button type="submit" disabled={reauthenticating}>{t(reauthenticating ? "reports.confirming" : "calls.authenticateShift")}</button>
      </form>}
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
              <button type="button" onClick={event => { openingTrigger.current=event.currentTarget;void open(call); }} disabled={openingId !== null || reauthenticating}>
                {openingId === call.id ? t("calls.opening") : t("calls.open")}
              </button>
              {reauthenticationId === call.id && <form ref={recoveryForm} className="report-reauthentication"
                onSubmit={(event) => void reauthenticateAndOpen(event, call)} aria-describedby={`assigned-recovery-help-${call.id}`}>
                <p id={`assigned-recovery-help-${call.id}`}>{t(shiftReauthentication ? "calls.shiftReauthHelp" : "reports.reauthHelp")}</p>
                <PersonalAuthenticationField language={language} value={recoveryPassword} onChange={setRecoveryPassword} label={t("reports.currentPassword")} />
                <button type="submit" disabled={reauthenticating}>
                  {reauthenticating ? t("reports.confirming") : t(shiftReauthentication ? "calls.authenticateShift" : "reports.confirmRecover")}
                </button>
                <button type="button" disabled={reauthenticating} onClick={() => { setReauthenticationId(null); setRecoveryPassword(""); }}>
                  {t("mobile.dialog.cancel")}
                </button>
              </form>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
