"use client";
import { useEffect, useRef, useState } from "react";
import { AndroidConnection, type AndroidConnectionState } from "../app/android-runtime";
import { MAX_PAIRING_BYTES, parseAndroidPairing } from "../app/android-pairing";
import { resolveMessage } from "../app/localization";
import { transitionInstallation } from "../app/installation-transition";

export function AndroidPendingEnrollment({ state, language, onState }: { state: AndroidConnectionState; language: string; onState(state: AndroidConnectionState): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ origin: string; trustFingerprint: string } | null>(null), [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const t = (key: string) => resolveMessage(language, key);
  const failed = (reason: unknown) => {
    const code = (reason as { code?: string })?.code;
    const messages: Record<string, string> = { TLS_FAILED: "android.tlsFailed", MANAGED_CONFLICT: "android.managed.conflict", MANAGED_BLOCKED: "android.managed.unavailable", ENROLLMENT_NOT_COMMITTED: "android.pendingNotCommitted", ENROLLMENT_UNAVAILABLE: "android.pendingUnavailable" };
    if (mounted.current) setError(messages[code ?? ""] ?? "android.pairingFailed");
  };
  async function act(operation: () => Promise<AndroidConnectionState>) {
    setBusy(true); setError(null);
    try { const next = await operation(); if (mounted.current) onState(next); }
    catch (reason) { failed(reason); try { const next = await AndroidConnection.state(); if (mounted.current) onState(next); } catch { /* Keep the durable pending intent and current error. */ } }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="android-pending-enrollment" data-pending-enrollment>
    {state.pendingOutcome === "not-committed" ? <p role="status">{t("android.pendingNotCommitted")}</p> : state.pendingOutcome && state.pendingOutcome !== "pending" ? <p role="status">{t("android.pendingUnavailable")}</p> : null}
    {error && <p role="alert" className="admin-error">{t(error)}</p>}
    <div className="admin-role-editor-actions"><button type="button" disabled={busy || state.blocked} onClick={() => void act(() => transitionInstallation(() => AndroidConnection.resumeEnrollment(),"enrollment"))}>{t("android.retryPairing")}</button>
    {state.pendingOutcome === "not-committed" && <button type="button" disabled={busy || state.blocked} onClick={() => void act(() => transitionInstallation(() => AndroidConnection.abandonUncommittedEnrollment({ confirmAbandon: true }),"enrollment"))}>{t("android.pendingNewCode")}</button>}</div>
    {!preview ? <label>{t("android.pendingTrustFile")}<input type="file" accept="application/json,.json" disabled={busy || state.blocked} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      setBusy(true); setError(null);
      try {
        if (file.size > MAX_PAIRING_BYTES) throw new Error();
        const artifact = await file.text(); parseAndroidPairing(artifact);
        const next = await AndroidConnection.previewPendingTrust({ artifact });
        if (mounted.current) { setPreview(next); setConfirmed(false); }
      } catch (reason) { failed(reason); } finally { if (mounted.current) setBusy(false); }
    }} /></label> : <form onSubmit={event => { event.preventDefault(); void act(() => AndroidConnection.confirmPendingTrust({ confirmTrust: true })); }}>
      <p>{preview.origin}</p>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("android.pendingTrustConfirm")}</label>
      <div className="admin-role-editor-actions"><button type="submit" className="button-primary" disabled={busy || !confirmed}>{t("android.pendingTrustApply")}</button>
      <button type="button" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); }}>{t("android.cancel")}</button></div>
    </form>}
  </section>;
}
