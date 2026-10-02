"use client";
import { PlatformRequestError } from "../app/platform-errors";

import type { AssignedCall, ClinicianSession, PublicInstallationConfiguration } from "@open-triage/contracts";
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
import { LanguageSelector } from "./language-selector";
import { AssignedCalls } from "./assigned-calls";
import { OpenReports } from "./open-reports";
import type { ActiveDraftReport } from "../app/draft-report";
import { cacheOpenedReport, cacheReopenedReport, clearProtectedRuntimeReports } from "../app/offline-reports";
import {
  hasAdminMode,
  hasClinicalMode,
  hasReviewMode,
  loadPresentationMode,
  storePresentationMode,
  type PresentationMode
} from "../app/presentation-mode";
import { applyAgencyAppearance, loadInstallationConfiguration } from "../app/installation-settings";
import { availableUiLanguages, resolveMessage, type AgencyLanguage } from "../app/localization";
import { RegionalFormatContext } from "../app/regional-format";
import { AgencyTimeZoneContext } from "../app/agency-time-zone";
import { AdminShell } from "./admin-shell";
import { ReviewShell } from "./review-shell";
import { browserRequestConfiguration } from "../app/browser-api";
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
  const [installation, setInstallation] = useState<PublicInstallationConfiguration | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(null);
  const language = preferredLanguage ?? installation?.settings.language ?? "en";
  const [startupState, setStartupState] = useState<"loading" | "ready" | "failed">("loading");
  const t = useCallback((key: string, parameters?: Record<string, string | number>) =>
    resolveMessage(language, key, parameters), [language]);
  const [startupFailure, setStartupFailure] = useState<string | null>(null);
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const openingHeading = useRef<HTMLHeadingElement>(null);
  const [openingCall, setOpeningCall] = useState<AssignedCall | null>(null);
  const [activeReport, setActiveReport] = useState<ActiveDraftReport | null>(null);
  useEffect(() => { if (openingCall) openingHeading.current?.focus(); }, [openingCall]);
  const [openReportsRevision, setOpenReportsRevision] = useState(0);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("mobile");
  const [completedCallNumbers, setCompletedCallNumbers] = useState<ReadonlyArray<string>>([]);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [dismissedActiveReportNoticeId, setDismissedActiveReportNoticeId] = useState<string | null>(null);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [, setReportWithErrorsId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
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
        const [loaded, authenticated] = await Promise.all([
          loadInstallationConfiguration(),
          serverRestart ? authenticateRestartedClinicianSession(loadedSession!) : loadedSession,
        ]);
        if (!current) return;
        if (serverRestart && !authenticated) clearClinicianSession(window.localStorage);
        try {
          const savedLanguage = window.localStorage.getItem("open-triage:ui-language");
          if (savedLanguage && availableUiLanguages.includes(savedLanguage)) setPreferredLanguage(savedLanguage);
        } catch { /* Language selection remains available without persistent storage. */ }
        setInstallation(loaded);
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
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (remaining <= 0) {
      queueMicrotask(() => void lockAndEndLocalSession(t("login.sessionExpired")));
      return;
    }
    const timeout = window.setTimeout(() => {
      void lockAndEndLocalSession(t("login.sessionExpired"));
    }, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [lockAndEndLocalSession, session, t]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  async function replacePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
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
        String(form.get("currentPassword") ?? ""), next, sessionRequestToken(session)
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
    recordFeedbackInteraction("session.logout.requested");
    const summary = protectedLogoutSummary();
    if (summary.pendingReportCount > 0) {
      setLogoutWarning(summary);
      return;
    }
    void logOut();
  }

  async function logOut() {
    const csrfToken = session ? sessionRequestToken(session) : "";
    setLockingSession(true);
    await lockAndEndLocalSession(t("login.loggedOut"));
    if (csrfToken) void endClinicianSession(csrfToken).catch(() => undefined);
  }

  function logoutDialogKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !lockingSession) setLogoutWarning(null);
  }

  function selectPresentationMode(mode: PresentationMode) {
    if ((mode === "admin" || mode === "review") && (activeReport || openingCall)) return;
    setModeMessage(null);
    recordFeedbackInteraction(`presentation.${mode}.selected`);
    storePresentationMode(window.localStorage, mode);
    setPresentationMode(mode);
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
  if (!session) {
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
            <label>
              {t("login.username")}
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              {t("login.password")}
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={submitting}>{submitting ? t("login.signingIn") : t("login.signIn")}</button>
          </div>
        </form>
      </main>
    );
  }
  if (session.passwordChangeRequired) {
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
  if (session.workspaceAvailable === false || session.capabilities?.length === 0) {
    return <main className="login-shell">
      <section className="login-card" aria-labelledby="no-workspace-heading">
        <p className="eyebrow">{t("login.signedIn")}</p>
        <h1 id="no-workspace-heading">{t("login.noWorkspace")}</h1>
        <p>{t("login.noWorkspaceHelp")}</p>
        <button type="button" onClick={requestLogout}>{t("navigation.logOut")}</button>
      </section>
    </main>;
  }

  return (
    <AgencyTimeZoneContext.Provider value={installation.settings.timeZone ?? null}>
    <RegionalFormatContext.Provider value={installation.settings.regionalFormat ?? null}>
    <div className={`authenticated-shell ${presentationMode}-shell`}>
      <header ref={sessionBar} className="session-bar">
        <LanguageSelector language={language} onChange={(selected) => {
          setPreferredLanguage(selected);
          try { window.localStorage.setItem("open-triage:ui-language", selected); } catch { /* Keep the session preference. */ }
        }} />
        {browserRequestConfiguration().mode === "server" &&
          <FeedbackControl language={language} csrfToken={sessionRequestToken(session)} online={online} mode={presentationMode}
            screen={presentationMode === "admin" ? "admin" : presentationMode === "review" ? "review" : activeReport ? "encounter" : "calls"} />}
        <span className="session-identity">{t("navigation.signedInAs", { name: session.user.displayName })}</span>
        <div className="presentation-selector" role="group" aria-label={t("navigation.presentation")}>
          {hasClinicalMode(session.capabilities) && <>
            <button type="button" aria-pressed={presentationMode === "mobile"} onClick={() => selectPresentationMode("mobile")}>{t("navigation.mobile")}</button>
            <button type="button" aria-pressed={presentationMode === "stationary"} onClick={() => selectPresentationMode("stationary")}>{t("navigation.stationary")}</button>
          </>}
          {hasAdminMode(session.capabilities) && <button type="button" aria-pressed={presentationMode === "admin"}
            disabled={activeReport !== null || openingCall !== null}
            onClick={() => selectPresentationMode("admin")}>{t("navigation.admin")}</button>}
          {hasReviewMode(session.capabilities) && <button type="button" aria-pressed={presentationMode === "review"}
            disabled={activeReport !== null || openingCall !== null}
            onClick={() => selectPresentationMode("review")}>{t("navigation.review")}</button>}
        </div>
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
      {presentationMode !== "admin" && presentationMode !== "review" && <div hidden={activeReport !== null || openingCall !== null}>
        <TransientNotice message={completionNotice} onDismiss={() => setCompletionNotice(null)} focusOnMount />
        <AssignedCalls session={session} language={language} refreshRequest={refreshRequest} focusAssignmentId={generatedAssignmentId}
          suppressedCallNumbers={completedCallNumbers} onOpeningChange={setOpeningCall} onOpened={async (opened, call) => {
          setCompletionNotice(null);
          await prepareProtectedReport(sessionRequestToken(session), opened.report.id);
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
      {presentationMode === "admin" && !activeReport && <AdminShell session={session} language={language} />}
      {presentationMode === "review" && !activeReport && <ReviewShell session={session} language={language} online={online} />}
    </div>
    </RegionalFormatContext.Provider>
    </AgencyTimeZoneContext.Provider>
  );
}
