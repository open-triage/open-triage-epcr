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

export function ClinicianSessionGate({ children }: { readonly children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      {children}
    </div>
  );
}
