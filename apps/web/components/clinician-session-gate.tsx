"use client";

import type { ClinicianSession } from "@open-triage/contracts";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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

export function ClinicianSessionGate({ children }: {
  readonly children: ReactNode | ((context: { session: ClinicianSession; report: ActiveDraftReport | null; closeReport: () => void }) => ReactNode);
}) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeReport, setActiveReport] = useState<ActiveDraftReport | null>(null);
  const [openCallsRevision, setOpenCallsRevision] = useState(0);
  const [lifecycleNotice, setLifecycleNotice] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setSession(loadClinicianSession(window.localStorage));
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
        setMessage("Your shift session expired. Sign in to continue.");
      });
      return;
    }
    const timeout = window.setTimeout(() => {
      clearClinicianSession(window.localStorage);
      setSession(null);
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

  if (!ready) return <main className="session-loading" aria-label="Loading OpenTriage" />;
  if (!session) {
    return (
      <main className="login-shell">
        <aside className="safety-notice" role="note" aria-label="Prototype safety notice">
          <strong>Synthetic data only</strong>
          <span>Usability prototype — not for clinical use</span>
        </aside>
        <form className="login-card" onSubmit={signIn}>
          <p className="eyebrow">Demo unit</p>
          <h1>Sign in for your shift</h1>
          <p>Use the prefilled synthetic clinician account to begin.</p>
          {message && <p className="login-message" role="status">{message}</p>}
          <label>
            Username
            <input name="username" autoComplete="username" defaultValue={DEMO_CLINICIAN_USERNAME} required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" defaultValue={DEMO_CLINICIAN_PASSWORD} required />
          </label>
          <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  return (
    <div className="authenticated-shell">
      <header className="session-bar">
        <span>Signed in as <strong>{session.user.displayName}</strong></span>
        <button type="button" onClick={logOut}>Log out</button>
      </header>
      <>
        <OpenCalls key={openCallsRevision} session={session} activeReportId={activeReport?.id} onCompleted={() => {
          setActiveReport(null);
          setLifecycleNotice("This report was completed on the stationary interface. Further edits have stopped.");
        }} onReopened={(opened) => {
          setLifecycleNotice(null);
          const cached = cacheReopenedReport(window.localStorage, session, opened);
          setActiveReport(cached.report);
        }} />
        <AssignedCalls session={session} onOpened={(opened, call) => {
          setLifecycleNotice(null);
          const cached = cacheOpenedReport(window.localStorage, session, opened, call.callNumber);
          setActiveReport(cached.report);
        }} />
      </>
      {lifecycleNotice && <p className="assignment-notice active-report-completed" role="status">{lifecycleNotice}</p>}
      {activeReport &&
        <p className="active-report-notice" role="status" data-report-id={activeReport.id} data-form-version-id={activeReport.formVersionId}>
          {activeReport.callNumber ? `Documenting call ${activeReport.callNumber} in its pinned form` : "Documenting opened call"}
        </p>
      }
      {!lifecycleNotice && (typeof children === "function" ? children({ session, report: activeReport, closeReport: () => {
        setActiveReport(null);
        setOpenCallsRevision((value) => value + 1);
      } }) : children)}
    </div>
  );
}
