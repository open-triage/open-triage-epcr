"use client";

import type { ClinicianSession, PublicInstallationConfiguration } from "@open-triage/contracts";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  clearClinicianSession,
  changeClinicianPassword,
  createClinicianSession,
  endClinicianSession,
  loadClinicianSession,
  storeClinicianSession,
  sessionRequestToken
} from "../app/clinician-session";
import { AssignedCalls } from "./assigned-calls";
import { OpenCalls } from "./open-calls";
import type { ActiveDraftReport } from "../app/draft-report";
import { cacheOpenedReport, cacheReopenedReport } from "../app/offline-reports";
import {
  hasAdminMode,
  hasClinicalMode,
  loadPresentationMode,
  storePresentationMode,
  type PresentationMode
} from "../app/presentation-mode";
import { loadInstallationConfiguration } from "../app/installation-settings";
import { AdminShell } from "./admin-shell";
import { browserRequestConfiguration } from "../app/browser-api";
import { ClinicalDemoBanner } from "./clinical-demo-banner";
import { shouldShowClinicalDemoBanner } from "../app/clinical-demo";

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
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeReport, setActiveReport] = useState<ActiveDraftReport | null>(null);
  const [openCallsRevision, setOpenCallsRevision] = useState(0);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("mobile");
  const [completedCallNumbers, setCompletedCallNumbers] = useState<ReadonlyArray<string>>([]);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [, setReportWithErrorsId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [generatedAssignmentId, setGeneratedAssignmentId] = useState<string | null>(null);
  const completionNoticeRef = useRef<HTMLParagraphElement>(null);
  const reportErrorStateChanged = useCallback((hasErrors: boolean) => {
    setReportWithErrorsId(hasErrors ? activeReport?.id ?? null : null);
  }, [activeReport?.id]);

  useEffect(() => {
    if (completionNotice) completionNoticeRef.current?.focus();
  }, [completionNotice]);

  useEffect(() => {
    let current = true;
    loadInstallationConfiguration().then((loaded) => {
      if (!current) return;
      const loadedSession = loadClinicianSession(window.localStorage);
      setInstallation(loaded);
      setSession(loadedSession);
      setPresentationMode(loadPresentationMode(window.localStorage, loadedSession?.capabilities));
    }).catch((reason: unknown) => {
      if (current) setMessage(reason instanceof Error ? reason.message : "Installation configuration is unavailable.");
    }).finally(() => {
      if (current) setReady(true);
    });
    return () => { current = false; };
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
      clearClinicianSession(window.localStorage);
      queueMicrotask(() => {
        setSession(null);
        setActiveReport(null);
        setMessage("Your shift session expired. Sign in to continue.");
      });
      return;
    }
    const timeout = window.setTimeout(() => {
      clearClinicianSession(window.localStorage);
      setSession(null);
      setActiveReport(null);
      setMessage("Your shift session expired. Sign in to continue.");
    }, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [session]);

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

  function logOut() {
    const csrfToken = session ? sessionRequestToken(session) : "";
    clearClinicianSession(window.localStorage);
    setSession(null);
    setActiveReport(null);
    setMessage("You have logged out.");
    if (csrfToken) void endClinicianSession(csrfToken).catch(() => undefined);
  }

  function selectPresentationMode(mode: PresentationMode) {
    if (mode === "admin" && activeReport) return;
    setModeMessage(null);
    storePresentationMode(window.localStorage, mode);
    setPresentationMode(mode);
  }

  const sessionEnded = useCallback(() => {
    clearClinicianSession(window.localStorage);
    setSession(null);
    setActiveReport(null);
    setMessage("Your shift session ended. Sign in again to sync your saved work.");
  }, []);

  if (!ready) return <main className="session-loading" aria-label="Loading OpenTriage" />;
  if (!installation) return <main className="login-shell"><p className="login-message" role="alert">{message ?? "Installation configuration is unavailable."}</p></main>;
  const installationSettings = installation.settings;
  if (!session) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={signIn}>
          <p className="eyebrow">{installationSettings.syntheticFixtures.enabled ? "Demo unit" : "Clinical documentation"}</p>
          <h1>Sign in for your shift</h1>
          <p>{installationSettings.syntheticFixtures.enabled ? "Use the prefilled synthetic demo account to begin." : "Enter your organization credentials to begin."}</p>
          {message && <p className="login-message" role="status">{message}</p>}
          <label>
            Username
            <input name="username" autoComplete="username" defaultValue={installation.demoLogin?.username ?? ""} required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" defaultValue={installation.demoLogin?.password ?? ""} required />
          </label>
          <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
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
        <button type="button" onClick={logOut}>Log out</button>
      </section>
    </main>;
  }

  return (
    <div className={`authenticated-shell ${presentationMode}-shell`}>
      <header className="session-bar">
        {presentationMode !== "admin"
          ? <button className="call-list-refresh" type="button" aria-label="Refresh calls" onClick={() => setRefreshRequest((value) => value + 1)}>Refresh</button>
          : <span className="call-list-refresh session-bar-placeholder" aria-hidden="true" />}
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
        <button type="button" onClick={logOut}>Log out</button>
      </header>
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
            setOpenCallsRevision((value) => value + 1);
            setRefreshRequest((value) => value + 1);
          }}
        />}
      {presentationMode !== "admin" && <div hidden={activeReport !== null}>
        {completionNotice && <p ref={completionNoticeRef} className="assignment-notice" role="status" tabIndex={-1}>{completionNotice}</p>}
        <AssignedCalls session={session} refreshRequest={refreshRequest} focusAssignmentId={generatedAssignmentId}
          suppressedCallNumbers={completedCallNumbers} onOpened={(opened, call) => {
          setCompletionNotice(null);
          const cached = cacheOpenedReport(window.localStorage, session, opened, call);
          setActiveReport(cached.report);
        }} />
        <OpenCalls key={openCallsRevision} session={session} refreshRequest={refreshRequest} activeReportId={activeReport?.id} onSessionEnded={sessionEnded} onCompleted={() => {
          setActiveReport(null);
        }} onReopened={(opened) => {
          const cached = cacheReopenedReport(window.localStorage, session, opened);
          setActiveReport(cached.report);
        }} />
      </div>}
      {activeReport &&
        <p className="active-report-notice" role="status" data-report-id={activeReport.id} data-form-version-id={activeReport.formVersionId}>
          {activeReport.callNumber ? `Documenting call ${activeReport.callNumber} in its pinned form` : "Documenting opened call"}
        </p>
      }
      {activeReport && (typeof children === "function" ? children({ session, report: activeReport, sessionEnded, presentationMode,
        reportErrorStateChanged, closeReport: () => {
        setActiveReport(null);
        setOpenCallsRevision((value) => value + 1);
      }, completeReport: () => {
        if (activeReport.callNumber) setCompletedCallNumbers((current) => current.includes(activeReport.callNumber!) ? current : [...current, activeReport.callNumber!]);
        setCompletionNotice(activeReport.callNumber ? `Call ${activeReport.callNumber} was signed and removed from active calls.` : "The report was signed and removed from active calls.");
        setActiveReport(null);
        setOpenCallsRevision((value) => value + 1);
      } }) : children)}
      {presentationMode === "admin" && !activeReport && <AdminShell session={session} installationSettings={installationSettings} />}
    </div>
  );
}
