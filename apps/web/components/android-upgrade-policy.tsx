"use client";
import type { AuthenticatedSession } from "@open-triage/contracts";
import type { AndroidUpgradePolicyView, AndroidUpgradePolicyPreview, AndroidUpgradeEvaluation } from "@open-triage/contracts/android-upgrade-policy";
import { ANDROID_UPGRADE_GRACE_MAX_DAYS } from "@open-triage/contracts/android-upgrade-policy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { loadAndroidUpgradePolicy, previewAndroidUpgradePolicy, saveAndroidUpgradePolicy } from "../app/android-upgrade-policy";
import { sessionRequestToken } from "../app/clinician-session";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { PlatformRequestError } from "../app/platform-errors";
import { listAccessRemoved } from "../app/list-refresh";
import { useUnsavedChanges } from "./unsaved-changes";
import { FieldHelp } from "./field-help";
import { LoadingStatus } from "./loading-status";

const errorKey = (reason: unknown, fallback: string) => reason instanceof PlatformRequestError ? `platform.error.${reason.code}` : fallback;

export function AndroidUpgradePolicyPanel({ session, language }: { session: AuthenticatedSession; language: AgencyLanguage }) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const [data, setData] = useState<AndroidUpgradePolicyView | null>(null), [days, setDays] = useState("");
  const [preview, setPreview] = useState<AndroidUpgradePolicyPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false), [refresh, setRefresh] = useState(0);
  const current = useRef(true), dirty = data !== null && days !== String(data.policy.graceDays);
  useUnsavedChanges(dirty);
  useEffect(() => {
    current.current = true; let loaded = true;
    loadAndroidUpgradePolicy().then(value => { if (loaded) { setData(value); setDays(String(value.policy.graceDays)); setError(null); setPreview(null); } })
      .catch(reason => { if (loaded) { if (listAccessRemoved(reason)) { setData(null); setDays(""); setPreview(null); }
        setError(errorKey(reason, "androidUpgrade.loadFailed")); } });
    return () => { loaded = false; current.current = false; };
  }, [session.user.id, refresh]);
  const valid = days !== "" && Number.isInteger(Number(days)) && Number(days) >= 0 && Number(days) <= ANDROID_UPGRADE_GRACE_MAX_DAYS;
  async function review(event: FormEvent) {
    event.preventDefault(); if (!data || !valid || busy) return;
    setBusy(true); setError(null); setSaved(false); setPreview(null);
    try { const value = await previewAndroidUpgradePolicy(sessionRequestToken(session), Number(days), data.policy.revision); if (current.current) setPreview(value); }
    catch (reason) { if (current.current) { if (listAccessRemoved(reason)) { setData(null); setDays(""); }
      setError(errorKey(reason, "androidUpgrade.previewFailed")); } }
    finally { if (current.current) setBusy(false); }
  }
  async function save() {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try { const value = await saveAndroidUpgradePolicy(sessionRequestToken(session), preview); if (current.current) { setData(value); setDays(String(value.policy.graceDays)); setPreview(null); setSaved(true); } }
    catch (reason) { if (current.current) { setPreview(null); if (listAccessRemoved(reason)) { setData(null); setDays(""); }
      setError(errorKey(reason, "androidUpgrade.saveFailed")); } }
    finally { if (current.current) setBusy(false); }
  }
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : t("androidUpgrade.noDeadline");
  function clients(values: AndroidUpgradeEvaluation[], label: string) {
    return <div className="android-upgrade-table"><table><caption>{label}</caption><thead><tr>
      <th scope="col">{t("androidUpgrade.version")}</th><th scope="col">{t("androidUpgrade.outcome")}</th><th scope="col">{t("androidUpgrade.deadline")}</th>
    </tr></thead><tbody>{values.map(value => <tr key={value.versionCode}><th scope="row">{value.versionCode}</th>
      <td>{t(`androidUpgrade.status.${value.status}`)}<small>{t(`androidUpgrade.reason.${value.reason}`)}</small></td><td>{date(value.deadline)}</td>
    </tr>)}</tbody></table></div>;
  }
  return <section className="agency-settings android-upgrade-policy" aria-labelledby="android-upgrade-heading">
    <div className="section-heading"><h2 id="android-upgrade-heading">{t("androidUpgrade.heading")}</h2></div>
    {error && <div className="admin-error" role="alert"><p>{t(error) === error ? t("androidUpgrade.saveFailed") : t(error)}</p>{!dirty && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t("admin.retry")}</button>}</div>}
    {!data && !error && <LoadingStatus>{t("androidUpgrade.loading")}</LoadingStatus>}
    {data && <form onSubmit={review} aria-label={t("androidUpgrade.heading")}>
      <label><FieldHelp label={t("androidUpgrade.graceDays")} text={t("androidUpgrade.graceHelp")} /><input name="graceDays" type="number" min={0} max={ANDROID_UPGRADE_GRACE_MAX_DAYS} step={1} required
        value={days} disabled={busy} onChange={event => { setDays(event.target.value); setPreview(null); setSaved(false); }} /></label>
      {clients(data.clients, t("androidUpgrade.current"))}
      {preview && <div className="android-upgrade-preview" role="region" aria-label={t("androidUpgrade.preview")}>
        <p>{t("androidUpgrade.impact", { days: preview.proposedGraceDays })}</p>
        {clients(preview.proposedClients, t("androidUpgrade.proposed"))}
      </div>}
      {saved && <p role="status">{t("androidUpgrade.saved")}</p>}
      <div className="form-actions agency-settings-actions">
        <button type="submit" disabled={busy || !valid || !dirty}>{t("androidUpgrade.preview")}</button>
        {preview && <button type="button" className="button-primary" disabled={busy} onClick={() => void save()}>{t("admin.save")}</button>}
        {dirty && <button type="button" className="secondary" disabled={busy} onClick={() => { setDays(String(data.policy.graceDays)); setPreview(null); setError(null); setRefresh(value => value + 1); }}>{t("admin.cancel")}</button>}
      </div>
    </form>}
  </section>;
}
