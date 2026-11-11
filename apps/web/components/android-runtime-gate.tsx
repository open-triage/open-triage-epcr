"use client";
import React, { useEffect, useState } from "react";
import { AndroidConnection, installAndroidTransport, isAndroidRuntime, type PairingPreview, type AndroidConnectionState } from "../app/android-runtime";
import { MAX_PAIRING_BYTES, parseAndroidPairing } from "../app/android-pairing";
import { lockProtectedClinicalStorage } from "../app/protected-clinical-storage";
import { resolveMessage } from "../app/localization";

export function AndroidRuntimeGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false), [native, setNative] = useState(false), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PairingPreview | null>(null), [name, setName] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(false), [language, setLanguage] = useState("en");
  const [connection, setConnection] = useState<AndroidConnectionState | null>(null), [managedConflict, setManagedConflict] = useState(false);
  const t = (key: string) => resolveMessage(language, key);
  useEffect(() => {
    let active = true;
    let previousContext: string | undefined;
    let removeListener: (() => Promise<void>) | undefined;
    const applyState = (state: AndroidConnectionState) => {
      if (!active) return;
      setConnection(state); setReady(state.configured && !state.blocked);
      if (previousContext !== undefined && previousContext !== state.managedContext) { setPreview(null); setConfirmed(false); setName(""); }
      previousContext = state.managedContext;
      if (state.blocked) {
        // Lock existing readable work before abandoning the active connection's UI.
        // This retains eligible ciphertext using the shared recovery contract.
        void lockProtectedClinicalStorage().catch(() => { /* Native policy continues to deny requests. */ });
        setPreview(null); setConfirmed(false); setName("");
      }
    };
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!isAndroidRuntime()) { setReady(true); return; }
      setNative(true);
      setLanguage(navigator.language.startsWith("sv") ? "sv" : "en");
      installAndroidTransport();
      try {
        const listener = await AndroidConnection.addListener("configurationChanged", applyState);
        if (!active) { await listener.remove(); return; }
        removeListener = () => listener.remove();
        applyState(await AndroidConnection.state());
      } catch { if (active) setError(true); }
    });
    return () => { active = false; void removeListener?.(); };
  }, []);
  const managedNotice = connection?.managed ? <p role="status" className="android-managed-connection" data-managed-context={connection.managedContext} data-managed-status={connection.managedStatus}>{t("android.managed.locked")}{connection.managedOrigin ? ` · ${connection.managedOrigin}` : ""}</p> : null;
  if (ready) return children;
  if (!native) return null;
  return <main className="admin-directory installation-enrollment"><h1>{t("android.pairingTitle")}</h1>
    {managedNotice}
    {connection?.blocked ? <p role="alert" className="admin-error">{t(`android.managed.${["missing", "pending", "invalid", "changed"].includes(connection.managedStatus ?? "") ? connection.managedStatus : "unavailable"}`)}</p> : <>
    {error && <p role="alert" className="admin-error">{t(managedConflict ? "android.managed.conflict" : "android.pairingFailed")}</p>}
    {!preview ? <label>{t("android.importPairing")}<input type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setBusy(true); setError(false); setManagedConflict(false);
      try {
        if (file.size > MAX_PAIRING_BYTES) throw new Error();
        const artifact = await file.text(); parseAndroidPairing(artifact);
        setPreview(await AndroidConnection.preview({ artifact }));
      } catch (failure) { setManagedConflict((failure as { code?: string }).code === "MANAGED_CONFLICT"); setError(true); } finally { setBusy(false); }
    }} /></label> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(false); setManagedConflict(false);
      try { await AndroidConnection.confirm({ name, confirmInstallation: true }); setPreview(null); setReady(true); }
      catch (failure) { setManagedConflict((failure as { code?: string }).code === "MANAGED_CONFLICT"); setError(true); } finally { setBusy(false); }
    }}>
      <p>{preview.organizationName} — {preview.unitName} — {preview.callSign}</p><p>{preview.origin}</p>
      <label>{t("enrollment.name")}<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t("enrollment.confirm")}</label>
      <div className="admin-role-editor-actions"><button type="submit" className="button-primary" disabled={busy || !confirmed || !name.trim()}>{t("enrollment.title")}</button>
      <button type="button" disabled={busy} onClick={async () => { await AndroidConnection.cancel(); setPreview(null); setName(""); setConfirmed(false); setError(false); }}>{t("android.cancel")}</button></div>
    </form>}
    </>}
  </main>;
}
