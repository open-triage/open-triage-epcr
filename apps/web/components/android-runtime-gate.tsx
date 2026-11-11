"use client";
import React, { useEffect, useState } from "react";
import { AndroidConnection, installAndroidTransport, isAndroidRuntime, type PairingPreview } from "../app/android-runtime";
import { MAX_PAIRING_BYTES, parseAndroidPairing } from "../app/android-pairing";
import { AndroidScanner, parseAndroidPairingQr, scannerFailureMessage } from "../app/android-scanner";
import { resolveMessage } from "../app/localization";
import { installAndroidLifecycle } from "../app/android-lifecycle";

export function AndroidRuntimeGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false), [native, setNative] = useState(false), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PairingPreview | null>(null), [name, setName] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null), [language, setLanguage] = useState("en");
  const t = (key: string) => resolveMessage(language, key);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!isAndroidRuntime()) { setReady(true); return; }
      setNative(true);
      setLanguage(navigator.language.startsWith("sv") ? "sv" : "en");
      installAndroidTransport();
      try { await installAndroidLifecycle(); const state = await AndroidConnection.state(); if (active) setReady(state.configured); }
      catch { if (active) setError("android.pairingFailed"); }
    });
    return () => { active = false; };
  }, []);
  async function preparePairing(artifact: string, source: "scan" | "import") {
    if (source === "scan") parseAndroidPairingQr(artifact); else parseAndroidPairing(artifact);
    const next = await AndroidConnection.preview({ artifact });
    setName(""); setConfirmed(false); setPreview(next);
  }
  if (ready) return children;
  if (!native) return null;
  return <main className="admin-directory installation-enrollment"><h1>{t("android.pairingTitle")}</h1>
    {error && <p role="alert" className="admin-error">{t(error)}</p>}
    {!preview ? <><button type="button" className="button-primary" data-pairing-scan disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { const result = await AndroidScanner.scan(); if (!result.cancelled) await preparePairing(result.artifact, "scan"); }
      catch (reason) { setError(scannerFailureMessage(reason)); } finally { setBusy(false); }
    }}>{t("android.scanPairing")}</button>
    <label>{t("android.importPairing")}<input type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setBusy(true); setError(null);
      try {
        if (file.size > MAX_PAIRING_BYTES) throw new Error();
        await preparePairing(await file.text(), "import");
      } catch { setError("android.pairingFailed"); } finally { setBusy(false); }
    }} /></label></> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(null);
      try { await installAndroidLifecycle(); await AndroidConnection.confirm({ name, confirmInstallation: true }); setPreview(null); setReady(true); }
      catch { setError("android.pairingFailed"); } finally { setBusy(false); }
    }}>
      <p>{preview.organizationName} — {preview.unitName} — {preview.callSign}</p><p>{preview.origin}</p>
      <label>{t("enrollment.name")}<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t("enrollment.confirm")}</label>
      <div className="admin-role-editor-actions"><button type="submit" className="button-primary" disabled={busy || !confirmed || !name.trim()}>{t("enrollment.title")}</button>
      <button type="button" disabled={busy} onClick={async () => { await AndroidConnection.cancel(); setPreview(null); setName(""); setConfirmed(false); setError(null); }}>{t("android.cancel")}</button></div>
    </form>}
  </main>;
}
