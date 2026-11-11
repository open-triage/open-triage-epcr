"use client";
import React, { useEffect, useState } from "react";
import { AndroidConnection, installAndroidTransport, isAndroidRuntime, type PairingPreview } from "../app/android-runtime";
import { MAX_PAIRING_BYTES, parseAndroidPairing } from "../app/android-pairing";
import { resolveMessage } from "../app/localization";

export function AndroidRuntimeGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false), [native, setNative] = useState(false), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PairingPreview | null>(null), [name, setName] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(false), [language, setLanguage] = useState("en");
  const t = (key: string) => resolveMessage(language, key);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!isAndroidRuntime()) { setReady(true); return; }
      setNative(true);
      setLanguage(navigator.language.startsWith("sv") ? "sv" : "en");
      installAndroidTransport();
      try { const state = await AndroidConnection.state(); if (active) setReady(state.configured); }
      catch { if (active) setError(true); }
    });
    return () => { active = false; };
  }, []);
  if (ready) return children;
  if (!native) return null;
  return <main className="admin-directory installation-enrollment"><h1>{t("android.pairingTitle")}</h1>
    {error && <p role="alert" className="admin-error">{t("android.pairingFailed")}</p>}
    {!preview ? <label>{t("android.importPairing")}<input type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setBusy(true); setError(false);
      try {
        if (file.size > MAX_PAIRING_BYTES) throw new Error();
        const artifact = await file.text(); parseAndroidPairing(artifact);
        setPreview(await AndroidConnection.preview({ artifact }));
      } catch { setError(true); } finally { setBusy(false); }
    }} /></label> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(false);
      try { await AndroidConnection.confirm({ name, confirmInstallation: true }); setPreview(null); setReady(true); }
      catch { setError(true); } finally { setBusy(false); }
    }}>
      <p>{preview.organizationName} — {preview.unitName} — {preview.callSign}</p><p>{preview.origin}</p>
      <label>{t("enrollment.name")}<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t("enrollment.confirm")}</label>
      <div className="admin-role-editor-actions"><button type="submit" className="button-primary" disabled={busy || !confirmed || !name.trim()}>{t("enrollment.title")}</button>
      <button type="button" disabled={busy} onClick={async () => { await AndroidConnection.cancel(); setPreview(null); setName(""); setConfirmed(false); setError(false); }}>{t("android.cancel")}</button></div>
    </form>}
  </main>;
}
