"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyticsCatalogValue, AnalyticsDefinition, AnalyticsElement, AnalyticsResult, AnalyticsSavedVisualization, ClinicianSession } from "@open-triage/contracts";
import { resolveErrorMessage, resolveMessage, type AgencyLanguage } from "../app/localization";
import { clinicalInstantParts, useAgencyTimeZone } from "../app/agency-time-zone";
import { useRegionalFormat } from "../app/regional-format";
import { useAvailableHeight } from "./use-available-height";
import { AnalyticsPicker } from "./analytics-picker";
import { AnalyticsResultView } from "./analytics-result";
import { AnalyticsEvidence } from "./analytics-evidence";
import { AnalyticsSavedVisualizations } from "./analytics-saved-visualizations";
import { analyticsRequest, analyticsSignature, AnalyticsRequestError } from "./analytics-api";

const records: AnalyticsElement = { id: "records", label: "Records", datatype: "records", kind: "categorical", unit: null,
  operations: ["distribution"], aggregations: ["count", "percentage"], grouping: false, filtering: false, units: [], recordCount: 0 };
export function AnalyticsWorkspace({ session, language, online, active }: {
  session: ClinicianSession; language: AgencyLanguage; online: boolean; active: boolean;
}) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, `analytics.${key}`, parameters);
  const region = useRegionalFormat(), zone = useAgencyTimeZone();
  const workspace = useAvailableHeight<HTMLDivElement>(24);
  const [draft, setDraft] = useState<AnalyticsDefinition>(() => ({ version: 1, metric: "records", aggregation: "count", visualization: "line",
    from: clinicalInstantParts(new Date(Date.now() - 29 * 86400000), zone)!.date,
    through: clinicalInstantParts(new Date(), zone)!.date, groupBy: null, timeGrouping: "week", filters: [] }));
  const [fields, setFields] = useState<Record<string, AnalyticsElement>>({ records });
  const [filterLabels, setFilterLabels] = useState<Record<string, AnalyticsCatalogValue[]>>({});
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [saved, setSaved] = useState<AnalyticsSavedVisualization | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [picker, setPicker] = useState<{ purpose: "metric" | "group" | "filter"; element?: AnalyticsElement } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const pickerTrigger = useRef<HTMLElement | null>(null);
  const openPicker = (next: NonNullable<typeof picker>) => { pickerTrigger.current = document.activeElement as HTMLElement; setPicker(next); };
  const closePicker = () => { setPicker(null); requestAnimationFrame(() => pickerTrigger.current?.focus({ preventScroll: true })); };
  const exportDialog = useRef<HTMLDialogElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const csrf = session.csrfToken ?? session.accessToken ?? "";
  const clearProtected = useCallback(() => {
    request.current?.abort(); generation.current++;
    setDraft((previous) => ({ version: 1, metric: "records", aggregation: "count", visualization: previous.visualization,
      from: previous.from, through: previous.through, groupBy: null, timeGrouping: previous.timeGrouping, filters: [] }));
    setNotice(""); setResult(null); setSaved(null); setFields({ records }); setFilterLabels({}); setPicker(null); setExportOpen(false); setBusy(false); setExporting(false);
    setError(resolveMessage(language, "analytics.denied"));
  }, [language]);
  useEffect(() => () => { request.current?.abort(); generation.current++; }, []);
  useEffect(() => { if (!online) request.current?.abort(); }, [online]);
  useEffect(() => {
    if (exportOpen && online) exportDialog.current?.showModal();
    else if (exportDialog.current?.open) { exportDialog.current.close(); exportTrigger.current?.focus(); }
  }, [exportOpen, online]);
  const metric = fields[draft.metric] ?? records;
  const dirty = !result || analyticsSignature(draft) !== analyticsSignature(result.definition);
  const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const invalidDates = !dateValid(draft.from) || !dateValid(draft.through) || draft.from > draft.through || (Date.parse(draft.through) - Date.parse(draft.from)) / 86400000 > 365;
  const invalidQualifier = metric.repeating && metric.kind === "numeric" && !draft.reducer ||
    (metric.units.length > 1 || metric.id === "eMedications.05") && !draft.unit;
  const canExport = !!result && !dirty && !busy && !exporting && !error && online && result.freshness.status === "current";
  const update = (change: Partial<AnalyticsDefinition>) => { setDraft((previous) => ({ ...previous, ...change })); setNotice(""); };
  const chooseElement = (element: AnalyticsElement | null) => {
    if (element) setFields((previous) => ({ ...previous, [element.id]: element }));
    if (picker?.purpose === "metric" && element) {
      const compatible = element.aggregations.includes(draft.aggregation);
      const aggregation = compatible ? draft.aggregation : element.kind === "numeric" ? "median" : "count";
      const { reducer: _reducer, unit: _unit, outcome: _outcome, ...base } = draft;
      setDraft({ ...base, metric: element.id, aggregation,
        ...(element.configured?.kind === "rule" ? { outcome: "pass" as const } : {}),
        ...(element.kind === "numeric" && element.repeating && draft.reducer ? { reducer: draft.reducer } : {}),
        ...(draft.unit && element.units.includes(draft.unit) ? { unit: draft.unit } : {}) });
      setNotice(compatible ? "" : t("aggregationChanged", { aggregation: t(`aggregation.${aggregation}`) })); closePicker();
    } else if (picker?.purpose === "group") { update({ groupBy: element?.id ?? null }); closePicker(); }
    else if (element) setPicker({ purpose: "filter", element });
  };
  async function apply() {
    if (request.current && busy) {
      request.current.abort(); request.current = null; generation.current++;
      setBusy(false); setNotice(t("cancelled")); return;
    }
    if (!online || invalidDates || invalidQualifier) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++generation.current; setBusy(true); setError(""); setNotice("");
    try {
      const next = await analyticsRequest<AnalyticsResult>("query", csrf, controller.signal, draft);
      if (controller.signal.aborted || generation.current !== current) return;
      setResult(next);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== current) return;
      if (cause instanceof AnalyticsRequestError && [401, 403].includes(cause.status)) { clearProtected(); return; }
      setError(cause instanceof Error ? resolveErrorMessage(language, cause.message, "analytics.unavailable") : t("unavailable"));
    } finally { if (generation.current === current) { request.current = null; setBusy(false); } }
  }
  async function download(kind: "aggregate" | "records") {
    if (!canExport || !result) return;
    const controller = new AbortController(); request.current = controller;
    const current = ++generation.current; setExporting(true); setError(""); setNotice("");
    try {
      const blob = await analyticsRequest<Blob>("export", csrf, controller.signal,
        { kind, definition: result.definition, expectedRevision: result.exportRevision });
      if (controller.signal.aborted || generation.current !== current) return;
      const href = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = href; anchor.download = `analytics-${kind}.csv`; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000); setExportOpen(false);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== current) return;
      setExportOpen(false);
      if (cause instanceof AnalyticsRequestError && [400, 401, 403].includes(cause.status)) { clearProtected(); return; }
      if (cause instanceof AnalyticsRequestError && cause.result) { setResult(cause.result); setNotice(t("refreshed")); }
      else setError(cause instanceof Error ? resolveErrorMessage(language, cause.message, "analytics.exportFailed") : t("exportFailed"));
    } finally { if (generation.current === current) setExporting(false); }
  }
  const formatted = (value: number) => new Intl.NumberFormat(region ?? language, { maximumFractionDigits: 2 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(region ?? language, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return <div className="analytics-workspace" ref={workspace}>
    <form className="analytics-rail" onSubmit={(event) => { event.preventDefault(); void apply(); }}>
      <fieldset disabled={!online || exporting}><legend>{t("controls")}</legend>
        <AnalyticsSavedVisualizations key={`${session.organization.id}:${session.user.id}`} definition={draft} saved={saved}
          language={language} csrfToken={csrf} disabled={!online || exporting || busy} canSave={!invalidDates && !invalidQualifier} active={active}
          onDenied={clearProtected} onSaved={(value) => { setSaved(value); setNotice(t("visualizationSaved", { name: value.name })); }}
          onRestore={(opened) => {
            request.current?.abort(); request.current = null; generation.current++; setBusy(false); setError("");
            setSaved(opened.saved); setDraft(opened.definition);
            setFields(Object.fromEntries(opened.elements.map((field) => [field.id, field])));
            setFilterLabels(Object.fromEntries(opened.filters.map((filter) => [filter.element, filter.values])));
            setNotice(t("visualizationLoaded"));
          }} />
        <div><span className="analytics-control-label" id="analytics-visualization-label">{t("visualization")}</span>
          <div className="analytics-visualizations" role="group" aria-labelledby="analytics-visualization-label">
            {(["line", "bar", "table"] as const).map((visualization) => <button type="button" key={visualization} aria-pressed={draft.visualization === visualization}
              onClick={() => update({ visualization })}>{t(`visualization.${visualization}`)}</button>)}
          </div></div>
        <div><span className="analytics-control-label" id="analytics-metric-label">{t("metric")}</span><button className="analytics-picker-trigger" type="button" aria-labelledby="analytics-metric-label analytics-metric-value"
          aria-haspopup="dialog" onClick={() => openPicker({ purpose: "metric" })}><span id="analytics-metric-value">{metric.id === "records" ? t("records") : metric.label}</span><span aria-hidden="true">⌄</span></button></div>
        <label>{t("aggregation")}<select value={draft.aggregation} onChange={(event) => update({ aggregation: event.target.value as AnalyticsDefinition["aggregation"] })}>
          {metric.aggregations.map((aggregation) => <option key={aggregation} value={aggregation}>{t(`aggregation.${aggregation}`)}</option>)}
        </select></label>
        {metric.configured?.kind === "rule" && <label>{t("outcome")}<select value={draft.outcome ?? "pass"} onChange={(event) => update({ outcome: event.target.value as "pass" | "fail" })}>
          <option value="pass">{t("outcome.pass")}</option><option value="fail">{t("outcome.fail")}</option></select></label>}
        {draft.aggregation === "p90" && <small>{t("p90Help")}</small>}
        <small>{t(metric.kind === "numeric" ? "continuous" : "discrete")}{metric.unit && ` · ${metric.unit}`}</small>
        {metric.repeating && metric.kind === "numeric" && <label>{t("reducer")}<select value={draft.reducer ?? ""} required onChange={(event) => update({ reducer: event.target.value as AnalyticsDefinition["reducer"] })}>
          <option value="">{t("chooseValue")}</option>{(["first", "last", "minimum", "maximum"] as const).map((value) => <option key={value} value={value}>{t(`reducer.${value}`)}</option>)}
        </select></label>}
        {(metric.units.length > 1 || metric.id === "eMedications.05") && <label>{t("unit")}<select value={draft.unit ?? ""} required onChange={(event) => update({ unit: event.target.value })}>
          <option value="">{t("chooseUnit")}</option>{metric.units.map((unit) => <option key={unit}>{unit}</option>)}
        </select></label>}
        <div className="analytics-dates"><span className="analytics-control-label">{t("period")}</span>
          <label>{t("from")}<input type="date" required value={draft.from} max={draft.through} aria-invalid={invalidDates} aria-describedby={invalidDates ? "analytics-date-error" : undefined} onChange={(event) => update({ from: event.target.value })} /></label>
          <label>{t("through")}<input type="date" required value={draft.through} min={draft.from} aria-invalid={invalidDates} onChange={(event) => update({ through: event.target.value })} /></label>
          {invalidDates && <p id="analytics-date-error" role="alert">{t("dateError")}</p>}</div>
        <div><span className="analytics-control-label" id="analytics-group-label">{t("groupBy")}</span><button className="analytics-picker-trigger" type="button" aria-labelledby="analytics-group-label analytics-group-value"
          aria-haspopup="dialog" onClick={() => openPicker({ purpose: "group" })}><span id="analytics-group-value">{draft.groupBy ? fields[draft.groupBy]?.label : t("noGrouping")}</span><span aria-hidden="true">⌄</span></button></div>
        <small>{t(session.capabilities?.includes("review:all") ? "catalogAll" : "catalogOwn")}</small>
        <div className="analytics-filters"><span className="analytics-control-label">{t("filters")} · {draft.filters.length}</span>
          {draft.filters.map((filter) => <div className="analytics-filter-chip" key={filter.element}><button type="button" onClick={() => openPicker({ purpose: "filter", element: fields[filter.element] })}>
            <small>{fields[filter.element]?.label}</small>{filterLabels[filter.element]?.map((value) => value.label).join(", ") ?? filter.values.map((value) => String(value.value)).join(", ")}</button>
            <button type="button" aria-label={t("removeFilter", { element: fields[filter.element]?.label ?? filter.element })} onClick={() => update({ filters: draft.filters.filter((other) => other.element !== filter.element) })}>×</button></div>)}
          <button type="button" className="analytics-add-filter" onClick={() => openPicker({ purpose: "filter" })}>{t("addFilter")}</button></div>
      </fieldset>
      <div className="analytics-apply"><p role="status">{busy ? t("updating") : dirty ? t("unapplied") : t("applied")}</p>
        <button className="button-primary" type={busy ? "button" : "submit"} onClick={busy ? () => void apply() : undefined}
          disabled={!online || exporting || !busy && (invalidDates || !!invalidQualifier)}>{t(busy ? "cancelUpdate" : "update")}<span aria-hidden="true">{busy ? "×" : "→"}</span></button></div>
    </form>
    <section className="analytics-result" aria-label={t("result")} aria-busy={busy}>
      <header className="analytics-result-header"><div>
        <p className="analytics-caption">{result ? t(`visualization.${result.definition.visualization}`) : t("title")}{result?.group && ` · ${result.group.label}`}</p>
        <h2>{result ? `${t(`aggregation.${result.definition.aggregation}`)} · ${result.metric.id === "records" ? t("records") : result.metric.label}` : t("start")}</h2>
        {result?.metric.configured && <p className="analytics-caption">{t(`configured.${result.metric.configured.kind}`)} · {t("definitionVersion", { version: result.metric.configured.version })}{result.definition.outcome && ` · ${t(`outcome.${result.definition.outcome}`)}`}</p>}
        {result && <p className="analytics-caption">{date(result.definition.from)} – {date(result.definition.through)}{result.filters.map((filter) => ` · ${filter.element.label}: ${filter.values.map((value) => value.label).join(", ")}`)}</p>}
      </div><button ref={exportTrigger} type="button" aria-haspopup="dialog" disabled={!canExport} onClick={() => setExportOpen(true)}>{t("export")} ↓</button></header>
      {!online && <p role="alert">{t("offline")}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error} {result && t("retained")} <button type="button" disabled={busy || !online} onClick={() => void apply()}>{t("retry")}</button></p>}
      {result && (dirty || busy) && <p className="analytics-retained" role="status">{t("retained")}</p>}
      {result ? <>
        <div className="analytics-context">{result.summary !== null && <strong>{formatted(result.summary)} <small>{result.unit}</small></strong>}
          <div>{t("includedRecords", { included: formatted(result.completeness.valid) })} · {t(`scope.${result.population.scope}`)}<br />
            {t("completeness", { valid: formatted(result.completeness.valid), missing: formatted(result.completeness.missing), absent: formatted(result.completeness.absent), invalid: formatted(result.completeness.invalid) })}
            {result.metric.configured && <><br />{t("notApplicable")}: {formatted(result.completeness.notApplicable ?? 0)} · {t("failed")}: {formatted(result.completeness.failed ?? 0)}</>}</div></div>
        <AnalyticsResultView result={result} language={language} />
        <AnalyticsEvidence result={result} language={language} />
      </> : <p className="analytics-empty">{t("instructions")}</p>}
      {draft.visualization === "line" && <div className="analytics-time-grouping"><label>{t("timeGrouping")}<select value={draft.timeGrouping} disabled={!online || exporting} onChange={(event) => update({ timeGrouping: event.target.value as AnalyticsDefinition["timeGrouping"] })}>
        {(["day", "week", "month"] as const).map((value) => <option key={value} value={value}>{t(`time.${value}`)}</option>)}
      </select></label><small>{t("calendar")}</small></div>}
      {result && <footer className="analytics-result-footer"><span>{result.overlapping ? t("overlapping") : t("missingExplanation")}{result.definition.aggregation === "percentage" && ` ${t(result.metric.configured?.kind === "rule" ? "ruleDenominator" : result.metric.datatype === "records" ? "recordsDenominator" : "categoryDenominator")}`}</span>
        <span>{t("freshness", { time: new Intl.DateTimeFormat(region ?? language, { dateStyle: "short", timeStyle: "short", timeZone: result.timeZone }).format(new Date(result.freshness.observedAt)) })} · {result.timeZone}</span></footer>}
    </section>
    {picker && active && online && <AnalyticsPicker key={`${picker.purpose}:${picker.element?.id ?? "elements"}`} {...picker} definition={draft} language={language} csrfToken={csrf}
      selectedElementIds={picker.purpose === "metric" ? [draft.metric] : picker.purpose === "group" ? draft.groupBy ? [draft.groupBy] : [] : draft.filters.map((filter) => filter.element)}
      selected={picker.element ? filterLabels[picker.element.id] ?? [] : []} onElement={chooseElement} onClose={closePicker} onDenied={clearProtected}
      onValues={(values) => { const element = picker.element!; setFilterLabels((previous) => ({ ...previous, [element.id]: values }));
        update({ filters: [...draft.filters.filter((filter) => filter.element !== element.id), { element: element.id, values: values.map((value) => value.identity) }] }); closePicker(); }} />}
    <dialog className="analytics-dialog analytics-export-dialog" ref={exportDialog} aria-labelledby="analytics-export-title" onCancel={() => setExportOpen(false)}>
      <header><h2 id="analytics-export-title">{t("export")}</h2><button type="button" onClick={() => setExportOpen(false)}>{t("close")}</button></header>
      <p>{t("exportContext")}</p><button type="button" disabled={!canExport} onClick={() => void download("aggregate")}>{t("aggregateCsv")}</button>
      <button type="button" disabled={!canExport} onClick={() => void download("records")}>{t("recordsCsv")}</button>{exporting && <p role="status">{t("exporting")}</p>}
    </dialog>
  </div>;
}
