"use client";

import { useUnsavedChanges } from "./unsaved-changes";
import { AdminText } from "../app/admin-localization";

import type { AgencyAppearance, AgencyMediaSettings, UpdateAgencyMediaSettingsCommand } from "@open-triage/contracts";
import { DEFAULT_SYNTHETIC_RETENTION_HOURS, DEFAULT_AGENCY_AUTHENTICATION_LIMITS,
  MAX_AGENCY_AUTHENTICATION_ATTEMPTS } from "@open-triage/contracts";
import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { loadAgencyMediaSettings, updateAgencyMediaSettings } from "../app/admin-context";
import { applyAgencyColors } from "../app/installation-settings";
import { formatClinicalDate, formatClinicalNumber, type RegionalFormat } from "../app/regional-format";
import { availableUiLanguages, languageDisplayName, resolveMessage, type AgencyLanguage } from "../app/localization";

const MEBIBYTE = 1024 * 1024;

export function showsStorageGrowthWarning(bytes: number, defaultBytes = 50 * MEBIBYTE): boolean {
  return Number.isFinite(bytes) && bytes > defaultBytes;
}

function editable(settings: AgencyMediaSettings): UpdateAgencyMediaSettingsCommand {
  const demographics = settings.demographics;
  return { expectedRevision: settings.revision, language: settings.language, regionalFormat: settings.regionalFormat, timeZone: settings.timeZone,
    syntheticRetentionHours: settings.syntheticRetentionHours === undefined ? DEFAULT_SYNTHETIC_RETENTION_HOURS : settings.syntheticRetentionHours,
    authenticationLimits: { ...(settings.authenticationLimits ?? DEFAULT_AGENCY_AUTHENTICATION_LIMITS) },
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
  const [retentionHours, setRetentionHours] = useState(String(DEFAULT_SYNTHETIC_RETENTION_HOURS));
  const [accountAttemptLimit, setAccountAttemptLimit] = useState(String(DEFAULT_AGENCY_AUTHENTICATION_LIMITS.accountAttemptsPer15Minutes));
  const [networkAttemptLimit, setNetworkAttemptLimit] = useState(String(DEFAULT_AGENCY_AUTHENTICATION_LIMITS.networkAttemptsPer5Minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settings) return;
    let current = true;
    loadAgencyMediaSettings().then((loaded) => {
      if (!current) return;
      setSettings(loaded);
      setDraft(editable(loaded));
      setAccountAttemptLimit(String(loaded.authenticationLimits?.accountAttemptsPer15Minutes ?? DEFAULT_AGENCY_AUTHENTICATION_LIMITS.accountAttemptsPer15Minutes));
      setNetworkAttemptLimit(String(loaded.authenticationLimits?.networkAttemptsPer5Minutes ?? DEFAULT_AGENCY_AUTHENTICATION_LIMITS.networkAttemptsPer5Minutes));
      setAllowanceMib(String(loaded.reportMediaAllowanceBytes / MEBIBYTE));
      setImageLimitMib(String(loaded.imageMediaLimitBytes / MEBIBYTE));
      setRetentionHours(loaded.syntheticRetentionHours === null ? "" : String(loaded.syntheticRetentionHours ?? DEFAULT_SYNTHETIC_RETENTION_HOURS));
    }).catch((reason: unknown) => {
      if (current) setError(language !== "en" ? t("settings.loadFailed") : reason instanceof Error ? reason.message : t("settings.loadFailed"));
    });
    return () => { current = false; };
  }, [language, t, settings]);

  useEffect(() => {
    if (draft) applyAgencyColors(draft.appearance, document);
  }, [draft]);

  const mib = Number(allowanceMib);
  const validAllowance = Number.isInteger(mib) && mib >= 1 && mib <= 2048;
  const proposedBytes = validAllowance ? mib * MEBIBYTE : 0;
  const imageMib = Number(imageLimitMib);
  const validImageLimit = Number.isInteger(imageMib) && imageMib >= 1 && imageMib <= mib;
  const proposedImageBytes = validImageLimit ? imageMib * MEBIBYTE : 0;
  const proposedRetentionHours = retentionHours.trim() === "" ? null : Number(retentionHours);
  const validRetentionHours = proposedRetentionHours === null ||
    (Number.isSafeInteger(proposedRetentionHours) && proposedRetentionHours > 0);
  const warning = validAllowance && showsStorageGrowthWarning(proposedBytes, settings?.defaultReportMediaAllowanceBytes);
  const authenticationLimits = { accountAttemptsPer15Minutes: Number(accountAttemptLimit),
    networkAttemptsPer5Minutes: Number(networkAttemptLimit) };
  const validAttemptLimit = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_AGENCY_AUTHENTICATION_ATTEMPTS;
  const validAuthenticationLimits = Object.values(authenticationLimits).every(validAttemptLimit);
  const complete = !!draft && draft.appearance.brandText.trim() && draft.appearance.helperText.trim() &&
    draft.appearance.pwaName.trim() && draft.appearance.pwaShortName.trim() &&
    draft.demographics.agencyUniqueStateId.trim() && draft.demographics.agencyNumber.trim() &&
    /^[0-9]{2}$/.test(draft.demographics.stateCode);
  const unchanged = !!settings && !!draft && JSON.stringify({ ...draft, expectedRevision: settings.revision,
    syntheticRetentionHours: proposedRetentionHours,
    authenticationLimits,
    reportMediaAllowanceBytes: proposedBytes, imageMediaLimitBytes: proposedImageBytes }) === JSON.stringify(editable(settings));

  useUnsavedChanges(!!draft && !unchanged);
  useEffect(() => () => { if (settings) applyAgencyColors(settings.appearance, document); }, [settings]);

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
    if (!settings || !draft || !validAllowance || !validImageLimit || !validRetentionHours || !validAuthenticationLimits || !complete || !canWrite) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await updateAgencyMediaSettings(csrfToken, { ...draft,
        syntheticRetentionHours: proposedRetentionHours,
        authenticationLimits,
        expectedRevision: settings.revision, reportMediaAllowanceBytes: proposedBytes,
        imageMediaLimitBytes: proposedImageBytes });
      setSettings(updated); setDraft(editable(updated));
      setAccountAttemptLimit(String(updated.authenticationLimits?.accountAttemptsPer15Minutes ?? DEFAULT_AGENCY_AUTHENTICATION_LIMITS.accountAttemptsPer15Minutes));
      setNetworkAttemptLimit(String(updated.authenticationLimits?.networkAttemptsPer5Minutes ?? DEFAULT_AGENCY_AUTHENTICATION_LIMITS.networkAttemptsPer5Minutes));
      setAllowanceMib(String(updated.reportMediaAllowanceBytes / MEBIBYTE));
      setImageLimitMib(String(updated.imageMediaLimitBytes / MEBIBYTE));
      setRetentionHours(updated.syntheticRetentionHours === null ? "" : String(updated.syntheticRetentionHours ?? DEFAULT_SYNTHETIC_RETENTION_HOURS));
      setNotice(t("settings.saved", { version: updated.demographics.version }));
    } catch (reason) {
      setError(reason instanceof Error && /revision is stale/i.test(reason.message) ? t("settings.stale") :
        language !== "en" ? t("settings.saveFailed") : reason instanceof Error ? reason.message : t("settings.saveFailed"));
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
          {availableUiLanguages.map((code) => <option key={code} value={code}>{languageDisplayName(code, language)}</option>)}
        </select>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.regionalFormat")}</legend>
        <label htmlFor="agency-regional-format"><strong>{t("settings.datesAndNumbers")}</strong>
          <span>{t("settings.regionalFormatHelp")}</span></label>
        <select id="agency-regional-format" value={draft.regionalFormat ?? ""} onChange={(event) =>
          setDraft((current) => current ? { ...current, regionalFormat: (event.target.value || null) as RegionalFormat } : current)}>
          <option value="">{t("settings.currentFormat")}</option>
          <option value="en-US">English (United States)</option>
          <option value="sv-SE">Svenska (Sverige)</option>
        </select>
        <p aria-live="polite">{t("settings.preview")}: {formatClinicalDate("2026-09-28T13:45:00Z", draft.regionalFormat ?? null)} · {formatClinicalNumber(1234.5, draft.regionalFormat ?? null)}</p>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.timeZone")}</legend>
        <label htmlFor="agency-time-zone"><strong>{t("settings.clinicalTimeZone")}</strong>
          <span>{t("settings.timeZoneHelp")}</span></label>
        <input id="agency-time-zone" value={draft.timeZone ?? ""} placeholder={resolveMessage(language, "admin.useDeviceTime")}
          onChange={(event) => setDraft((current) => current ? { ...current, timeZone: event.target.value || null } : current)} />
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.demoRecords")}</legend>
        <label htmlFor="synthetic-retention-hours"><strong>{t("settings.demoWipeHours")}</strong></label>
        <input id="synthetic-retention-hours" name="syntheticRetentionHours" type="number" min="1" step="1"
          value={retentionHours} aria-describedby="synthetic-retention-help" aria-invalid={!validRetentionHours}
          onChange={(event) => setRetentionHours(event.target.value)} />
        <small id="synthetic-retention-help">{t("settings.demoWipeHelp")}</small>
        {!validRetentionHours && <p className="admin-error" role="alert">{t("settings.demoWipeInvalid")}</p>}
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.loginLimits")}</legend>
        <label htmlFor="authentication-account-attempt-limit"><strong>{t("settings.loginAccountLimit")}</strong></label>
        <input id="authentication-account-attempt-limit" type="number" min="1" max={MAX_AGENCY_AUTHENTICATION_ATTEMPTS}
          step="1" required value={accountAttemptLimit} aria-describedby="authentication-limits-help"
          aria-invalid={!validAttemptLimit(authenticationLimits.accountAttemptsPer15Minutes)}
          onChange={(event) => setAccountAttemptLimit(event.target.value)} />
        <label htmlFor="authentication-network-attempt-limit"><strong>{t("settings.loginNetworkLimit")}</strong></label>
        <input id="authentication-network-attempt-limit" type="number" min="1" max={MAX_AGENCY_AUTHENTICATION_ATTEMPTS}
          step="1" required value={networkAttemptLimit} aria-describedby="authentication-limits-help"
          aria-invalid={!validAttemptLimit(authenticationLimits.networkAttemptsPer5Minutes)}
          onChange={(event) => setNetworkAttemptLimit(event.target.value)} />
        <small id="authentication-limits-help">{t("settings.loginLimitsHelp")}</small>
        {!validAuthenticationLimits && <p className="admin-error" role="alert">{t("settings.loginLimitsInvalid", { max: MAX_AGENCY_AUTHENTICATION_ATTEMPTS })}</p>}
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText messageKey="admin.reportMedia" /></legend>
        <label htmlFor="image-media-limit"><strong><AdminText messageKey="admin.perImageLimit" /></strong>
          <span><AdminText messageKey="admin.maximumCanonicalSize" /></span></label>
        <div className="agency-settings-input">
          <input id="image-media-limit" name="imageMediaLimitMib" type="number"
            min="1" max={validAllowance ? mib : 2048} step="1" required value={imageLimitMib}
            onChange={(event) => setImageLimitMib(event.target.value)} /><span>MB</span>
        </div>
        <small><AdminText messageKey="admin.allowedRange1MB" /></small>
        <label htmlFor="report-media-allowance"><strong><AdminText messageKey="admin.totalReportMedia" /></strong>
          <span><AdminText messageKey="admin.aggregatePhotoAnd" /></span></label>
        <div className="agency-settings-input">
          <input id="report-media-allowance" name="reportMediaAllowanceMib" type="number"
            min="1" max="2048" step="1" required value={allowanceMib}
            onChange={(event) => setAllowanceMib(event.target.value)} /><span>MB</span>
        </div>
        <small><AdminText messageKey="admin.allowedRange12" /></small>
        {warning && <p className="agency-settings-warning" role="alert"><AdminText messageKey="admin.above50MB" /></p>}
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText messageKey="admin.signInAnd" /></legend>
        <label><AdminText messageKey="admin.brandText" /><input maxLength={100} required value={draft.appearance.brandText}
          onChange={(event) => changeAppearance("brandText", event.target.value)} /></label>
        <label><AdminText messageKey="admin.signInGuidance" /><textarea maxLength={300} required value={draft.appearance.helperText}
          onChange={(event) => changeAppearance("helperText", event.target.value)} />
          <span><AdminText messageKey="admin.publicGuidanceMust" /></span></label>
        <label><AdminText messageKey="admin.logoPNGOptional" />
          <input type="file" accept="image/png" onChange={(event) => chooseLogo(event.target.files?.[0])} /></label>
        {draft.appearance.logoPngDataUrl && <div className="agency-logo-preview">
          {/* A bounded administrator-supplied data URL cannot use Next's static image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.appearance.logoPngDataUrl} alt={resolveMessage(language, "admin.agencyLogoPreview")} />
          <button type="button" className="button-danger" onClick={() => changeAppearance("logoPngDataUrl", null)}><AdminText messageKey="admin.removeLogo" /></button>
        </div>}
        <div className="agency-color-grid">
          <label><AdminText messageKey="admin.accentColor" /><input type="color" value={draft.appearance.accentColor}
            onChange={(event) => changeAppearance("accentColor", event.target.value)} /></label>
          <label><AdminText messageKey="admin.darkAccentColor" /><input type="color" value={draft.appearance.accentDarkColor}
            onChange={(event) => changeAppearance("accentDarkColor", event.target.value)} /></label>
          <label><AdminText messageKey="admin.destructiveColor" /><input type="color" value={draft.appearance.destructiveColor}
            onChange={(event) => changeAppearance("destructiveColor", event.target.value)} /></label>
          <label><AdminText messageKey="admin.inactiveButtonColor" /><input type="color" value={draft.appearance.inactiveButtonColor}
            onChange={(event) => changeAppearance("inactiveButtonColor", event.target.value)} /></label>
          <label><AdminText messageKey="admin.textColor" /><input type="color" value={draft.appearance.textColor}
            onChange={(event) => changeAppearance("textColor", event.target.value)} /></label>
          <label><AdminText messageKey="admin.browserThemeColor" /><input type="color" value={draft.appearance.browserThemeColor}
            onChange={(event) => changeAppearance("browserThemeColor", event.target.value)} /></label>
          <label><AdminText messageKey="admin.pwaBackgroundColor" /><input type="color" value={draft.appearance.pwaBackgroundColor}
            onChange={(event) => changeAppearance("pwaBackgroundColor", event.target.value)} /></label>
        </div>
        <p className="agency-appearance-preview">
          <span><AdminText messageKey="admin.accessibleAccentPreview" /></span>
          <span className="agency-dark-accent-preview"><AdminText messageKey="admin.darkAccentPreview" /></span>
          <span className="agency-destructive-preview"><AdminText messageKey="admin.destructivePreview" /></span>
          <span className="agency-inactive-button-preview"><AdminText messageKey="admin.inactiveButtonPreview" /></span>
        </p>
        <label><AdminText messageKey="admin.pwaName" /><input maxLength={100} required value={draft.appearance.pwaName}
          onChange={(event) => changeAppearance("pwaName", event.target.value)} /></label>
        <label><AdminText messageKey="admin.pwaShortName" /><input maxLength={30} required value={draft.appearance.pwaShortName}
          onChange={(event) => changeAppearance("pwaShortName", event.target.value)} /></label>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText messageKey="admin.nemsisAgencyDemographics" /></legend>
        <p><AdminText messageKey="admin.changesAppendAn" /></p>
        <label>dAgency.01 — EMS Agency Unique State ID<input maxLength={50} required
          value={draft.demographics.agencyUniqueStateId}
          onChange={(event) => changeDemographic("agencyUniqueStateId", event.target.value)} /></label>
        <label>dAgency.02 — EMS Agency Number<input maxLength={15} required
          value={draft.demographics.agencyNumber}
          onChange={(event) => changeDemographic("agencyNumber", event.target.value)} /></label>
        <label>dAgency.04 — ANSI state code<input inputMode="numeric" pattern="[0-9]{2}" maxLength={2} required
          value={draft.demographics.stateCode}
          onChange={(event) => changeDemographic("stateCode", event.target.value)} /></label>
        <label><AdminText messageKey="admin.stateDisplayOptional" /><input maxLength={100} value={draft.demographics.stateDisplay ?? ""}
          onChange={(event) => changeDemographic("stateDisplay", event.target.value || null)} /></label>
        <small>{resolveMessage(language, "admin.currentDemographicVersion", { version: settings?.demographics.version ?? 0, codeSystem: draft.demographics.stateCodeSystem ?? resolveMessage(language, "admin.notRecorded") })}</small>
      </fieldset>

      <small>{t("settings.revision", { revision: settings?.revision ?? 0 })}</small>
      {!canWrite && <p>{t("settings.readOnly")}</p>}
      {canWrite && <div className="form-actions"><button type="submit"
        disabled={busy || !validAllowance || !validImageLimit || !validRetentionHours || !validAuthenticationLimits || !complete || unchanged}>{busy ? t("settings.saving") : t("settings.save")}</button></div>}
    </form>}
  </section>;
}
