"use client";
import { UnsavedChangesContext, confirmDiscardChanges } from "./unsaved-changes";
import { authenticationInstallationGeneration, assertAuthenticationInstallationGeneration } from "../app/installation-transition-generation";
import { participateInInstallationTransition,transitionInstallation, INSTALLATION_TRANSITION_KEY,INSTALLATION_TRANSITION_EVENT,INSTALLATION_TRANSITION_COMPLETE_EVENT } from "../app/installation-transition";
import { PlatformRequestError } from "../app/platform-errors";

import type { AssignedCall, ClinicianSession, AuthenticatedSession, PublicInstallationConfiguration, ReviewAttentionResponse } from "@open-triage/contracts";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  clearClinicianSession,
  changeClinicianPassword,
  createClinicianSession,
  endClinicianSession,
  authenticateRestartedClinicianSession,
  loadClinicianSession,
  storeClinicianSession,
  sessionRequestToken
} from "../app/clinician-session";
import { beginPersonalClinicianSession,completePersonalClinicianSession,regionalLoginAvailable,PersonalAuthenticationRedirect } from "../app/clinician-session";
import { PersonalAuthenticationContext } from "./personal-authentication";
import { LanguageSelector } from "./language-selector";
import { AssignedCalls } from "./assigned-calls";
import { OpenReports } from "./open-reports";
import type { ActiveDraftReport } from "../app/draft-report";
import { cacheOpenedReport, cacheReopenedReport, clearProtectedRuntimeReports, restoreRecoveredReport } from "../app/offline-reports";
import {
  hasAdminMode,
  hasClinicalMode,
  hasReviewMode,
  loadPresentationMode,
  storePresentationMode,
  type PresentationMode
} from "../app/presentation-mode";
import { applyAgencyAppearance, loadInstallationConfiguration, INSTALLATION_CONFIGURATION_STORAGE_KEY } from "../app/installation-settings";
import { switchAgency } from "../app/agencies";
import { availableUiLanguages, resolveMessage, resolveErrorMessage, type AgencyLanguage } from "../app/localization";
import { RegionalFormatContext } from "../app/regional-format";
import { AgencyTimeZoneContext } from "../app/agency-time-zone";
import { OrganizationManagement } from "./organization-management";
import { AdminShell } from "./admin-shell";
import { useVisiblePolling } from "./use-visible-polling";
import { ReviewShell } from "./review-shell";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "../app/browser-api";
import { ClinicalDemoBanner } from "./clinical-demo-banner";
import { shouldShowClinicalDemoBanner } from "../app/clinical-demo";
import { FeedbackControl } from "./feedback-control";
import { clearFeedbackTelemetry, installFeedbackRequestTracking, recordFeedbackInteraction } from "../app/feedback-telemetry";
import { TransientNotice } from "./transient-notice";
import { LoadingStatus } from "./loading-status";
import {
  deleteLegacyClinicalStorage,
  flushProtectedReport,
  lockProtectedClinicalStorage,
  prepareProtectedReport,
  protectedLogoutSummary,
  type ProtectedLogoutSummary,
} from "../app/protected-clinical-storage";

function emphasizedText(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  );
}

export function ClinicianSessionGate({ children }: {
  readonly children: ReactNode | ((context: {
    session: ClinicianSession;
    report: ActiveDraftReport | null;
    closeReport: () => void;
    completeReport: () => void;
    reportErrorStateChanged: (hasErrors: boolean) => void;
    sessionEnded: () => void;
    presentationMode: PresentationMode;
    language: AgencyLanguage;
  }) => ReactNode);
}) {
  const unsavedEditors = useRef(new Set<string>());
  const [installation, setInstallation] = useState<PublicInstallationConfiguration | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(null);
  const language = preferredLanguage ?? installation?.settings.language ?? "en";
  const [startupState, setStartupState] = useState<"loading" | "ready" | "failed">("loading");
  const t = useCallback((key: string, parameters?: Record<string, string | number>) =>
    resolveMessage(language, key, parameters), [language]);
  const [startupFailure, setStartupFailure] = useState<string | null>(null);
  const [authenticatedSession, setSession] = useState<AuthenticatedSession | null>(null);
  const session = authenticatedSession?.organization ? authenticatedSession as ClinicianSession : null;
  const [installationRecovery, setInstallationRecovery] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [regionalLogin,setRegionalLogin]=useState(false);
  const [transitionPending,setTransitionPending]=useState(false);
  useEffect(()=>{
    const update=()=>setTransitionPending(Boolean(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)));
    const storage=(event:StorageEvent)=>{if(event.key===INSTALLATION_TRANSITION_KEY)update();};
    update();window.addEventListener('storage',storage);window.addEventListener(INSTALLATION_TRANSITION_EVENT,update);window.addEventListener(INSTALLATION_TRANSITION_COMPLETE_EVENT,update);
    return()=>{window.removeEventListener('storage',storage);window.removeEventListener(INSTALLATION_TRANSITION_EVENT,update);window.removeEventListener(INSTALLATION_TRANSITION_COMPLETE_EVENT,update);};
  },[]);
  const openingHeading = useRef<HTMLHeadingElement>(null);
  const [openingCall, setOpeningCall] = useState<AssignedCall | null>(null);
  const [activeReport, setActiveReport] = useState<ActiveDraftReport | null>(null);
  useEffect(() => { if (openingCall) openingHeading.current?.focus(); }, [openingCall]);
  const [openReportsRevision, setOpenReportsRevision] = useState(0);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("mobile");
  const [adminReviewSettingsSection, setAdminReviewSettingsSection] = useState<"routing" | "backlog">();
  const [completedCallNumbers, setCompletedCallNumbers] = useState<ReadonlyArray<string>>([]);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [dismissedActiveReportNoticeId, setDismissedActiveReportNoticeId] = useState<string | null>(null);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [, setReportWithErrorsId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const attentionSessionKey = session ? `${session.organization.id}:${session.user.id}:${session.capabilities?.join(",")}` : "";
  const [storedReviewAttention, setStoredReviewAttention] = useState<{
    key: string; value: ReviewAttentionResponse } | null>(null);
  const [attentionDatasetSelection, setAttentionDatasetSelection] = useState<{
    key: string; dataset: "real" | "synthetic" } | null>(null);
  const reviewAttentionDataset = attentionDatasetSelection?.key === attentionSessionKey
    ? attentionDatasetSelection.dataset : session?.capabilities?.includes("clinical:demo") ? "synthetic" : "real";
  const reviewAttention = online && storedReviewAttention?.key === attentionSessionKey &&
    storedReviewAttention.value.dataset === reviewAttentionDataset ? storedReviewAttention.value : null;
  const [reviewAttentionRevision, setReviewAttentionRevision] = useState(0);
  const refreshReviewAttention = useCallback((dataset: "real" | "synthetic") => {
    setAttentionDatasetSelection({ key: attentionSessionKey, dataset });
    setReviewAttentionRevision((value) => value + 1);
  }, [attentionSessionKey]);
  useEffect(() => {
    if (!online || !session || !hasReviewMode(session.capabilities)) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/attention?dataset=${reviewAttentionDataset}`);
    const load = () => {
      if (!url || controller.signal.aborted) return;
      void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const value = await response.json() as ReviewAttentionResponse;
        if (!controller.signal.aborted) setStoredReviewAttention({ key: attentionSessionKey, value });
      }).catch(() => { if (!controller.signal.aborted) setStoredReviewAttention(null); });
    };
    load();
    return () => controller.abort();
  }, [session, online, attentionSessionKey, reviewAttentionDataset, reviewAttentionRevision]);
  useVisiblePolling(() => setReviewAttentionRevision((value) => value + 1), 30_000,
    online && !!session && hasReviewMode(session.capabilities), attentionSessionKey, false);
  const [generatedAssignmentId, setGeneratedAssignmentId] = useState<string | null>(null);
  const [logoutWarning, setLogoutWarning] = useState<ProtectedLogoutSummary | null>(null);
  const [lockingSession, setLockingSession] = useState(false);
  const logoutHeadingId = useId();
  const logoutDialog = useRef<HTMLElement>(null);
  const sessionBar = useRef<HTMLElement>(null);
  const reportErrorStateChanged = useCallback((hasErrors: boolean) => {
    setReportWithErrorsId(hasErrors ? activeReport?.id ?? null : null);
  }, [activeReport?.id]);

  useEffect(() => {
    return installFeedbackRequestTracking(window);
  }, []);

  useEffect(() => {
    if (installation) applyAgencyAppearance(installation.appearance, document, language);
  }, [installation, language]);

  useEffect(() => {
    if (logoutWarning) logoutDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [logoutWarning]);

  useEffect(() => {
    const bar = sessionBar.current;
    const shell = bar?.parentElement;
    if (!bar || !shell) return;
    const measure = () => shell.style.setProperty("--session-bar-height", `${bar.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [session, presentationMode]);

  useEffect(() => {
    const viewport = sessionBar.current?.querySelector<HTMLElement>(".presentation-selector-scroll");
    const selector = viewport?.querySelector<HTMLElement>(".presentation-selector");
    if (!viewport || !selector) return;
    const revealActiveMode = () => {
      const active = selector.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!active) return;
      selector.style.setProperty("--mode-offset", `${active.offsetLeft - 2}px`);
      selector.style.setProperty("--mode-width", `${active.offsetWidth}px`);
      const left = active.offsetLeft - 2;
      const right = active.offsetLeft + active.offsetWidth + 2;
      if (left < viewport.scrollLeft) viewport.scrollLeft = left;
      else if (right > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = right - viewport.clientWidth;
    };
    revealActiveMode();
    const observer = new ResizeObserver(revealActiveMode);
    observer.observe(viewport);
    observer.observe(selector);
    selector.querySelectorAll("button").forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [session, presentationMode, language, installation]);

  const lockAndEndLocalSession = useCallback(async (endedMessage: string) => {
    clearClinicianSession(window.localStorage);
    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index--) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith("open-triage:catalog-editor:")) window.sessionStorage.removeItem(key);
      }
    } catch { /* The authenticated view still closes if browser storage is unavailable. */ }
    clearFeedbackTelemetry();
    setActiveReport(null);
    try { await lockProtectedClinicalStorage(); }
    catch { /* Readable runtime state is cleared even if browser storage cleanup fails. */ }
    finally {
      clearProtectedRuntimeReports();
      deleteLegacyClinicalStorage(window.localStorage);
      setSession(null);
      setLogoutWarning(null);
      setLockingSession(false);
      setMessage(endedMessage);
    }
  }, []);

  const transitionContext = useRef({ lockAndEndLocalSession, t });
  useEffect(() => { transitionContext.current = { lockAndEndLocalSession, t }; }, [lockAndEndLocalSession, t]);
  const hasAuthenticatedSession = Boolean(authenticatedSession);
  useEffect(() => {
    if (!hasAuthenticatedSession || !navigator.locks) return;
    return participateInInstallationTransition(async () => {
      setLockingSession(true);
      const context = transitionContext.current;
      await context.lockAndEndLocalSession(context.t("login.loggedOut"));
    });
  }, [hasAuthenticatedSession]);

  useEffect(() => {
    let current = true;
    let resolved = false;
    let inFlight = false;
    deleteLegacyClinicalStorage(window.localStorage);
    const loadedSession = loadClinicianSession(window.localStorage);
    const serverRestart = !!loadedSession && browserRequestConfiguration().mode === "server";
    const load = async () => {
      if (inFlight || resolved) return;
      inFlight = true;
      try {
        // Both requests are independent. Keep protected content gated until
        // authentication and configuration have both completed successfully.
        const startupGeneration = authenticationInstallationGeneration();
        const personalResult=new URLSearchParams(window.location.search).get("authentication");
        const [loaded, assessed,regional] = await Promise.all([
          loadInstallationConfiguration(),
          personalResult==='completed'?completePersonalClinicianSession():serverRestart ? authenticateRestartedClinicianSession(loadedSession!) : loadedSession,
          regionalLoginAvailable().catch(()=>false),
        ]);
        if (!current) return;
        let authenticated = assessed;
        try { assertAuthenticationInstallationGeneration(startupGeneration); } catch { authenticated = null; }
        if (serverRestart && !authenticated) clearClinicianSession(window.localStorage);
        try {
          const savedLanguage = window.localStorage.getItem("open-triage:ui-language");
          if (savedLanguage && availableUiLanguages.includes(savedLanguage)) setPreferredLanguage(savedLanguage);
        } catch { /* Language selection remains available without persistent storage. */ }
        setInstallation(loaded);
        setRegionalLogin(regional);
        if(personalResult){
          window.history.replaceState(null,"",window.location.pathname);
          if(personalResult==='completed'&&authenticated)storeClinicianSession(window.localStorage,authenticated);
          else setMessage(resolveMessage(loaded.settings.language,personalResult==='pending'?"login.regionalPending":"login.regionalFailed"));
        }
        setSession(authenticated);
        setPresentationMode(loadPresentationMode(window.localStorage, authenticated?.capabilities));
        setStartupFailure(null);
        setStartupState("ready");
        resolved = true;
      } catch (reason: unknown) {
        if (!current) return;
        setStartupFailure(reason instanceof Error ? reason.message : "The application could not be loaded.");
        setStartupState("failed");
      } finally {
        inFlight = false;
      }
    };
    void load();
    const reconnect = () => void load();
    const retry = window.setInterval(reconnect, 5_000);
    window.addEventListener("online", reconnect);
    return () => {
      current = false;
      window.clearInterval(retry);
      window.removeEventListener("online", reconnect);
    };
  }, []);

  useEffect(() => {
    const updateOnline = () => setOnline(window.navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!authenticatedSession) return;
    const remaining = Date.parse(authenticatedSession.expiresAt) - Date.now();
    if (remaining <= 0) {
      queueMicrotask(() => void lockAndEndLocalSession(t("login.sessionExpired")));
      return;
    }
    const timeout = window.setTimeout(() => {
      void lockAndEndLocalSession(t("login.sessionExpired"));
    }, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [lockAndEndLocalSession, authenticatedSession, t]);

  useEffect(() => {
    if (!authenticatedSession || browserRequestConfiguration().mode !== "server") return;
    let current = true;
    let inFlight = false;
    const reassess = async () => {
      if (!current || inFlight || !navigator.onLine) return;
      inFlight = true;
      try {
        const live = await authenticateRestartedClinicianSession(authenticatedSession);
        if (current && !live) await lockAndEndLocalSession(t("login.sessionExpired"));
        else if (current && live && JSON.stringify(live) !== JSON.stringify(authenticatedSession)) {
          storeClinicianSession(window.localStorage, live); setSession(live);
        }
      } catch { /* Connection failure does not extend the existing local deadline. */ }
      finally { inFlight = false; }
    };
    const visible = () => { if (document.visibilityState === "visible") void reassess(); };
    const interval = window.setInterval(() => void reassess(), 30_000);
    window.addEventListener("online", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("open-triage.authentication-policy-changed", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      current = false;
      window.clearInterval(interval);
      window.removeEventListener("online", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("open-triage.authentication-policy-changed", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [authenticatedSession, lockAndEndLocalSession, t]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)) return;
    setSubmitting(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const created = await createClinicianSession({
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? "")
      });
      storeClinicianSession(window.localStorage, created);
      clearFeedbackTelemetry();
      setActiveReport(null);
      setSession(created);
      const initialMode = loadPresentationMode(window.localStorage, created.capabilities);
      storePresentationMode(window.localStorage, initialMode);
      setPresentationMode(initialMode);
    } catch (error) {
      setMessage(error instanceof PlatformRequestError ? error.message : error instanceof Error && error.message === "The username or password is incorrect."
        ? t("login.invalidCredentials") : t("login.unavailable"));
    } finally {
      setSubmitting(false);
    }
  }

  async function personalLogin(purpose:"login"|"switch"){
    if(purpose==='switch'&&!confirmDiscardChanges(unsavedEditors.current.size>0))return;
    setSubmitting(true);setMessage(null);
    try{await beginPersonalClinicianSession(purpose,authenticatedSession?sessionRequestToken(authenticatedSession):undefined);}
    catch(error){if(!(error instanceof PersonalAuthenticationRedirect))setMessage(error instanceof PlatformRequestError?error.message:t("login.regionalFailed"));}
    finally{setSubmitting(false);}
  }

  async function replacePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticatedSession) return;
    setSubmitting(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const next = String(form.get("newPassword") ?? "");
    if (next !== String(form.get("confirmPassword") ?? "")) {
      setMessage(t("login.passwordMismatch"));
      setSubmitting(false);
      return;
    }
    try {
      const changed = await changeClinicianPassword(
        String(form.get("currentPassword") ?? ""), next, sessionRequestToken(authenticatedSession)
      );
      storeClinicianSession(window.localStorage, changed);
      setSession(changed);
    } catch (error) {
      setMessage(error instanceof PlatformRequestError ? error.message : error instanceof Error && error.message === "The current password is incorrect."
        ? t("login.passwordIncorrect") : t("login.passwordChangeFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function requestLogout() {
    if (!confirmDiscardChanges(unsavedEditors.current.size > 0)) return;
    recordFeedbackInteraction("session.logout.requested");
    const summary = protectedLogoutSummary();
    if (summary.pendingReportCount > 0) {
      setLogoutWarning(summary);
      return;
    }
    void logOut();
  }

  async function logOut() {
    const csrfToken = authenticatedSession ? sessionRequestToken(authenticatedSession) : "";
    setLockingSession(true);
    // Settle local writers/keys first, then finish the server's cookie response
    // before exposing the next login. A delayed logout must not clear that new
    // person's cookie after their authentication has completed.
    await transitionInstallation(async()=>{
      if (csrfToken) await endClinicianSession(csrfToken).catch(() => undefined);
    });
    await lockAndEndLocalSession(t("login.loggedOut"));
  }

  async function changeAgency(id: string) {
    if (!authenticatedSession || !online) throw new Error(t("admin.connectToSwitchAgencies"));
    if (activeReport || openingCall || protectedLogoutSummary().pendingReportCount > 0) {
      throw new Error(t("admin.closeReportsToSwitchAgencies"));
    }
    if (!confirmDiscardChanges(unsavedEditors.current.size > 0)) return;
    await lockProtectedClinicalStorage();
    const changed = await switchAgency(sessionRequestToken(authenticatedSession), id);
    clearProtectedRuntimeReports();
    clearFeedbackTelemetry();
    window.localStorage.removeItem(INSTALLATION_CONFIGURATION_STORAGE_KEY);
    storeClinicianSession(window.localStorage, { ...changed, csrfToken: authenticatedSession.csrfToken });
    // Recreate all workspaces and in-memory caches at the new agency boundary.
    window.location.reload();
  }

  function logoutDialogKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !lockingSession) setLogoutWarning(null);
  }

  function selectPresentationMode(mode: PresentationMode) {
    if ((mode === "admin" || mode === "review") && (activeReport || openingCall)) return false;
    if (mode === presentationMode || !confirmDiscardChanges(unsavedEditors.current.size > 0)) return false;
    setModeMessage(null);
    recordFeedbackInteraction(`presentation.${mode}.selected`);
    storePresentationMode(window.localStorage, mode);
    setPresentationMode(mode);
    return true;
  }

  const sessionEnded = useCallback(() => {
    void lockAndEndLocalSession(t("login.sessionEnded"));
  }, [lockAndEndLocalSession, t]);

  if (startupState !== "ready") return <main className="session-loading" aria-label={t("login.opening")} aria-busy={startupState === "loading"}>
    {startupState === "loading" ? <LoadingStatus>{t("login.opening")}</LoadingStatus> : <div role="alert">
      <p>{online ? t("login.connectFailed") : t("login.reconnect")}</p>
      {online && startupFailure && <p>{startupFailure}</p>}
    </div>}
  </main>;
  if (!installation) return <main className="login-shell"><p className="login-message" role="alert">{message ?? t("login.configurationUnavailable")}</p></main>;
  if (!authenticatedSession) {
    return (
      <main className="login-shell">
        <form className="login-card login-sign-in" onSubmit={signIn}>
          <header className="login-intro">
            {installation.appearance.logoPngDataUrl && <>
              {/* A bounded agency data URL cannot use Next's static image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="agency-logo" src={installation.appearance.logoPngDataUrl} alt="" />
            </>}
            <p className="eyebrow">{installation.settings.signIn.brandText}</p>
            <h1>{t("login.signIn")}</h1>
            <p>{emphasizedText(installation.settings.signIn.helperText)}</p>
          </header>
          <div className="login-fields">
            {message && <p className="login-message" role="status">{message}</p>}
            {regionalLogin && !installationRecovery?<><button type="button" disabled={submitting||lockingSession||transitionPending} onClick={()=>void personalLogin('login')}>{t("login.regionalSignIn")}</button><button type="button" onClick={() => setInstallationRecovery(true)}>{t("login.installationRecovery")}</button></>:<>
            {installationRecovery && <><p>{t("login.installationRecoveryHelp")}</p><button type="button" onClick={() => setInstallationRecovery(false)}>{t("login.regionalSignIn")}</button></>}
            <label>
              {t("login.username")}
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              {t("login.password")}
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={submitting||lockingSession||transitionPending}>{submitting ? t("login.signingIn") : t("login.signIn")}</button>
            </>}
          </div>
        </form>
      </main>
    );
  }
  if (authenticatedSession.passwordChangeRequired) {
    return <main className="login-shell">
      <form className="login-card" onSubmit={replacePassword}>
        <p className="eyebrow">{t("login.accountSecurity")}</p>
        <h1>{t("login.replaceTemporaryPassword")}</h1>
        <p>{t("login.temporaryPasswordHelp")}</p>
        {message && <p className="login-message" role="status">{message}</p>}
        <label>{t("login.temporaryPassword")}<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label>{t("login.newPassword")}<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label>{t("login.confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
        <button type="submit" disabled={submitting}>{submitting ? t("login.replacing") : t("login.replacePassword")}</button>
      </form>
    </main>;
  }
  if (authenticatedSession.workspaceAvailable === false || (session && session.capabilities?.length === 0)) {
    return <main className="login-shell">
      <section className="login-card" aria-labelledby="no-workspace-heading">
        <p className="eyebrow">{t("login.signedIn")}</p>
        <h1 id="no-workspace-heading">{t("login.noWorkspace")}</h1>
        <p>{t("login.noWorkspaceHelp")}</p>
        <button type="button" onClick={requestLogout}>{t("navigation.logOut")}</button>
      </section>
    </main>;
  }

  if (!session) return <UnsavedChangesContext.Provider value={unsavedEditors.current}>
    <div className="authenticated-shell admin-shell desktop-shell">
      <header className="session-bar">
        <span className="session-identity">{t("navigation.signedInAs", { name: authenticatedSession.user.displayName })}</span>
        <button type="button" onClick={requestLogout}>{t("navigation.logOut")}</button>
      </header>
      <main className="admin-shell">
        <header className="admin-heading"><h1>{t("navigation.superAdmin")}</h1></header>
        <div className="admin-panel"><OrganizationManagement session={authenticatedSession} language={language} onOpenAgency={changeAgency} /></div>
      </main>
    </div>
  </UnsavedChangesContext.Provider>;

  const nextAuthenticationSource = (session as ClinicianSession & { nextAuthenticationSource?: "local" | "oidc" }).nextAuthenticationSource ?? session.authenticationSource ?? "local";
  return (
    <PersonalAuthenticationContext.Provider value={nextAuthenticationSource}>
    <UnsavedChangesContext.Provider value={unsavedEditors.current}>
    <AgencyTimeZoneContext.Provider value={installation.settings.timeZone ?? null}>
    <RegionalFormatContext.Provider value={installation.settings.regionalFormat ?? null}>
    <div className={`authenticated-shell ${presentationMode}-shell${presentationMode !== "mobile" ? " desktop-shell" : ""}`}>
      <header ref={sessionBar} className="session-bar">
        <LanguageSelector language={language} onChange={(selected) => {
          setPreferredLanguage(selected);
          try { window.localStorage.setItem("open-triage:ui-language", selected); } catch { /* Keep the session preference. */ }
        }} />
        {browserRequestConfiguration().mode === "server" &&
          <FeedbackControl language={language} csrfToken={sessionRequestToken(session)} online={online} mode={presentationMode}
            screen={presentationMode === "admin" ? "admin" : presentationMode === "review" ? "review" : activeReport ? "encounter" : "calls"} />}
        <div className="session-account">
        <span className="session-identity">{t("navigation.signedInAs", { name: session.user.displayName })}</span>
        {(session.agencies?.length ?? 0) > 1 && <label className="session-agency-selector">
          <select aria-label={t("admin.agency")} value={session.organization.id}
            disabled={!online || activeReport !== null || openingCall !== null}
            onChange={(event) => { void changeAgency(event.target.value).catch((reason: unknown) => setModeMessage(resolveErrorMessage(language, reason instanceof Error ? reason.message : null, "admin.agencyOpenFailed"))); }}>
            {session.agencies?.map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}
          </select>
        </label>}
        </div>
        <div className="presentation-selector-scroll">
          <div className="presentation-selector" role="group" aria-label={t("navigation.presentation")}>
            {hasClinicalMode(session.capabilities) && <>
              <button type="button" aria-pressed={presentationMode === "mobile"} onClick={() => selectPresentationMode("mobile")}>{t("navigation.mobile")}</button>
              <button type="button" aria-pressed={presentationMode === "stationary"} onClick={() => selectPresentationMode("stationary")}>{t("navigation.stationary")}</button>
            </>}
            {hasReviewMode(session.capabilities) && <button type="button" aria-pressed={presentationMode === "review"}
              disabled={activeReport !== null || openingCall !== null}
              onClick={() => selectPresentationMode("review")}>{t("navigation.review")}
              {reviewAttention && reviewAttention.dataset === reviewAttentionDataset &&
                reviewAttention.total > 0 &&
                <> <span className="presentation-attention-count">({reviewAttention.total})</span></>}</button>}
            {hasAdminMode(session.capabilities) && <button type="button" aria-pressed={presentationMode === "admin"}
              disabled={activeReport !== null || openingCall !== null}
              onClick={() => selectPresentationMode("admin")}>{t("navigation.admin")}</button>}
          </div>
        </div>
        {nextAuthenticationSource==='oidc'&&<button type="button" disabled={submitting||lockingSession} onClick={()=>void personalLogin('switch')}>{t("login.switchUser")}</button>}
        <button type="button" onClick={requestLogout}>{t("navigation.logOut")}</button>
      </header>
      {logoutWarning && <div className="dialog-backdrop logout-backdrop" role="presentation">
        <section ref={logoutDialog} className="note-dialog logout-dialog" role="alertdialog" aria-modal="true"
          aria-labelledby={logoutHeadingId} onKeyDown={logoutDialogKeys}>
          <div className="note-dialog-heading"><div><p className="eyebrow">{t("login.pendingWork")}</p>
            <h2 id={logoutHeadingId}>{t("login.lockWork")}</h2></div></div>
          <p role="note">{resolveMessage(language, "login.unsynchronized", {}, logoutWarning.pendingReportCount)}</p>
          <p className="feedback-warning"><strong>{t("login.recoveryDeadline")}</strong> {logoutWarning.recoveryDeadline
            ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(logoutWarning.recoveryDeadline))
            : t("login.valueUnavailable")}. {t("login.recoveryHelp")}</p>
          <div className="note-dialog-actions">
            <button type="button" disabled={lockingSession} onClick={() => setLogoutWarning(null)}>{t("login.staySignedIn")}</button>
            <button type="button" disabled={lockingSession} onClick={() => void logOut()}>{lockingSession ? t("login.locking") : t("login.logOutLock")}</button>
          </div>
        </section>
      </div>}
      {modeMessage && <p className="admin-entry-blocked" role="alert">{modeMessage}</p>}
        {shouldShowClinicalDemoBanner({ authenticated: true, capabilities: session.capabilities,
        presentationMode, online, requestMode: browserRequestConfiguration().mode }) && <ClinicalDemoBanner
          session={session}
          activeReport={activeReport}
          refreshRequest={refreshRequest}
          onGenerated={(assignmentId) => {
            setGeneratedAssignmentId(assignmentId);
            setRefreshRequest((value) => value + 1);
          }}
          onDeleted={() => {
            setActiveReport(null);
            setOpenReportsRevision((value) => value + 1);
            setRefreshRequest((value) => value + 1);
          }}
        />}
      {openingCall && !activeReport && <section className="call-opening" aria-busy="true" aria-labelledby="call-opening-heading">
        <h1 ref={openingHeading} tabIndex={-1} id="call-opening-heading">{t("calls.openingCall", { call: openingCall.callNumber })}</h1>
        <LoadingStatus>{t("calls.preparingReport")}</LoadingStatus>
      </section>}
      {presentationMode !== "admin" && presentationMode !== "review" && <div className="call-directory" hidden={activeReport !== null || openingCall !== null}>
        <TransientNotice message={completionNotice} onDismiss={() => setCompletionNotice(null)} focusOnMount />
        <AssignedCalls paused={activeReport !== null || openingCall !== null} session={session} language={language} refreshRequest={refreshRequest} focusAssignmentId={generatedAssignmentId}
          suppressedCallNumbers={completedCallNumbers} onOpeningChange={setOpeningCall} onOpened={async (opened, call) => {
          setCompletionNotice(null);
          await prepareProtectedReport(sessionRequestToken(session), opened.report.id, (payload) =>
            restoreRecoveredReport(window.localStorage, session.user.id, opened.report.id, payload));
          const cached = cacheOpenedReport(window.localStorage, session, opened, call);
          await flushProtectedReport(opened.report.id);
          setDismissedActiveReportNoticeId(null);
          setActiveReport(cached.report);
        }} />
        <OpenReports key={openReportsRevision} paused={openingCall !== null} session={session} language={language} refreshRequest={refreshRequest} activeReportId={activeReport?.id} onSessionEnded={sessionEnded} onCompleted={() => {
          setActiveReport(null);
        }} onReopened={(opened) => {
          const cached = cacheReopenedReport(window.localStorage, session, opened);
          setDismissedActiveReportNoticeId(null);
          setActiveReport(cached.report);
        }} />
      </div>}
      <TransientNotice
        message={activeReport && dismissedActiveReportNoticeId !== activeReport.id
          ? activeReport.callNumber ? t("mobile.documentingCall", { call: activeReport.callNumber }) : t("mobile.documentingOpened")
          : null}
        onDismiss={() => setDismissedActiveReportNoticeId(activeReport?.id ?? null)}
        className="active-report-notice"
        data-report-id={activeReport?.id}
        data-form-version-id={activeReport?.formVersionId}
      />
      {activeReport && (typeof children === "function" ? children({ session, report: activeReport, sessionEnded, presentationMode, language,
        reportErrorStateChanged, closeReport: () => {
        setActiveReport(null);
        setOpenReportsRevision((value) => value + 1);
      }, completeReport: () => {
        if (activeReport.callNumber) setCompletedCallNumbers((current) => current.includes(activeReport.callNumber!) ? current : [...current, activeReport.callNumber!]);
        setCompletionNotice(activeReport.callNumber ? t("mobile.callSigned", { call: activeReport.callNumber }) : t("mobile.reportSigned"));
        setActiveReport(null);
        setOpenReportsRevision((value) => value + 1);
      } }) : children)}
      {presentationMode === "admin" && !activeReport && <AdminShell session={session} language={language} online={online} onOpenAgency={changeAgency}
        reviewSettingsSection={adminReviewSettingsSection} />}
      {presentationMode === "review" && !activeReport && <ReviewShell key={`${session.user.id}:${session.organization.id}:${[...(session.capabilities ?? [])].sort().join(",")}`} session={session} language={language}
        online={online} attention={reviewAttention?.dataset === reviewAttentionDataset ? reviewAttention : null}
        onAttentionRefresh={refreshReviewAttention} onOpenSettings={(section) => {
          if (selectPresentationMode("admin")) setAdminReviewSettingsSection(section);
        }} />}
    </div>
    </RegionalFormatContext.Provider>
    </AgencyTimeZoneContext.Provider>
    </UnsavedChangesContext.Provider>
    </PersonalAuthenticationContext.Provider>
  );
}
