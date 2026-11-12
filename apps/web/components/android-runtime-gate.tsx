"use client";
import {clearAgencyHandoffCaches,storeAgencyHandoffSession} from "../app/agency-session";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AndroidConnection, configureNativeConnection, installAndroidTransport, isAndroidRuntime, type PairingPreview, type AndroidConnectionState } from "../app/android-runtime";
import { MAX_PAIRING_BYTES, parseAndroidPairing } from "../app/android-pairing";
import { AndroidScanner, parseAndroidPairingQr, scannerFailureMessage } from "../app/android-scanner";
import { clearProtectedRuntimeReports } from "../app/offline-reports";
import { lockProtectedClinicalStorage } from "../app/protected-clinical-storage";
import { resolveMessage } from "../app/localization";
import {INSTALLATION_GENERATION_KEY} from "../app/installation-transition-generation";
import { transitionInstallation, resumeNativeInstallationTransition, INSTALLATION_TRANSITION_KEY, INSTALLATION_TRANSITION_COMPLETE_EVENT } from "../app/installation-transition";
import { AndroidInstallationAction, ANDROID_REPLACE_INSTALLATION } from "./android-installation-action";
import { installAndroidLifecycle } from "../app/android-lifecycle";
import { AndroidTlsNotice } from "./android-tls-notice";
import { AndroidPendingEnrollment } from "./android-pending-enrollment";

export function AndroidRuntimeGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false), [native, setNative] = useState(false), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PairingPreview | null>(null), [name, setName] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null), [language, setLanguage] = useState("en");
  const [connection, setConnection] = useState<AndroidConnectionState | null>(null);
  const [recoveringTransition,setRecoveringTransition]=useState(false);
  const currentState = useRef<AndroidConnectionState | null>(null), revision = useRef(0), mounted = useRef(false);
  const applyState = useCallback((state: AndroidConnectionState) => {
    if (!mounted.current) return;
    const previous = currentState.current;
    const identity = (value: AndroidConnectionState | null) => JSON.stringify(value && [value.origin, value.connectionContext, value.replacementPending, value.handoffPending, value.handoffComplete, value.configured, value.blocked, value.managed, value.managedStatus, value.managedContext, value.managedOrigin]);
    if (identity(previous) !== identity(state)) revision.current++;
    configureNativeConnection(state);
    currentState.current = state;
    const interrupted=state.configured&&!state.blocked&&!state.replacementPending&&!state.handoffPending&&Boolean(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY));
    setConnection(state); setRecoveringTransition(interrupted); setReady(state.configured && !state.blocked&&!state.handoffPending&&!interrupted);
    if (previous?.managedContext !== state.managedContext || state.blocked || previous?.replacementPending && !state.replacementPending) { setPreview(null); setConfirmed(false); setName(""); }
    if (state.blocked) {
      // Shared locking retains eligible ciphertext while removing readable work.
      void lockProtectedClinicalStorage().catch(() => { /* Native policy still denies requests. */ });
    }
  }, []);
  const isCurrent = (started: number) => mounted.current && revision.current === started && !currentState.current?.blocked;
  const failureMessage = (failure: unknown, source?: "scan") => {
    const code = (failure as { code?: string })?.code;
    if (code === "MANAGED_CONFLICT") return "android.managed.conflict";
    if (code === "MANAGED_BLOCKED") return "android.managed.unavailable";
    if (code === "TLS_FAILED") return "android.tlsFailed";
    if (code === "ENROLLMENT_NOT_COMMITTED") return "android.pendingNotCommitted";
    if (code === "ENROLLMENT_UNAVAILABLE") return "android.pendingUnavailable";
    return source === "scan" ? scannerFailureMessage(failure) : "android.pairingFailed";
  };
  const t = (key: string) => resolveMessage(language, key);
  useEffect(() => {
    let active = true;
    let checking=false,waiting=false;
    const stillWaiting=()=>Boolean(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY))&&(!currentState.current||currentState.current.configured&&!currentState.current.blocked&&!currentState.current.replacementPending);
    const observe=async(provided?:AndroidConnectionState)=>{
      if(checking||!active||!isAndroidRuntime())return;
      checking=true;
      const observedRevision=revision.current;
      try {
        const state=provided??await AndroidConnection.state();
        if(!active||revision.current!==observedRevision){waiting=stillWaiting();return;}
        const next=await resumeNativeInstallationTransition(state,(context,purpose)=>AndroidConnection.reconcileTransition({connectionContext:context,purpose}),()=>active&&revision.current===observedRevision);
        if(!active||revision.current!==observedRevision){waiting=stillWaiting();return;}
        waiting=next===null;
        if(active)applyState(next??state);
      } catch {
        if(!active||revision.current!==observedRevision){waiting=stillWaiting();return;}
        waiting=Boolean(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY));
        if(active&&waiting){setRecoveringTransition(true);setReady(false);}
        if(active&&!waiting)applyState({configured:false,blocked:true,managedStatus:"unavailable"});
      } finally {checking=false;}
    };
    const retry=()=>{if(waiting)void observe();};
    const storage=(event:StorageEvent)=>{if(event.key===INSTALLATION_TRANSITION_KEY)void observe();};
    const completed=()=>{void observe();};
    const timer=window.setInterval(retry,250);
    window.addEventListener("storage",storage);window.addEventListener(INSTALLATION_TRANSITION_COMPLETE_EVENT,completed);
    const generation = revision;
    const replace = () => {
      setBusy(true); setReady(false); setError(null);
      void AndroidConnection.beginReplacement().then(async state => {
        try { await lockProtectedClinicalStorage(); } finally { clearProtectedRuntimeReports(); }
        applyState(state);
      })
        .catch(failure => { if (active) setError(failureMessage(failure)); })
        .finally(() => { if (active) setBusy(false); });
    };
    window.addEventListener(ANDROID_REPLACE_INSTALLATION, replace);
    mounted.current = true;
    let removeListener: (() => Promise<void>) | undefined;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!isAndroidRuntime()) { setReady(true); return; }
      setNative(true);
      setLanguage(navigator.language.startsWith("sv") ? "sv" : "en");
      installAndroidTransport();
      try {
        await installAndroidLifecycle();
        if (!active) return;
        const listener = await AndroidConnection.addListener("configurationChanged", state => {
          if(!active)return;
          // Every policy edge invalidates outstanding scans/previews immediately,
          // including changed-and-restored events in one JavaScript task.
          applyState(state);
          if(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY))void observe(state);
        });
        if (!active) { await listener.remove(); return; }
        removeListener = () => listener.remove();
        const started = revision.current;
        const state = await AndroidConnection.state();
        if (active && revision.current === started) await observe(state);
      } catch { if (active) applyState({configured: false, blocked: true, managedStatus: "unavailable"}); }
    });
    return () => { active = false; mounted.current = false;window.clearInterval(timer);window.removeEventListener("storage",storage);window.removeEventListener(INSTALLATION_TRANSITION_COMPLETE_EVENT,completed); window.removeEventListener(ANDROID_REPLACE_INSTALLATION, replace); generation.current++; void removeListener?.(); };
  }, [applyState]);
  async function preparePairing(artifact: string, source: "scan" | "import", started: number) {
    if (!isCurrent(started)) return;
    if (source === "scan") parseAndroidPairingQr(artifact); else parseAndroidPairing(artifact);
    const next = await AndroidConnection.preview({ artifact });
    if (isCurrent(started)) { setName(""); setConfirmed(false); setPreview(next); }
  }
  const managedNotice = connection?.managed ? <p role="status" className="android-managed-connection" data-managed-context={connection.managedContext} data-managed-status={connection.managedStatus}>{t("android.managed.locked")}{connection.managedOrigin ? ` · ${connection.managedOrigin}` : ""}</p> : null;
  if (ready) return <><AndroidTlsNotice />{children}</>;
  if(recoveringTransition)return <main role="status" aria-busy="true">{t("login.opening")}</main>;
  if (!native || !connection) return null;
  return <main className="admin-directory installation-enrollment"><h1>{t("android.pairingTitle")}</h1>
    {managedNotice}
    {connection?.blocked ? <><p role="alert" className="admin-error">{t(`android.managed.${["missing", "pending", "invalid", "changed"].includes(connection.managedStatus ?? "") ? connection.managedStatus : "unavailable"}`)}</p>{connection.managedStatus === "changed" && <AndroidInstallationAction language={language} />}</> : <>
    {error && <p role="alert" className="admin-error">{t(error)}</p>}
    {connection.handoffPending ? <><p role="alert">{t(connection.handoffComplete?"android.handoffComplete":"android.handoffInterrupted")}</p><button type="button" disabled={busy} onClick={async()=>{
      setBusy(true);setError(null);const started=revision.current,context=currentState.current?.connectionContext;
      let owned:string|null=null;
      const sameGeneration=()=>owned===window.localStorage.getItem(INSTALLATION_GENERATION_KEY);
      try {
        const completed=await transitionInstallation(async()=>{
          owned=window.localStorage.getItem(INSTALLATION_GENERATION_KEY);
          const state=await (connection.handoffComplete?AndroidConnection.resumeAgencyHandoff({connectionContext:context}):AndroidConnection.cancelAgencyHandoff({connectionContext:context}));
          if(!sameGeneration()||!mounted.current||currentState.current?.blocked||revision.current!==started&&currentState.current?.connectionContext!==state.connectionContext)throw new Error("Agency context changed");
          if(state.session)storeAgencyHandoffSession(state.session);else clearAgencyHandoffCaches();return state;
        },'handoff');
        if(!sameGeneration())throw new Error("Agency context changed");
        const state=completed.handoffComplete?await AndroidConnection.acknowledgeAgencyHandoff({connectionContext:completed.connectionContext}):completed;
        if(sameGeneration()&&mounted.current&&!currentState.current?.blocked&&(revision.current===started||currentState.current?.connectionContext===state.connectionContext)){applyState(state);window.location.reload();}
      }
      catch(failure){setError(failureMessage(failure));}finally{if(mounted.current)setBusy(false);}
    }}>{t(connection.handoffComplete?"android.finishHandoff":"android.cancelHandoff")}</button></> : connection.replacementPending ? <AndroidPendingEnrollment key={`${connection.connectionContext}:${connection.managedContext}`} state={connection} language={language} onState={applyState} /> : <>    {!preview ? <><button type="button" className="button-primary" data-pairing-scan disabled={busy} onClick={async () => {
      setBusy(true); setError(null); const started = revision.current;
      try { const result = await AndroidScanner.scan(); if (!result.cancelled) await preparePairing(result.artifact, "scan", started); }
      catch (reason) { if (isCurrent(started)) setError(failureMessage(reason, "scan")); } finally { if (mounted.current) setBusy(false); }
    }}>{t("android.scanPairing")}</button>
    <label>{t("android.importPairing")}<input type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setBusy(true); setError(null); const started = revision.current;
      try {
        if (file.size > MAX_PAIRING_BYTES) throw new Error();
        await preparePairing(await file.text(), "import", started);
      } catch (failure) { if (isCurrent(started)) setError(failureMessage(failure)); } finally { if (mounted.current) setBusy(false); }
    }} /></label>{connection.origin && <button type="button" disabled={busy} onClick={async () => { await AndroidConnection.cancel(); applyState(await AndroidConnection.state()); }}>{t("android.returnInstallation")}</button>}</> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(null); const started = revision.current;
      try {
        await installAndroidLifecycle();
        if (!isCurrent(started)) return;
        await transitionInstallation(() => AndroidConnection.confirm({ name, confirmInstallation: true }),"enrollment");
        if (!isCurrent(started)) return;
        const state = await AndroidConnection.state();
        if (isCurrent(started)) { setPreview(null); applyState(state); }
      } catch (failure) {
        if (isCurrent(started)) { setError(failureMessage(failure)); try { const state=await AndroidConnection.state(); if(isCurrent(started)) { applyState(state); if(!state.replacementPending) { setPreview(null); setConfirmed(false); } } } catch { /* The confirmed journal remains native and retryable after restart. */ } }
      } finally { if (mounted.current) setBusy(false); }
    }}>
      <p>{preview.organizationName} — {preview.unitName} — {preview.callSign}</p><p>{preview.origin}</p>
      <label>{t("enrollment.name")}<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t("enrollment.confirm")}</label>
      <div className="admin-role-editor-actions"><button type="submit" className="button-primary" disabled={busy || !confirmed || !name.trim()}>{t("enrollment.title")}</button>
      <button type="button" disabled={busy} onClick={async () => { await AndroidConnection.cancel(); applyState(await AndroidConnection.state()); setPreview(null); setName(""); setConfirmed(false); setError(null); }}>{t("android.cancel")}</button></div>
    </form>}
    </>}
    </>}
  </main>;
}
