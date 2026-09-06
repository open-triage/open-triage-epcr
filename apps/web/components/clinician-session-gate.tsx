"use client";

import type { ClinicianSession } from "@open-triage/contracts";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  clearClinicianSession,
  createClinicianSession,
  DEMO_CLINICIAN_PASSWORD,
  DEMO_CLINICIAN_USERNAME,
  endClinicianSession,
  loadClinicianSession,
  storeClinicianSession
} from "../app/clinician-session";
import { AssignedCalls } from "./assigned-calls";
import { OpenCalls } from "./open-calls";
import type { ActiveDraftReport } from "../app/draft-report";
import { cacheOpenedReport, cacheReopenedReport } from "../app/offline-reports";
import { loadPresentationMode, storePresentationMode, type PresentationMode } from "../app/presentation-mode";
import { DEMO_CLEAR_EVENT, DEMO_POPULATE_EVENT } from "../app/demo-provenance";
import { selectedInstallationSettings } from "../app/installation-settings";

export function ClinicianSessionGate({ children }: {
  readonly children: ReactNode | ((context: {
    session: ClinicianSession;
    report: ActiveDraftReport | null;
    closeReport: () => void;
    completeReport: () => void;
    sessionEnded: () => void;
    presentationMode: PresentationMode;
  }) => ReactNode);
}) {
  const installationSettings = selectedInstallationSettings();
  const banner = installationSettings.syntheticDataBanner;
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
  const completionNoticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (completionNotice) completionNoticeRef.current?.focus();
  }, [completionNotice]);

  useEffect(() => {
    queueMicrotask(() => {
      setSession(loadClinicianSession(window.localStorage));
      setPresentationMode(loadPresentationMode(window.localStorage));
      setReady(true);
    });
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in is unavailable.");
    } finally {
      setSubmitting(false);
    }
  }

  function logOut() {
    const accessToken = session?.accessToken;
    clearClinicianSession(window.localStorage);
    setSession(null);
    setActiveReport(null);
    setMessage("You have logged out.");
    if (accessToken) void endClinicianSession(accessToken).catch(() => undefined);
  }

  function selectPresentationMode(mode: PresentationMode) {
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
  if (!session) {
    return (
      <main className="login-shell">
        {banner.enabled && <aside className="safety-notice" role="note" aria-label="Prototype safety notice">
          <strong>{banner.heading}</strong>
          <span>{banner.message}</span>
        </aside>}
        <form className="login-card" onSubmit={signIn}>
          <p className="eyebrow">{installationSettings.syntheticFixtures.enabled ? "Demo unit" : "Clinical documentation"}</p>
          <h1>Sign in for your shift</h1>
          <p>{installationSettings.syntheticFixtures.enabled ? "Use the prefilled synthetic clinician account to begin." : "Enter your organization credentials to begin."}</p>
          {message && <p className="login-message" role="status">{message}</p>}
          <label>
            Username
            <input name="username" autoComplete="username" defaultValue={installationSettings.syntheticFixtures.enabled ? DEMO_CLINICIAN_USERNAME : ""} required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" defaultValue={installationSettings.syntheticFixtures.enabled ? DEMO_CLINICIAN_PASSWORD : ""} required />
          </label>
          <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  return (
    <div className={`authenticated-shell ${presentationMode}-shell`}>
      <header className="session-bar">
        <button className="call-list-refresh" type="button" aria-label="Refresh calls" onClick={() => setRefreshRequest((value) => value + 1)}>Refresh</button>
        <span className="session-identity">Signed in as <strong>{session.user.displayName}</strong></span>
        <div className="presentation-selector" role="group" aria-label="Documentation presentation">
          <button type="button" aria-pressed={presentationMode === "mobile"} onClick={() => selectPresentationMode("mobile")}>Mobile</button>
          <button type="button" aria-pressed={presentationMode === "stationary"} onClick={() => selectPresentationMode("stationary")}>Stationary</button>
        </div>
        <button type="button" onClick={logOut}>Log out</button>
      </header>
      {banner.enabled && <aside className="safety-notice" role="note" aria-label="Prototype safety notice">
        <strong>{banner.heading}</strong>
        <span>{banner.message}</span>
        {installationSettings.syntheticFixtures.enabled && activeReport && <span className="demo-data-controls" role="group" aria-label="Demo record data">
          <button type="button" onClick={() => window.dispatchEvent(new Event(DEMO_POPULATE_EVENT))}>Populate</button>
          <button type="button" onClick={() => window.dispatchEvent(new Event(DEMO_CLEAR_EVENT))}>Clear</button>
        </span>}
      </aside>}
      <div hidden={activeReport !== null}>
        {completionNotice && <p ref={completionNoticeRef} className="assignment-notice" role="status" tabIndex={-1}>{completionNotice}</p>}
        <AssignedCalls session={session} refreshRequest={refreshRequest} suppressedCallNumbers={completedCallNumbers} onOpened={(opened, call) => {
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
      </div>
      {activeReport &&
        <p className="active-report-notice" role="status" data-report-id={activeReport.id} data-form-version-id={activeReport.formVersionId}>
          {activeReport.callNumber ? `Documenting call ${activeReport.callNumber} in its pinned form` : "Documenting opened call"}
        </p>
      }
      {activeReport && (typeof children === "function" ? children({ session, report: activeReport, sessionEnded, presentationMode, closeReport: () => {
        setActiveReport(null);
        setOpenCallsRevision((value) => value + 1);
      }, completeReport: () => {
        if (activeReport.callNumber) setCompletedCallNumbers((current) => current.includes(activeReport.callNumber!) ? current : [...current, activeReport.callNumber!]);
        setCompletionNotice(activeReport.callNumber ? `Call ${activeReport.callNumber} was signed and removed from active calls.` : "The report was signed and removed from active calls.");
        setActiveReport(null);
        setOpenCallsRevision((value) => value + 1);
      } }) : children)}
    </div>
  );
}
