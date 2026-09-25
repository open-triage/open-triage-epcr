"use client";

import type { ClinicianSession, PublicInstallationConfiguration } from "@open-triage/contracts";
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
import { AssignedCalls } from "./assigned-calls";
import { OpenReports } from "./open-reports";
import type { ActiveDraftReport } from "../app/draft-report";
import { cacheOpenedReport, cacheReopenedReport, clearProtectedRuntimeReports } from "../app/offline-reports";
import {
  hasAdminMode,
  hasClinicalMode,
  loadPresentationMode,
  storePresentationMode,
  type PresentationMode
} from "../app/presentation-mode";
import { applyAgencyAppearance, loadInstallationConfiguration } from "../app/installation-settings";
import { AdminShell } from "./admin-shell";
import { browserRequestConfiguration } from "../app/browser-api";
import { ClinicalDemoBanner } from "./clinical-demo-banner";
import { shouldShowClinicalDemoBanner } from "../app/clinical-demo";
import { FeedbackControl } from "./feedback-control";
import { clearFeedbackTelemetry, installFeedbackRequestTracking, recordFeedbackInteraction } from "../app/feedback-telemetry";
import { TransientNotice } from "./transient-notice";
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
  }) => ReactNode);
}) {
  const [installation, setInstallation] = useState<PublicInstallationConfiguration | null>(null);
  const [ready, setReady] = useState(false);
  const [restartReconnectPending, setRestartReconnectPending] = useState(false);
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeReport, setActiveReport] = useState<ActiveDraftReport | null>(null);
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
  const reportErrorStateChanged = useCallback((hasErrors: boolean) => {
    setReportWithErrorsId(hasErrors ? activeReport?.id ?? null : null);
  }, [activeReport?.id]);

  useEffect(() => {
    return installFeedbackRequestTracking(window);
  }, []);

  useEffect(() => {
    if (installation) applyAgencyAppearance(installation.appearance, document);
  }, [installation]);

  useEffect(() => {
    if (logoutWarning) logoutDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [logoutWarning]);

  const lockAndEndLocalSession = useCallback(async (endedMessage: string) => {
    clearClinicianSession(window.localStorage);
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
    if (serverRestart) queueMicrotask(() => {
      if (current) setRestartReconnectPending(true);
    });

    const load = async () => {
      if (inFlight || resolved) return;
      inFlight = true;
      try {
        const loaded = await loadInstallationConfiguration();
        const authenticated = serverRestart
          ? await authenticateRestartedClinicianSession(loadedSession!)
          : loadedSession;
        if (!current) return;
        if (serverRestart && !authenticated) clearClinicianSession(window.localStorage);
        setInstallation(loaded);
        setSession(authenticated);
        setPresentationMode(loadPresentationMode(window.localStorage, authenticated?.capabilities));
        setRestartReconnectPending(false);
        resolved = true;
      } catch (reason: unknown) {
        if (!current) return;
        if (!serverRestart) setMessage(reason instanceof Error ? reason.message : "Installation configuration is unavailable.");
      } finally {
        inFlight = false;
        if (current) setReady(true);
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
      queueMicrotask(() => void lockAndEndLocalSession("Your shift session expired. Sign in to continue."));
      return;
    }
    const timeout = window.setTimeout(() => {
      void lockAndEndLocalSession("Your shift session expired. Sign in to continue.");
    }, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [lockAndEndLocalSession, session]);

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
      setMessage(error instanceof Error ? error.message : "Sign in is unavailable.");
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
      setMessage("The new passwords do not match.");
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
      setMessage(error instanceof Error ? error.message : "The password could not be changed.");
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
    await lockAndEndLocalSession("You have logged out.");
    if (csrfToken) void endClinicianSession(csrfToken).catch(() => undefined);
  }

  function logoutDialogKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !lockingSession) setLogoutWarning(null);
  }

  function selectPresentationMode(mode: PresentationMode) {
    if (mode === "admin" && activeReport) return;
    setModeMessage(null);
    recordFeedbackInteraction(`presentation.${mode}.selected`);
    storePresentationMode(window.localStorage, mode);
    setPresentationMode(mode);
  }

  const sessionEnded = useCallback(() => {
    void lockAndEndLocalSession("Your shift session ended. Sign in again to sync your saved work.");
  }, [lockAndEndLocalSession]);

  if (!ready || restartReconnectPending) return <main className="session-loading" aria-label="Reconnecting securely">
    <p>Reconnect to continue.</p>
  </main>;
  if (!installation) return <main className="login-shell"><p className="login-message" role="alert">{message ?? "Installation configuration is unavailable."}</p></main>;
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
            <h1>Sign in</h1>
            <p>{emphasizedText(installation.settings.signIn.helperText)}</p>
          </header>
          <div className="login-fields">
            {message && <p className="login-message" role="status">{message}</p>}
            <label>
              Username
              <input name="username" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
          </div>
        </form>
      </main>
    );
  }
  if (session.passwordChangeRequired) {
    return <main className="login-shell">
      <form className="login-card" onSubmit={replacePassword}>
        <p className="eyebrow">Account security</p>
        <h1>Replace temporary password</h1>
        <p>Your temporary password can only open this password-replacement screen.</p>
        {message && <p className="login-message" role="status">{message}</p>}
        <label>Temporary password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
        <button type="submit" disabled={submitting}>{submitting ? "Replacing…" : "Replace password"}</button>
      </form>
    </main>;
  }
  if (session.workspaceAvailable === false || session.capabilities?.length === 0) {
    return <main className="login-shell">
      <section className="login-card" aria-labelledby="no-workspace-heading">
        <p className="eyebrow">Signed in</p>
        <h1 id="no-workspace-heading">No workspace assigned</h1>
        <p>Your account is active, but it does not have an active workspace role. Contact an administrator for access.</p>
        <button type="button" onClick={requestLogout}>Log out</button>
      </section>
    </main>;
  }

  return (
    <div className={`authenticated-shell ${presentationMode}-shell`}>
      <header className="session-bar">
        {browserRequestConfiguration().mode === "server" &&
          <FeedbackControl csrfToken={sessionRequestToken(session)} online={online} mode={presentationMode}
            screen={presentationMode === "admin" ? "admin" : activeReport ? "encounter" : "calls"} />}
        {presentationMode !== "admin"
          ? <button className="call-list-refresh" type="button" aria-label="Refresh calls" onClick={() => {
            recordFeedbackInteraction("session.refresh.requested");
            setRefreshRequest((value) => value + 1);
          }}>Refresh</button>
          : <span className="call-list-refresh session-bar-spacer" aria-hidden="true" />}
        <span className="session-identity">Signed in as <strong>{session.user.displayName}</strong></span>
        <div className="presentation-selector" role="group" aria-label="Documentation presentation">
          {hasClinicalMode(session.capabilities) && <>
            <button type="button" aria-pressed={presentationMode === "mobile"} onClick={() => selectPresentationMode("mobile")}>Mobile</button>
            <button type="button" aria-pressed={presentationMode === "stationary"} onClick={() => selectPresentationMode("stationary")}>Stationary</button>
          </>}
          {hasAdminMode(session.capabilities) && <button type="button" aria-pressed={presentationMode === "admin"}
            disabled={activeReport !== null}
            onClick={() => selectPresentationMode("admin")}>Admin</button>}
        </div>
        <button type="button" onClick={requestLogout}>Log out</button>
      </header>
      {logoutWarning && <div className="dialog-backdrop logout-backdrop" role="presentation">
        <section ref={logoutDialog} className="note-dialog logout-dialog" role="alertdialog" aria-modal="true"
          aria-labelledby={logoutHeadingId} onKeyDown={logoutDialogKeys}>
          <div className="note-dialog-heading"><div><p className="eyebrow">Pending protected work</p>
            <h2 id={logoutHeadingId}>Log out and lock this work?</h2></div></div>
          <p role="note">{logoutWarning.pendingReportCount === 1 ? "One report has" : `${logoutWarning.pendingReportCount} reports have`} unsynchronized changes. Logging out will immediately remove readable access from this browser.</p>
          <p className="feedback-warning"><strong>Recovery deadline:</strong> {logoutWarning.recoveryDeadline
            ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(logoutWarning.recoveryDeadline))
            : "Unavailable"}. Sign in as the same clinician before this deadline to recover the encrypted work.</p>
          <div className="note-dialog-actions">
            <button type="button" disabled={lockingSession} onClick={() => setLogoutWarning(null)}>Stay signed in</button>
            <button type="button" disabled={lockingSession} onClick={() => void logOut()}>{lockingSession ? "Locking…" : "Log out and lock work"}</button>
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
      {presentationMode !== "admin" && <div hidden={activeReport !== null}>
        <TransientNotice message={completionNotice} onDismiss={() => setCompletionNotice(null)} focusOnMount />
        <AssignedCalls session={session} refreshRequest={refreshRequest} focusAssignmentId={generatedAssignmentId}
          suppressedCallNumbers={completedCallNumbers} onOpened={async (opened, call) => {
          setCompletionNotice(null);
          await prepareProtectedReport(sessionRequestToken(session), opened.report.id);
          const cached = cacheOpenedReport(window.localStorage, session, opened, call);
          await flushProtectedReport(opened.report.id);
          setDismissedActiveReportNoticeId(null);
          setActiveReport(cached.report);
        }} />
        <OpenReports key={openReportsRevision} session={session} refreshRequest={refreshRequest} activeReportId={activeReport?.id} onSessionEnded={sessionEnded} onCompleted={() => {
          setActiveReport(null);
        }} onReopened={(opened) => {
          const cached = cacheReopenedReport(window.localStorage, session, opened);
          setDismissedActiveReportNoticeId(null);
          setActiveReport(cached.report);
        }} />
      </div>}
      <TransientNotice
        message={activeReport && dismissedActiveReportNoticeId !== activeReport.id
          ? activeReport.callNumber ? `Documenting call ${activeReport.callNumber} in its pinned form` : "Documenting opened call"
          : null}
        onDismiss={() => setDismissedActiveReportNoticeId(activeReport?.id ?? null)}
        className="active-report-notice"
        data-report-id={activeReport?.id}
        data-form-version-id={activeReport?.formVersionId}
      />
      {activeReport && (typeof children === "function" ? children({ session, report: activeReport, sessionEnded, presentationMode,
        reportErrorStateChanged, closeReport: () => {
        setActiveReport(null);
        setOpenReportsRevision((value) => value + 1);
      }, completeReport: () => {
        if (activeReport.callNumber) setCompletedCallNumbers((current) => current.includes(activeReport.callNumber!) ? current : [...current, activeReport.callNumber!]);
        setCompletionNotice(activeReport.callNumber ? `Call ${activeReport.callNumber} was signed and removed from active calls.` : "The report was signed and removed from active calls.");
        setActiveReport(null);
        setOpenReportsRevision((value) => value + 1);
      } }) : children)}
      {presentationMode === "admin" && !activeReport && <AdminShell session={session} />}
    </div>
  );
}
