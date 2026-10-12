"use client";

import type { AgencyConfigurationOption, AgencySummary, AuthenticatedSession, UpdateAgencyMediaSettingsCommand } from "@open-triage/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { AgencySettingsPanel } from "./agency-settings";
import { resolveMessage, resolveErrorMessage, type AgencyLanguage } from "../app/localization";
import { createAgency, loadAgencies, updateAgency } from "../app/agencies";
import { sessionRequestToken } from "../app/clinician-session";
import { useUnsavedChanges } from "./unsaved-changes";
import { activateListRow } from "./list-row-action";
import { LoadingStatus } from "./loading-status";
import { listAccessRemoved } from "../app/list-refresh";

function AgencyHostnameField({ hostname, suffix, language }: {
  readonly hostname: string | null; readonly suffix: string | null; readonly language: AgencyLanguage;
}) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const prefix = suffix && hostname?.endsWith(`.${suffix}`) ? hostname.slice(0, -(suffix.length + 1)) : null;
  // Keep existing custom domains intact; only strip the installation's exact suffix.
  const subdomain = Boolean(suffix && (!hostname || prefix && !prefix.includes(".")));
  const [value, setValue] = useState(subdomain ? prefix ?? "" : hostname ?? "");
  const label = subdomain ? t("admin.subdomain") : t("admin.hostname");
  const address = subdomain ? `${value.trim().toLowerCase() || "test"}.${suffix}` : value;
  return <label>{label}<input name="hostname" aria-label={label} aria-describedby="agency-hostname-help"
    placeholder={subdomain ? "test" : "test.opentriage.org"} maxLength={subdomain ? 63 : 253}
    pattern={subdomain ? "[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?" : undefined}
    title={subdomain ? t("admin.subdomainHelp") : undefined}
    value={value} onChange={(event) => setValue(event.target.value)} />
    <small id="agency-hostname-help">{subdomain
      ? `${value.trim() ? t("admin.fullHostname") : t("admin.example")}: ${address}`
      : t("admin.hostnameHelp")}</small>
  </label>;
}

export function OrganizationManagement({ session, language, onOpenAgency, active = true }: {
  readonly active?: boolean;
  readonly session: AuthenticatedSession; readonly language: AgencyLanguage; readonly onOpenAgency: (id: string) => Promise<void>;
}) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAgencies>> | null>(null);
  const [editor, setEditor] = useState<AgencySummary | "new" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [catalogId, setCatalogId] = useState("");
  const [formId, setFormId] = useState("");
  const [validationId, setValidationId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const canLeave = useUnsavedChanges(dirty);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadAgencies().then((loaded) => { if (current) { setData(loaded); setError(null); } })
      .catch((reason: unknown) => { if (current) {
        if (listAccessRemoved(reason)) { setData(null); setEditor(null); setDirty(false); }
        setError(resolveErrorMessage(language, reason instanceof Error ? reason.message : null, "admin.agenciesLoadFailed"));
      } });
    return () => { current = false; };
  }, [active, session.user.id, refresh, language]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true); setError(null);
    try {
      const common = { name: value("name"), hostname: value("hostname") || null };
      if (editor === "new") return;
      const saved = await updateAgency(sessionRequestToken(session), editor.id, { ...common,
        active: form.get("active") === "on", expectedRevision: editor.revision });
      setData((prior) => prior ? { ...prior, agencies: [...prior.agencies.filter((row) => row.id !== saved.id), saved] } : prior);
      setDirty(false); setEditor(null); setRefresh((n) => n + 1);
    } catch (reason) { setError(resolveErrorMessage(language, reason instanceof Error ? reason.message : null, "admin.agencySaveFailed")); }
    finally { setBusy(false); }
  }

  async function saveNew(settings: UpdateAgencyMediaSettingsCommand, form: FormData) {
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const { expectedRevision: _revision, ...initialSettings } = settings;
    const saved = await createAgency(sessionRequestToken(session), {
      name: value("name"), hostname: value("hostname") || null, parentOrganizationId: value("parent") || null,
      timeZone: settings.timeZone ?? "UTC", catalogReleaseId: catalogId,
      agencyUniqueStateId: settings.demographics.agencyUniqueStateId, agencyNumber: settings.demographics.agencyNumber,
      stateCode: settings.demographics.stateCode, startingFormVersionId: formId || null,
      startingValidationVersionId: validationId || null, settings: initialSettings,
    });
    setData((prior) => prior ? { ...prior, agencies: [...prior.agencies, saved] } : prior);
    setDirty(false); setEditor(null); setRefresh((n) => n + 1);
  }

  const usage = (config: Pick<AgencyConfigurationOption, "activatedByAgencies">) => config.activatedByAgencies?.length
    ? t("admin.configurationActivatedBy", { agencies: config.activatedByAgencies.map(({ name }) => name).join(", ") })
    : t("admin.configurationUnused");
  const optionLabel = (config: AgencyConfigurationOption) => `${config.name} (${data?.agencies.find(({ id }) => id === config.organizationId)?.name ?? config.organizationId}) — ${usage(config)}`;
  const selectedCatalog = data?.catalogs.find(({ id }) => id === catalogId);
  const selectedForm = data?.forms?.find(({ id }) => id === formId);
  const selectedValidation = data?.validations?.find(({ id }) => id === validationId);
  const filtered = data?.agencies.filter((agency) => `${agency.name} ${agency.hostname ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const pageCount = Math.max(1, Math.ceil(filtered.length / 15));
  const currentPage = Math.min(page, pageCount - 1);
  const selected = editor && editor !== "new" ? editor : null;
  return <section className="admin-directory agency-management" aria-labelledby="agencies-heading">
    <div className="section-heading"><h2 id="agencies-heading">{t("admin.agencyManagementHeading")}</h2>
      {!editor && <button type="button" onClick={() => { setEditor("new"); setDirty(false); setCatalogId(""); setFormId(""); setValidationId(""); }} disabled={busy || !data}>{t("admin.newAgency")}</button>}
    </div>
    {error && <div role="alert" className="admin-error"><p>{error}</p><button type="button" onClick={() => setRefresh((n) => n + 1)}>{t("admin.retry")}</button></div>}
    {!data && !error && <LoadingStatus>{t("admin.loadingAgencies")}</LoadingStatus>}
    {editor === "new" ? <AgencySettingsPanel csrfToken={sessionRequestToken(session)} canWrite language={language}
      creation={{ onSubmit: saveNew, onChange: () => setDirty(true),
        onCancel: () => { if (canLeave()) { setEditor(null); setDirty(false); } },
        fields: <>
          <legend>{t("admin.agency")}</legend>
          <label>{t("admin.agencyName")}<input name="name" required maxLength={200} /></label>
          <AgencyHostnameField hostname={null} suffix={data?.hostnameSuffix ?? null} language={language} />
          <div className="agency-configuration-selectors">
          <label>{t("admin.parentAgency")}<select name="parent" aria-label={t("admin.parentAgency")}><option value="">{t("admin.independentAgency")}</option>
            {data?.agencies.filter((agency) => !agency.parentOrganizationId && agency.active).map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}
          </select></label>
          <label>{t("admin.catalog")}<select name="catalog" aria-label={t("admin.catalog")} aria-describedby={selectedCatalog ? "starting-catalog-usage" : undefined} required value={catalogId}
            onChange={(event) => { setCatalogId(event.target.value); setFormId(""); setValidationId(""); }}><option value="">{t("admin.chooseCatalog")}</option>
            {data?.catalogs.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name} — {usage(catalog)}</option>)}
          </select>{selectedCatalog && <small id="starting-catalog-usage">{usage(selectedCatalog)}</small>}</label>
          <label>{t("admin.startingForm")}<select name="startingForm" aria-label={t("admin.startingForm")} aria-describedby={selectedForm ? "starting-form-usage" : undefined} value={formId} disabled={!catalogId}
            required={Boolean(validationId)} onChange={(event) => setFormId(event.target.value)}>
            <option value="">{t("admin.configureLater")}</option>
            {data?.forms?.filter((config) => config.catalogReleaseId === catalogId).map((config) =>
              <option key={config.id} value={config.id}>{optionLabel(config)}</option>)}
          </select>{selectedForm && <small id="starting-form-usage">{usage(selectedForm)}</small>}</label>
          <label>{t("admin.startingValidationRules")}<select name="startingValidation" aria-label={t("admin.startingValidationRules")} aria-describedby={selectedValidation ? "starting-validation-usage" : undefined} value={validationId} disabled={!catalogId}
            required={Boolean(formId)} onChange={(event) => setValidationId(event.target.value)}>
            <option value="">{t("admin.configureLater")}</option>
            {data?.validations?.filter((config) => config.catalogReleaseId === catalogId).map((config) =>
              <option key={config.id} value={config.id}>{optionLabel(config)}</option>)}
          </select>{selectedValidation && <small id="starting-validation-usage">{usage(selectedValidation)}</small>}</label>
          </div>
          <p className="agency-configuration-help">{t("admin.startingConfigurationHelp")}</p>
        </>,
      }} /> : editor ? <form key={selected?.id ?? "new"} className="agency-editor" onSubmit={save} onChange={() => setDirty(true)}>
      <p>{t("admin.agencyFamilyHelp")}</p>
      <div className="agency-editor-fields">
        <label>{t("admin.agencyName")}<input name="name" required maxLength={200} defaultValue={selected?.name} /></label>
        <AgencyHostnameField hostname={selected?.hostname ?? null} suffix={data?.hostnameSuffix ?? null} language={language} />

          <p>{t("admin.parent")}: {data?.agencies.find((agency) => agency.id === selected?.parentOrganizationId)?.name ?? t("admin.independentAgency")}</p>
          <label className="agency-active"><input name="active" type="checkbox" defaultChecked={selected?.active} />{t("admin.active")}</label>

      </div>
      <div className="agency-actions"><button type="submit" disabled={busy}>{busy ? t("admin.saving") : t("admin.save")}</button>
        <button type="button" disabled={busy} onClick={() => { if (canLeave()) { setEditor(null); setDirty(false); } }}>{t("admin.cancel")}</button></div>
    </form> : data && <>
      <div className="admin-directory-filters"><label>{t("admin.findAgency")}<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label></div>
      <div className="admin-table-scroll agency-table"><table><thead><tr>
        {[t("admin.agency"), t("admin.parent"), t("admin.hostname"), t("admin.status"), t("admin.activeConfiguration"), t("admin.actions")].map((label) => <th key={label} scope="col">{label}</th>)}
      </tr></thead><tbody>{filtered.slice(currentPage * 15, currentPage * 15 + 15).map((agency) => <tr key={agency.id} className="admin-directory-row"
        onClick={(event) => activateListRow(event, () => { setEditor(agency); setDirty(false); })}>
        <td>{agency.name}</td><td>{data.agencies.find((parent) => parent.id === agency.parentOrganizationId)?.name ?? "—"}</td>
        <td>{agency.hostname ?? "—"}</td><td>{agency.active ? t("admin.active") : t("admin.inactive")}</td>
        <td>{(() => {
          const config = data.activeConfigurations?.find(({ organizationId }) => organizationId === agency.id);
          return config ? <>{config.catalogName}<br />{config.formName}<br />{config.validationName}</>
            : t("admin.noActiveConfiguration");
        })()}</td>
        <td><div className="agency-actions"><button type="button" data-list-row-action aria-label={`${t("admin.edit")}: ${agency.name}`}
          onClick={() => { setEditor(agency); setDirty(false); }}>{t("admin.edit")}</button>
          <button type="button" disabled={busy || !agency.active} onClick={async () => {
            setBusy(true); setError(null);
            try { await onOpenAgency(agency.id); } catch (reason) { setError(resolveErrorMessage(language, reason instanceof Error ? reason.message : null, "admin.agencyOpenFailed")); }
            finally { setBusy(false); }
          }}>{t("admin.openAdmin")}</button></div></td>
      </tr>)}</tbody></table>{filtered.length === 0 && <p>{t("admin.noAgenciesFound")}</p>}</div>
      <div className="agency-actions agency-pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("admin.previous")}</button>
        <span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{t("admin.next")}</button></div>
    </>}
  </section>;
}
