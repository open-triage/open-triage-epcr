"use client";

import { auditCategories, auditDumpSources, clinicalValueSources, patientAuditCategories, type AuditCategory, type AuditDump, type AuditEntry, type AuditPage, type AuditQuery, type AuditTarget, type AuditUserPage, type ClinicalAuditValues } from "@open-triage/contracts";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { loadAuditDump, loadAuditPage, loadAuditUsers, loadClinicalAuditValues } from "../app/admin-context";
import { AdminLanguageContext, useAdminText } from "../app/admin-localization";
import { listAccessRemoved } from "../app/list-refresh";
import { activateListRow } from "./list-row-action";
import { useReturnFocus } from "./use-return-focus";
import { useAvailableHeight } from "./use-available-height";

function initialFilters() {
  const today = new Date();
  return { from: new Date(today.getTime() - 6 * 86400_000).toISOString().slice(0, 10),
    through: today.toISOString().slice(0, 10), actorId: "", uuid: "", categories: [] as AuditCategory[] };
}
function requestFilters(filters: ReturnType<typeof initialFilters>): AuditQuery {
  return { categories: filters.categories, from: `${filters.from}T00:00:00.000Z`,
    to: new Date(Date.parse(`${filters.through}T00:00:00Z`) + 86400_000).toISOString(),
    ...(filters.actorId.trim() ? { actorId: filters.actorId.trim() } : {}),
    ...(filters.uuid.trim() ? { uuid: filters.uuid.trim() } : {}) };
}

function actorLabel(entry: AuditEntry) {
  return entry.actorDisplayName ?? entry.actorUsername ?? entry.actorId;
}

function referenceLabel(id: string | null | undefined, target: AuditTarget | null | undefined,
  t: ReturnType<typeof useAdminText>, language: string) {
  if (!id) return t("auditUi.noValue");
  if (target?.kind === "auditEvent") return id;
  const kind = t(`auditUi.targetKind.${target?.kind ?? "record"}`);
  let name = target?.label;
  if (target?.kind === "capability") {
    const key = `admin.capability.${id}`, translated = t(key);
    if (translated !== key) name = translated;
  }
  if (target?.occurredAt && target.kind !== "analytics") {
    const time = new Date(target.occurredAt).toLocaleString(language, { timeZone: "UTC" });
    name = name ? t("auditUi.datedLabel", { label: name, time }) : t("auditUi.referenceTime", { time });
  }
  if (!name) return t("auditUi.targetReference", { kind, reference: id.slice(0, 8) });
  const label = target?.version == null ? name : t("auditUi.targetVersion", {
    label: name, version: target.version,
  });
  return t("auditUi.targetLabel", { kind, label });
}

export function AuditingPanel({ canReadPatients, active, online }: {
  readonly canReadPatients: boolean; readonly active: boolean; readonly online: boolean;
}) {
  const t = useAdminText();
  const language = useContext(AdminLanguageContext);
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState<AuditQuery>(() => requestFilters(initialFilters()));
  const [loaded, setLoaded] = useState<{ query: AuditQuery; page: AuditPage } | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const trigger = useRef<HTMLTableRowElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const typeFilter = useRef<HTMLDetailsElement>(null);
  const requestGeneration = useRef(0);
  const tableScroll = useAvailableHeight<HTMLDivElement>(90);
  useReturnFocus(!!selected && active, busy, () => active ? trigger.current : null);
  useEffect(() => {
    if (selected && active && !dialog.current?.open) dialog.current?.showModal();
  }, [selected, active]);
  const clearAccess = useCallback(() => {
    requestGeneration.current++;
    setLoaded(null); setSelected(null); setError(true); setBusy(false);
  }, []);
  const categories = (loaded?.page.categories ?? auditCategories).filter((category) =>
    canReadPatients || !patientAuditCategories.includes(category));

  useEffect(() => {
    if (!active || !online) return;
    let current = true;
    const generation = ++requestGeneration.current;
    // Defer loading state so synchronous effect setup never replaces retained rows.
    void Promise.resolve().then(() => {
      if (current) { setBusy(true); setError(false); }
      return loadAuditPage(query);
    }).then((page) => {
      if (current && generation === requestGeneration.current) {
        setLoaded({ query, page }); setSelected(null);
      }
    }).catch((reason: unknown) => {
      if (current && generation === requestGeneration.current) {
        if (listAccessRemoved(reason)) clearAccess();
        setError(true);
      }
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [active, online, query, refresh, clearAccess]);

  const submit = () => {
    try {
      setQuery(requestFilters(filters)); setSelected(null);
      if (typeFilter.current) typeFilter.current.open = false;
    }
    catch { setError(true); }
  };
  const missing = t("auditUi.noValue");
  const categoryLabel = (categories?: readonly AuditCategory[]) => categories?.length
    ? categories.map(category => t(`auditUi.category.${category}`)).join(", ") : t("auditUi.allLogs");
  const targetLabel = (entry: AuditEntry) => entry.inspection?.kind === "list"
    ? entry.inspection.category === "combined"
      ? t("auditUi.combinedListTarget", { count: entry.inspection.categories?.length ?? 0 })
      : t("auditUi.listTarget", { category: t(`auditUi.category.${entry.inspection.category}`) })
    : referenceLabel(entry.targetId, entry.target, t, language);
  const agencyLabel = (id: string | null, name?: string | null) => referenceLabel(id, { kind: "organization", label: name ?? null }, t, language);
  return <section className="admin-panel audit-panel" aria-labelledby="audit-heading">
    <h2 id="audit-heading">{t("auditUi.title")}</h2>
    <form className="audit-filters" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <details ref={typeFilter} className="audit-type-filter">
        <summary>{t("auditUi.logTypes")}: {filters.categories.length
          ? t("auditUi.typesSelected", { count: filters.categories.length }) : t("auditUi.allLogs")}</summary>
        <p className="audit-help">{t("auditUi.typesHelp")}</p>
        <div className="audit-type-options" role="group" aria-label={t("auditUi.logTypes")}>
          {categories.map(category => <label key={category}>
            <input type="checkbox" checked={filters.categories.includes(category)}
              onChange={event => setFilters(previous => ({ ...previous, categories: event.target.checked
                ? categories.filter(candidate => candidate === category || previous.categories.includes(candidate))
                : previous.categories.filter(candidate => candidate !== category) }))} />
            {t(`auditUi.category.${category}`)}
          </label>)}
        </div>
        <button type="button" disabled={!filters.categories.length}
          onClick={() => setFilters(previous => ({ ...previous, categories: [] }))}>{t("auditUi.clearTypes")}</button>
      </details>
      <label>{t("auditUi.from")}<input type="date" required value={filters.from}
        onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label>{t("auditUi.through")}<input type="date" required value={filters.through}
        onChange={(event) => setFilters({ ...filters, through: event.target.value })} /></label>
      <AuditUserFilter value={filters.actorId} onChange={(actorId) => setFilters({ ...filters, actorId })}
        active={active} online={online} onAccessRemoved={clearAccess} />
      <label>{t("auditUi.uuidFilter")}<input value={filters.uuid}
        onChange={(event) => setFilters({ ...filters, uuid: event.target.value })} /></label>
      <button type="submit" disabled={busy || !online}>{t("auditUi.apply")}</button>
    </form>
    <p className="audit-help">{t("auditUi.help")}</p>
    {!online && <p role="status">{t("auditUi.offline")}</p>}
    {error && <p role="alert">{t(loaded ? "auditUi.retained" : "auditUi.failed")}
      <button type="button" disabled={!online || busy} onClick={() => setRefresh((value) => value + 1)}>{t("auditUi.retry")}</button></p>}
    {busy && <p role="status">{t("auditUi.loading")}</p>}
    {loaded && <>
      <p className="audit-results-label" aria-live="polite">{t("auditUi.showing", { category: categoryLabel(loaded.query.categories),
        from: loaded.query.from.slice(0, 10), to: new Date(Date.parse(loaded.query.to) - 1).toISOString().slice(0, 10) })}</p>
      <div className="audit-results">
        <div ref={tableScroll} className="audit-table-scroll" tabIndex={0} role="region" aria-label={t("auditUi.events")}>
          <table className="audit-table"><thead><tr>
            {["eventId", "logType", "time", "actor", "action", "outcome", "target"].map((key) => <th scope="col" key={key}>{t(`auditUi.${key}`)}</th>)}
          </tr></thead><tbody>{loaded.page.entries.map((entry) => <tr key={`${entry.source}:${entry.id}`}
            className="admin-directory-row" aria-selected={selected?.source === entry.source && selected.id === entry.id}
            tabIndex={0} aria-label={t("auditUi.inspectEvent", { action: entry.action })} aria-haspopup="dialog"
            onClick={(event) => activateListRow(event, () => { trigger.current = event.currentTarget; setSelected(entry); })}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
              event.preventDefault(); trigger.current = event.currentTarget; setSelected(entry);
            }}>
            <td>{entry.id}</td>
            <td>{t(`auditUi.category.${entry.category}`)}</td>
            <td><time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString(language, { timeZone: "UTC" })}</time></td>
            <td>{actorLabel(entry) ?? missing}</td><td>{entry.action}</td><td>{entry.outcome ?? missing}</td><td>{targetLabel(entry)}</td>
          </tr>)}</tbody></table>
          {!loaded.page.entries.length && <p role="status">{t("auditUi.empty")}</p>}
        </div>
        {selected && active && <dialog ref={dialog} className="audit-dialog" aria-labelledby="audit-event-heading"
          onCancel={(event) => { event.preventDefault(); setSelected(null); }} onClose={() => setSelected(null)}>
          <header className="audit-dialog-heading">
            <h3 id="audit-event-heading">{t("auditUi.details")}</h3>
            <button type="button" onClick={() => setSelected(null)}>{t("auditUi.close")}</button>
          </header>
          <div className="audit-dialog-content" tabIndex={0} role="region" aria-label={t("auditUi.details")}>
            <dl className="audit-event-summary">{([ ["eventId", selected.id], ["logType", t(`auditUi.category.${selected.category}`)],
              ["time", selected.occurredAt], ["source", selected.source],
              ["actor", actorLabel(selected)], ["action", selected.action], ["outcome", selected.outcome],
              ["target", targetLabel(selected)],
              ...(selected.inspection?.kind === "list" ? [["logTypes", categoryLabel(selected.inspection.categories
                ?? (selected.inspection.category === "combined" ? [] : [selected.inspection.category]))]] : []),
              ...(selected.inspection?.uuidFilter ? [["searchedUuid", selected.inspection.uuidFilter]] : []),
              ["patient", selected.patientId && selected.target?.kind === "report" && selected.target.label
                ? t("auditUi.patientForReport", { report: selected.target.label })
                : referenceLabel(selected.patientId, { kind: "patient", label: null }, t, language)],
              ["accessOrganization", agencyLabel(selected.accessOrganizationId, selected.accessOrganizationName)],
              ["careProcess", selected.careProcess], ["resource", referenceLabel(selected.resourceId, selected.resource, t, language)],
              ...(selected.analytics ? [ ["dataset", selected.analytics.dataset], ["queryFrom", selected.analytics.from],
                ["queryThrough", selected.analytics.through], ["reportCount", selected.analytics.reportCount?.toString()],
                ["reportScope", selected.analytics.reportScope], ["identifying", t(selected.analytics.identifying ? "auditUi.yes" : "auditUi.no")],
                ["organizations", selected.analytics.organizationIds.map(id => agencyLabel(id,
                  selected.analytics?.organizations?.find(organization => organization.id === id)?.name)).join(", ") || missing] ] : []) ] as const).map(([label, value]) => <div key={label}>
                <dt>{t(`auditUi.${label}`)}</dt><dd>{value ?? missing}</dd></div>)}</dl>
            {selected.recovery&&<p><a href={`/review-call?report=${selected.recovery.reportId}&item=${selected.recovery.itemId}&dataset=${selected.recovery.dataset}`}>{t('review.recovery.open')}</a> · {t('review.transmission.version',{sequence:selected.recovery.amendmentSequence,revision:'—'})}</p>}
            <details className="audit-identifiers">
              <summary>{t("auditUi.identifiers")}</summary>
              <dl>{([ ["actorId", selected.actorId], ["targetId", selected.targetId],
                ["patientId", selected.patientId], ["accessOrganizationId", selected.accessOrganizationId],
                ["resourceId", selected.resourceId], ["organizationIds", selected.analytics?.organizationIds.join(", ")],
              ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}>
                <dt>{t(`auditUi.${label}`)}</dt><dd>{value}</dd></div>)}</dl>
            </details>
            {canReadPatients && clinicalValueSources.includes(selected.source as typeof clinicalValueSources[number]) &&
              <ClinicalValues key={`${selected.source}:${selected.id}`} entry={selected} active={active} online={online} onAccessRemoved={clearAccess} />}
            {auditDumpSources.includes(selected.source as typeof auditDumpSources[number]) &&
              <EventDump key={`${selected.source}:${selected.id}`} entry={selected} online={online} onAccessRemoved={clearAccess} />}
          </div>
        </dialog>}
      </div>
      <div className="audit-pagination">
        <button type="button" disabled={!loaded.query.cursor || busy || !online}
          onClick={() => setQuery({ ...loaded.query, cursor: undefined })}>{t("auditUi.first")}</button>
        <span className="audit-page-status" aria-live="polite">
          <span>{t("auditUi.pageNumber", { page: loaded.page.pageNumber, pages: loaded.page.totalPages })}</span>
          <span>{t("auditUi.pageCount", { count: loaded.page.entries.length, total: loaded.page.totalEntries })}</span>
        </span>
        <button type="button" disabled={!loaded.page.nextCursor || busy || !online}
          onClick={() => setQuery({ ...loaded.query, cursor: loaded.page.nextCursor! })}>{t("auditUi.next")}</button>
      </div>
    </>}
  </section>;
}

function AuditUserFilter({ value, onChange, active, online, onAccessRemoved }: {
  value: string; onChange: (id: string) => void; active: boolean; online: boolean; onAccessRemoved: () => void;
}) {
  const t = useAdminText();
  const [loaded, setLoaded] = useState<AuditUserPage | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || !online) return;
    let current = true;
    void Promise.resolve().then(() => {
      if (current) { setBusy(true); setFailed(false); }
      return loadAuditUsers(cursor);
    }).then((page) => {
      if (current) setLoaded((previous) => ({ ...page, users: cursor
        ? [...new Map([...(previous?.users ?? []), ...page.users].map((user) => [user.id, user])).values()]
        : page.users }));
    }).catch((reason: unknown) => {
      if (current) {
        setFailed(true);
        if (listAccessRemoved(reason)) { setLoaded(null); onAccessRemoved(); }
      }
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [active, online, cursor, attempt, onAccessRemoved]);
  return <div className="audit-user-filter">
    <label>{t("auditUi.actorFilter")}<select value={value} disabled={!online || busy}
      onChange={(event) => onChange(event.target.value)}>
      <option value="">{t("auditUi.allUsers")}</option>
      {value && !loaded?.users.some((user) => user.id === value) && <option value={value}>{t("auditUi.selectedUser")}</option>}
      {loaded?.users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
    </select></label>
    {busy && <span role="status">{t("auditUi.usersLoading")}</span>}
    {failed && <span role="alert">{t("auditUi.usersFailed")} <button type="button" disabled={!online || busy}
      onClick={() => setAttempt((current) => current + 1)}>{t("auditUi.retry")}</button></span>}
    {!failed && loaded?.nextCursor && <button type="button" disabled={!online || busy}
      onClick={() => setCursor(loaded.nextCursor!)}>{t("auditUi.moreUsers")}</button>}
  </div>;
}

function EventDump({ entry, online, onAccessRemoved }: {
  entry: AuditEntry; online: boolean; onAccessRemoved: () => void;
}) {
  const t = useAdminText();
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dump, setDump] = useState<AuditDump | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!expanded || !online) return;
    let current = true;
    void loadAuditDump(entry.source, entry.id).then((result) => {
      if (current) { setDump(result); setFailed(false); }
    }).catch((reason: unknown) => {
      if (current) {
        setDump(null); setFailed(true);
        if (listAccessRemoved(reason)) onAccessRemoved();
      }
    });
    return () => { current = false; };
  }, [expanded, online, attempt, entry.source, entry.id, onAccessRemoved]);
  return <section className="audit-event-dump" aria-label={t("auditUi.dump")}>
    <button type="button" aria-expanded={expanded} aria-controls="audit-event-json" disabled={!online}
      onClick={() => { setDump(null); setFailed(false); setExpanded(!expanded); }}>
      {t(expanded ? "auditUi.hideDump" : "auditUi.showDump")}</button>
    {expanded && <div id="audit-event-json">
      {!dump && !failed && <p role="status">{t("auditUi.dumpLoading")}</p>}
      {failed && <p role="alert">{t("auditUi.dumpFailed")} <button type="button" disabled={!online}
        onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t("auditUi.retry")}</button></p>}
      {dump?.requestCaptured === false && <p role="status">{t("auditUi.queryNotCaptured")}</p>}
      {dump && <pre tabIndex={0} aria-label={t("auditUi.dump")}>{JSON.stringify(dump.payload, null, 2)}</pre>}
    </div>}
  </section>;
}

function ClinicalValues({ entry, active, online, onAccessRemoved }: {
  entry: AuditEntry; active: boolean; online: boolean; onAccessRemoved: () => void;
}) {
  const t = useAdminText();
  const [request, setRequest] = useState(0);
  const [values, setValues] = useState<ClinicalAuditValues | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!request || !active || !online) return;
    let current = true;
    void loadClinicalAuditValues(entry.source, entry.id).then((result) => {
      if (current) { setValues(result); setFailed(false); }
    }).catch((reason: unknown) => { if (current) {
      setValues(null); setFailed(true);
      if (listAccessRemoved(reason)) onAccessRemoved();
    } });
    return () => { current = false; };
  }, [entry.source, entry.id, request, active, online, onAccessRemoved]);
  return <section className="audit-clinical-values" aria-label={t("auditUi.clinicalValues")}>
    <button type="button" disabled={!online || !!request && !failed && !values}
      onClick={() => { setValues(null); setFailed(false); setRequest(value => value + 1); }}>{t("auditUi.viewValues")}</button>
    {!!request && !values && !failed && <p role="status">{t("auditUi.loading")}</p>}
    {failed && <p role="alert">{t("auditUi.valuesFailed")}</p>}
    {values && <dl>{Object.entries(values.values).map(([key, value]) => <div key={key}>
      <dt>{t(`auditUi.values.${key}`)}</dt><dd><pre>{JSON.stringify(value, null, 2)}</pre></dd>
    </div>)}</dl>}
  </section>;
}
