"use client";

import { AdminText } from "../app/admin-localization";

import type { AgencyAppearance, AgencyMediaSettings, UpdateAgencyMediaSettingsCommand } from "@open-triage/contracts";
import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { loadAgencyMediaSettings, updateAgencyMediaSettings } from "../app/admin-context";
import { applyAgencyColors } from "../app/installation-settings";
import { formatClinicalDate, formatClinicalNumber, type RegionalFormat } from "../app/regional-format";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

const MEBIBYTE = 1024 * 1024;

export function showsStorageGrowthWarning(bytes: number, defaultBytes = 50 * MEBIBYTE): boolean {
  return Number.isFinite(bytes) && bytes > defaultBytes;
}

function editable(settings: AgencyMediaSettings): UpdateAgencyMediaSettingsCommand {
  const demographics = settings.demographics;
  return { expectedRevision: settings.revision, language: settings.language, regionalFormat: settings.regionalFormat, timeZone: settings.timeZone,
    reportMediaAllowanceBytes: settings.reportMediaAllowanceBytes,
    imageMediaLimitBytes: settings.imageMediaLimitBytes,
    appearance: { ...settings.appearance },
    demographics: {
      agencyUniqueStateId: demographics.agencyUniqueStateId, agencyNumber: demographics.agencyNumber,
      stateCode: demographics.stateCode, stateDisplay: demographics.stateDisplay,
      stateCodeSystem: demographics.stateCodeSystem, stateTerminologyVersion: demographics.stateTerminologyVersion,
    } };
}

export function AgencySettingsPanel({ csrfToken, canWrite, language = "en" }: {
  readonly csrfToken: string;
  readonly canWrite: boolean;
  readonly language?: AgencyLanguage;
}) {
  const t = useCallback((key: string, parameters?: Record<string, string | number>) =>
    resolveMessage(language, key, parameters), [language]);
  const [settings, setSettings] = useState<AgencyMediaSettings | null>(null);
  const [draft, setDraft] = useState<UpdateAgencyMediaSettingsCommand | null>(null);
  const [allowanceMib, setAllowanceMib] = useState("50");
  const [imageLimitMib, setImageLimitMib] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadAgencyMediaSettings().then((loaded) => {
      if (!current) return;
      setSettings(loaded);
      setDraft(editable(loaded));
      setAllowanceMib(String(loaded.reportMediaAllowanceBytes / MEBIBYTE));
      setImageLimitMib(String(loaded.imageMediaLimitBytes / MEBIBYTE));
    }).catch((reason: unknown) => {
      if (current) setError(language === "sv" ? t("settings.loadFailed") : reason instanceof Error ? reason.message : t("settings.loadFailed"));
    });
    return () => { current = false; };
  }, [language, t]);

  useEffect(() => {
    if (draft) applyAgencyColors(draft.appearance, document);
  }, [draft]);

  const mib = Number(allowanceMib);
  const validAllowance = Number.isInteger(mib) && mib >= 1 && mib <= 2048;
  const proposedBytes = validAllowance ? mib * MEBIBYTE : 0;
  const imageMib = Number(imageLimitMib);
  const validImageLimit = Number.isInteger(imageMib) && imageMib >= 1 && imageMib <= mib;
  const proposedImageBytes = validImageLimit ? imageMib * MEBIBYTE : 0;
  const warning = validAllowance && showsStorageGrowthWarning(proposedBytes, settings?.defaultReportMediaAllowanceBytes);
  const complete = !!draft && draft.appearance.brandText.trim() && draft.appearance.helperText.trim() &&
    draft.appearance.pwaName.trim() && draft.appearance.pwaShortName.trim() &&
    draft.demographics.agencyUniqueStateId.trim() && draft.demographics.agencyNumber.trim() &&
    /^[0-9]{2}$/.test(draft.demographics.stateCode);
  const unchanged = !!settings && !!draft && JSON.stringify({ ...draft, expectedRevision: settings.revision,
    reportMediaAllowanceBytes: proposedBytes, imageMediaLimitBytes: proposedImageBytes }) === JSON.stringify(editable(settings));

  function changeAppearance<K extends keyof AgencyAppearance>(key: K, value: AgencyAppearance[K]) {
    setDraft((current) => current ? { ...current, appearance: { ...current.appearance, [key]: value } } : current);
  }

  function changeDemographic(key: keyof UpdateAgencyMediaSettingsCommand["demographics"], value: string | null) {
    setDraft((current) => current ? { ...current, demographics: { ...current.demographics, [key]: value } } : current);
  }

  function chooseLogo(file: File | undefined) {
    if (!file) return;
    if (file.type !== "image/png" || file.size > 128 * 1024) {
      setError(t("settings.logoInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => changeAppearance("logoPngDataUrl", typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setError(t("settings.logoReadFailed"));
    reader.readAsDataURL(file);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !draft || !validAllowance || !validImageLimit || !complete || !canWrite) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await updateAgencyMediaSettings(csrfToken, { ...draft,
        expectedRevision: settings.revision, reportMediaAllowanceBytes: proposedBytes,
        imageMediaLimitBytes: proposedImageBytes });
      setSettings(updated); setDraft(editable(updated));
      setAllowanceMib(String(updated.reportMediaAllowanceBytes / MEBIBYTE));
      setImageLimitMib(String(updated.imageMediaLimitBytes / MEBIBYTE));
      setNotice(t("settings.saved", { version: updated.demographics.version }));
    } catch (reason) {
      setError(reason instanceof Error && /revision is stale/i.test(reason.message) ? t("settings.stale") :
        language === "sv" ? t("settings.saveFailed") : reason instanceof Error ? reason.message : t("settings.saveFailed"));
    } finally { setBusy(false); }
  }

  return <section className="admin-configuration agency-settings" aria-labelledby="agency-settings-heading">
    <div className="section-heading"><h2 id="agency-settings-heading">{t("navigation.settings")}</h2></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p className="agency-settings-notice" role="status">{notice}</p>}
    {!draft && !error && <p role="status">{t("settings.loading")}</p>}
    {draft && <form onSubmit={save}>
      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.language")}</legend>
        <label htmlFor="agency-language"><strong>{t("settings.agencyLanguage")}</strong>
          <span>{t("settings.languageHelp")}</span></label>
        <select id="agency-language" value={draft.language} onChange={(event) =>
          setDraft((current) => current ? { ...current, language: event.target.value as AgencyLanguage } : current)}>
          <option value="en">{t("settings.english")}</option>
          <option value="sv">{t("settings.swedish")}</option>
        </select>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{language === "sv" ? "Regionalt format" : "Regional format"}</legend>
        <label htmlFor="agency-regional-format"><strong>{language === "sv" ? "Datum och nummer" : "Dates and numbers"}</strong>
          <span>{language === "sv" ? "Språket kan väljas separat. Formatändringen gäller nästa gång arbetsytan öppnas." : "Language is selected separately. The format applies on the next workspace load."}</span></label>
        <select id="agency-regional-format" value={draft.regionalFormat ?? ""} onChange={(event) =>
          setDraft((current) => current ? { ...current, regionalFormat: (event.target.value || null) as RegionalFormat } : current)}>
          <option value="">{language === "sv" ? "Nuvarande format" : "Current format"}</option>
          <option value="en-US">English (United States)</option>
          <option value="sv-SE">Svenska (Sverige)</option>
        </select>
        <p aria-live="polite">{language === "sv" ? "Förhandsvisning" : "Preview"}: {formatClinicalDate("2026-09-28T13:45:00Z", draft.regionalFormat ?? null)} · {formatClinicalNumber(1234.5, draft.regionalFormat ?? null)}</p>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{language === "sv" ? "Tidszon" : "Time zone"}</legend>
        <label htmlFor="agency-time-zone"><strong>{language === "sv" ? "Klinisk tidszon" : "Clinical time zone"}</strong>
          <span>{language === "sv" ? "Ange ett IANA-namn, till exempel Europe/Stockholm. Gäller nästa gång arbetsytan öppnas." : "Enter an IANA name, such as America/New_York. Applies on the next workspace load."}</span></label>
        <input id="agency-time-zone" value={draft.timeZone ?? ""} placeholder={resolveMessage(language, "admin.Use device time zone")}
          onChange={(event) => setDraft((current) => current ? { ...current, timeZone: event.target.value || null } : current)} />
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText english="Report media" /></legend>
        <label htmlFor="image-media-limit"><strong><AdminText english="Per-image limit" /></strong>
          <span><AdminText english="Maximum canonical size of each captured image." /></span></label>
        <div className="agency-settings-input">
          <input id="image-media-limit" name="imageMediaLimitMib" type="number"
            min="1" max={validAllowance ? mib : 2048} step="1" required value={imageLimitMib}
            onChange={(event) => setImageLimitMib(event.target.value)} /><span>MB</span>
        </div>
        <small><AdminText english="Allowed range: 1 MB up to the total report-media limit. Default: 10 MB." /></small>
        <label htmlFor="report-media-allowance"><strong><AdminText english="Total report-media limit" /></strong>
          <span><AdminText english="Aggregate photo and audio storage available to each report." /></span></label>
        <div className="agency-settings-input">
          <input id="report-media-allowance" name="reportMediaAllowanceMib" type="number"
            min="1" max="2048" step="1" required value={allowanceMib}
            onChange={(event) => setAllowanceMib(event.target.value)} /><span>MB</span>
        </div>
        <small><AdminText english="Allowed range: 1–2,048 MB. Default: 50 MB." /></small>
        {warning && <p className="agency-settings-warning" role="alert"><AdminText english="Above 50 MB, report media increases Postgres database, WAL, replica, backup, restore, and vacuum storage growth." /></p>}
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText english="Sign-in and appearance" /></legend>
        <label><AdminText english="Brand text" /><input maxLength={100} required value={draft.appearance.brandText}
          onChange={(event) => changeAppearance("brandText", event.target.value)} /></label>
        <label><AdminText english="Sign-in guidance" /><textarea maxLength={300} required value={draft.appearance.helperText}
          onChange={(event) => changeAppearance("helperText", event.target.value)} />
          <span><AdminText english="Public guidance must not contain usernames, passwords, tokens, or other secrets." /></span></label>
        <label><AdminText english="Logo (PNG, optional, at most 128 KiB and 1024×1024)" />
          <input type="file" accept="image/png" onChange={(event) => chooseLogo(event.target.files?.[0])} /></label>
        {draft.appearance.logoPngDataUrl && <div className="agency-logo-preview">
          {/* A bounded administrator-supplied data URL cannot use Next's static image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.appearance.logoPngDataUrl} alt={resolveMessage(language, "admin.Agency logo preview")} />
          <button type="button" onClick={() => changeAppearance("logoPngDataUrl", null)}><AdminText english="Remove logo" /></button>
        </div>}
        <div className="agency-color-grid">
          <label><AdminText english="Accent color" /><input type="color" value={draft.appearance.accentColor}
            onChange={(event) => changeAppearance("accentColor", event.target.value)} /></label>
          <label><AdminText english="Dark accent color" /><input type="color" value={draft.appearance.accentDarkColor}
            onChange={(event) => changeAppearance("accentDarkColor", event.target.value)} /></label>
          <label><AdminText english="Browser theme color" /><input type="color" value={draft.appearance.browserThemeColor}
            onChange={(event) => changeAppearance("browserThemeColor", event.target.value)} /></label>
          <label><AdminText english="PWA background color" /><input type="color" value={draft.appearance.pwaBackgroundColor}
            onChange={(event) => changeAppearance("pwaBackgroundColor", event.target.value)} /></label>
        </div>
        <p className="agency-appearance-preview">
          <span><AdminText english="Accessible accent preview" /></span>
          <span><AdminText english="Dark accent preview" /></span>
        </p>
        <label><AdminText english="PWA name" /><input maxLength={100} required value={draft.appearance.pwaName}
          onChange={(event) => changeAppearance("pwaName", event.target.value)} /></label>
        <label><AdminText english="PWA short name" /><input maxLength={30} required value={draft.appearance.pwaShortName}
          onChange={(event) => changeAppearance("pwaShortName", event.target.value)} /></label>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText english="NEMSIS agency demographics" /></legend>
        <p><AdminText english="Changes append an immutable dAgency version. Existing reports keep their pinned version." /></p>
        <label>dAgency.01 — EMS Agency Unique State ID<input maxLength={50} required
          value={draft.demographics.agencyUniqueStateId}
          onChange={(event) => changeDemographic("agencyUniqueStateId", event.target.value)} /></label>
        <label>dAgency.02 — EMS Agency Number<input maxLength={15} required
          value={draft.demographics.agencyNumber}
          onChange={(event) => changeDemographic("agencyNumber", event.target.value)} /></label>
        <label>dAgency.04 — ANSI state code<input inputMode="numeric" pattern="[0-9]{2}" maxLength={2} required
          value={draft.demographics.stateCode}
          onChange={(event) => changeDemographic("stateCode", event.target.value)} /></label>
        <label><AdminText english="State display (optional)" /><input maxLength={100} value={draft.demographics.stateDisplay ?? ""}
          onChange={(event) => changeDemographic("stateDisplay", event.target.value || null)} /></label>
        <small>{resolveMessage(language, "admin.Current demographic version {version}; code system {codeSystem}.", { version: settings?.demographics.version ?? 0, codeSystem: draft.demographics.stateCodeSystem ?? resolveMessage(language, "admin.not recorded") })}</small>
      </fieldset>

      <small>{t("settings.revision", { revision: settings?.revision ?? 0 })}</small>
      {!canWrite && <p>{t("settings.readOnly")}</p>}
      {canWrite && <div className="form-actions"><button type="submit"
        disabled={busy || !validAllowance || !validImageLimit || !complete || unchanged}>{busy ? t("settings.saving") : t("settings.save")}</button></div>}
    </form>}
  </section>;
}
