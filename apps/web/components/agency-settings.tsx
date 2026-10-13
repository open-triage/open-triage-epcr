"use client";

import { useUnsavedChanges } from "./unsaved-changes";
import { AdminText } from "../app/admin-localization";

import type { AgencyAppearance, AgencyMediaSettings, UpdateAgencyMediaSettingsCommand } from "@open-triage/contracts";
import { DEFAULT_SYNTHETIC_RETENTION_HOURS, DEFAULT_AGENCY_AUTHENTICATION_LIMITS, DEFAULT_AGENCY_APPEARANCE,
  DEFAULT_IMAGE_MEDIA_LIMIT_BYTES, DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
  } from "@open-triage/contracts";
import React, { type ReactNode, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { loadAgencyMediaSettings, updateAgencyMediaSettings } from "../app/admin-context";
import { TimeZoneSelect } from "./time-zone-select";
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
    reportMediaAllowanceBytes: settings.reportMediaAllowanceBytes,
    imageMediaLimitBytes: settings.imageMediaLimitBytes,
    appearance: { ...settings.appearance },
    demographics: {
      agencyUniqueStateId: demographics.agencyUniqueStateId, agencyNumber: demographics.agencyNumber,
      stateCode: demographics.stateCode, stateDisplay: demographics.stateDisplay,
      stateCodeSystem: demographics.stateCodeSystem, stateTerminologyVersion: demographics.stateTerminologyVersion,
    } };
}

export function newAgencySettings(): AgencyMediaSettings {
  return { organizationId: "", revision: 1, language: "en", regionalFormat: null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    syntheticRetentionHours: DEFAULT_SYNTHETIC_RETENTION_HOURS,
    authenticationLimits: { ...DEFAULT_AGENCY_AUTHENTICATION_LIMITS },
    reportMediaAllowanceBytes: DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES, imageMediaLimitBytes: DEFAULT_IMAGE_MEDIA_LIMIT_BYTES,
    defaultReportMediaAllowanceBytes: DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES, defaultImageMediaLimitBytes: DEFAULT_IMAGE_MEDIA_LIMIT_BYTES,
    appearance: { ...DEFAULT_AGENCY_APPEARANCE, helperText: resolveMessage("en", "admin.agencyCredentialHelp") },
    demographics: { versionId: "", version: 0, catalogReleaseId: "", agencyUniqueStateId: "", agencyNumber: "", stateCode: "",
      stateDisplay: null, stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null, effectiveFrom: "" },
    storageGrowthWarning: false, updatedAt: "" };
}

export function AgencySettingsPanel({ csrfToken, canWrite, language = "en", creation }: {
  readonly csrfToken: string;
  readonly canWrite: boolean;
  readonly language?: AgencyLanguage;
  readonly creation?: {
    readonly fields: ReactNode;
    readonly onSubmit: (command: UpdateAgencyMediaSettingsCommand, form: FormData) => Promise<void>;
    readonly onCancel: () => void;
    readonly onChange: () => void;
  };
}) {
  const t = useCallback((key: string, parameters?: Record<string, string | number>) =>
    resolveMessage(language, key, parameters), [language]);
  const creating = Boolean(creation);
  const panel = useRef<HTMLElement>(null);
  const fieldId = (name: string) => creating ? `new-${name}` : name;
  const [settings, setSettings] = useState<AgencyMediaSettings | null>(() => creating ? newAgencySettings() : null);
  const [draft, setDraft] = useState<UpdateAgencyMediaSettingsCommand | null>(() => settings ? editable(settings) : null);
  const [allowanceMib, setAllowanceMib] = useState("50");
  const [imageLimitMib, setImageLimitMib] = useState("10");
  const [retentionHours, setRetentionHours] = useState(String(DEFAULT_SYNTHETIC_RETENTION_HOURS));
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
      setAllowanceMib(String(loaded.reportMediaAllowanceBytes / MEBIBYTE));
      setImageLimitMib(String(loaded.imageMediaLimitBytes / MEBIBYTE));
      setRetentionHours(loaded.syntheticRetentionHours === null ? "" : String(loaded.syntheticRetentionHours ?? DEFAULT_SYNTHETIC_RETENTION_HOURS));
    }).catch((reason: unknown) => {
      if (current) setError(language !== "en" ? t("settings.loadFailed") : reason instanceof Error ? reason.message : t("settings.loadFailed"));
    });
    return () => { current = false; };
  }, [language, t, settings]);

  useEffect(() => {
    if (draft) applyAgencyColors(draft.appearance, document, creating ? panel.current ?? undefined : undefined);
  }, [draft, creating]);

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
  const complete = !!draft && draft.appearance.brandText.trim() && draft.appearance.helperText.trim() &&
    draft.appearance.pwaName.trim() && draft.appearance.pwaShortName.trim() &&
    draft.demographics.agencyUniqueStateId.trim() && draft.demographics.agencyNumber.trim() &&
    /^[0-9]{2}$/.test(draft.demographics.stateCode);
  const unchanged = !!settings && !!draft && JSON.stringify({ ...draft, expectedRevision: settings.revision,
    syntheticRetentionHours: proposedRetentionHours,
    reportMediaAllowanceBytes: proposedBytes, imageMediaLimitBytes: proposedImageBytes }) === JSON.stringify(editable(settings));

  useUnsavedChanges(!!draft && !unchanged);
  useEffect(() => () => { if (settings && !creating) applyAgencyColors(settings.appearance, document); }, [settings, creating]);

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
    if (!settings || !draft || !validAllowance || !validImageLimit || !validRetentionHours || !complete || !canWrite) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    try {
      const command = { ...draft, syntheticRetentionHours: proposedRetentionHours,
        expectedRevision: settings.revision, reportMediaAllowanceBytes: proposedBytes, imageMediaLimitBytes: proposedImageBytes };
      if (creation) { await creation.onSubmit(command, form); return; }
      const updated = await updateAgencyMediaSettings(csrfToken, command);
      setSettings(updated); setDraft(editable(updated));
      setAllowanceMib(String(updated.reportMediaAllowanceBytes / MEBIBYTE));
      setImageLimitMib(String(updated.imageMediaLimitBytes / MEBIBYTE));
      setRetentionHours(updated.syntheticRetentionHours === null ? "" : String(updated.syntheticRetentionHours ?? DEFAULT_SYNTHETIC_RETENTION_HOURS));
      setNotice(t("settings.saved", { version: updated.demographics.version }));
    } catch (reason) {
      setError(reason instanceof Error && /revision is stale/i.test(reason.message) ? t("settings.stale") :
        language !== "en" ? t("settings.saveFailed") : reason instanceof Error ? reason.message : t("settings.saveFailed"));
    } finally { setBusy(false); }
  }

  return <section ref={panel} className="admin-configuration agency-settings" aria-labelledby={fieldId("agency-settings-heading")}>
    <div className="section-heading"><h2 id={fieldId("agency-settings-heading")}>{creating ? t("admin.newAgency") : t("navigation.settings")}</h2></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p className="agency-settings-notice" role="status">{notice}</p>}
    {!draft && !error && <p role="status">{t("settings.loading")}</p>}
    {draft && <form onSubmit={save} onChange={creation?.onChange}>
      {creation && <fieldset disabled={busy}>{creation.fields}</fieldset>}
      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.language")}</legend>
        <label htmlFor={fieldId("agency-language")}><strong>{t("settings.agencyLanguage")}</strong>
          <span>{t("settings.languageHelp")}</span></label>
        <select id={fieldId("agency-language")} value={draft.language} onChange={(event) =>
          setDraft((current) => current ? { ...current, language: event.target.value as AgencyLanguage } : current)}>
          {availableUiLanguages.map((code) => <option key={code} value={code}>{languageDisplayName(code, language)}</option>)}
        </select>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.regionalFormat")}</legend>
        <label htmlFor={fieldId("agency-regional-format")}><strong>{t("settings.datesAndNumbers")}</strong>
          <span>{t("settings.regionalFormatHelp")}</span></label>
        <select id={fieldId("agency-regional-format")} value={draft.regionalFormat ?? ""} onChange={(event) =>
          setDraft((current) => current ? { ...current, regionalFormat: (event.target.value || null) as RegionalFormat } : current)}>
          <option value="">{t("settings.currentFormat")}</option>
          <option value="en-US">English (United States)</option>
          <option value="sv-SE">Svenska (Sverige)</option>
        </select>
        <p aria-live="polite">{t("settings.preview")}: {formatClinicalDate("2026-09-28T13:45:00Z", draft.regionalFormat ?? null)} · {formatClinicalNumber(1234.5, draft.regionalFormat ?? null)}</p>
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.timeZone")}</legend>
        <label htmlFor={fieldId("agency-time-zone")}><strong>{t("settings.clinicalTimeZone")}</strong>
          <span>{t("settings.timeZoneHelp")}</span></label>
        <TimeZoneSelect id={fieldId("agency-time-zone")} value={draft.timeZone ?? null} language={language}
          onChange={(timeZone) => setDraft((current) => current ? { ...current, timeZone } : current)} />
      </fieldset>

      <fieldset disabled={!canWrite || busy}>
        <legend>{t("settings.demoRecords")}</legend>
        <label htmlFor={fieldId("synthetic-retention-hours")}><strong>{t("settings.demoWipeHours")}</strong></label>
        <input id={fieldId("synthetic-retention-hours")} name="syntheticRetentionHours" type="number" min="1" step="1"
          value={retentionHours} aria-describedby={fieldId("synthetic-retention-help")} aria-invalid={!validRetentionHours}
          onChange={(event) => setRetentionHours(event.target.value)} />
        <small id={fieldId("synthetic-retention-help")}>{t("settings.demoWipeHelp")}</small>
        {!validRetentionHours && <p className="admin-error" role="alert">{t("settings.demoWipeInvalid")}</p>}
      </fieldset>


      <fieldset disabled={!canWrite || busy}>
        <legend><AdminText messageKey="admin.reportMedia" /></legend>
        <label htmlFor={fieldId("image-media-limit")}><strong><AdminText messageKey="admin.perImageLimit" /></strong>
          <span><AdminText messageKey="admin.maximumCanonicalSize" /></span></label>
        <div className="agency-settings-input">
          <input id={fieldId("image-media-limit")} name="imageMediaLimitMib" type="number"
            min="1" max={validAllowance ? mib : 2048} step="1" required value={imageLimitMib}
            onChange={(event) => setImageLimitMib(event.target.value)} /><span>MB</span>
        </div>
        <small><AdminText messageKey="admin.allowedRange1MB" /></small>
        <label htmlFor={fieldId("report-media-allowance")}><strong><AdminText messageKey="admin.totalReportMedia" /></strong>
          <span><AdminText messageKey="admin.aggregatePhotoAnd" /></span></label>
        <div className="agency-settings-input">
          <input id={fieldId("report-media-allowance")} name="reportMediaAllowanceMib" type="number"
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
        {!creating && <p><AdminText messageKey="admin.changesAppendAn" /></p>}
        <label>{t("admin.agencyUniqueStateId")}<input maxLength={50} required
          value={draft.demographics.agencyUniqueStateId}
          onChange={(event) => changeDemographic("agencyUniqueStateId", event.target.value)} /></label>
        <label>{t("admin.agencyNumber")}<input maxLength={15} required
          value={draft.demographics.agencyNumber}
          onChange={(event) => changeDemographic("agencyNumber", event.target.value)} /></label>
        <label>{t("admin.agencyStateCode")}<input inputMode="numeric" pattern="[0-9]{2}" maxLength={2} required
          value={draft.demographics.stateCode}
          onChange={(event) => changeDemographic("stateCode", event.target.value)} /></label>
        <label><AdminText messageKey="admin.stateDisplayOptional" /><input maxLength={100} value={draft.demographics.stateDisplay ?? ""}
          onChange={(event) => changeDemographic("stateDisplay", event.target.value || null)} /></label>
        {!creating && <small>{resolveMessage(language, "admin.currentDemographicVersion", { version: settings?.demographics.version ?? 0, codeSystem: draft.demographics.stateCodeSystem ?? resolveMessage(language, "admin.notRecorded") })}</small>}
      </fieldset>

      {!creating && <small>{t("settings.revision", { revision: settings?.revision ?? 0 })}</small>}
      {!canWrite && <p>{t("settings.readOnly")}</p>}
      {canWrite && <div className="form-actions"><button type="submit"
        disabled={busy || !validAllowance || !validImageLimit || !validRetentionHours || !complete || !creating && unchanged}>{busy ? t("settings.saving") : t("settings.save")}</button>
        {creation && <button type="button" disabled={busy} onClick={creation.onCancel}>{t("admin.cancel")}</button>}</div>}
    </form>}
  </section>;
}
