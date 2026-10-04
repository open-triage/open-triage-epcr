"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { compileMetric, type MetricSource, type ValidationCatalog, type ValidationDraft } from "@open-triage/contracts";
import { useAdminText } from "../app/admin-localization";
import { activateListRow } from "./list-row-action";

export function MetricLibrary({ draft, catalog, canWrite, busy, onChange, assistance }: {
  draft: ValidationDraft; catalog: ValidationCatalog | null; canWrite: boolean; busy: boolean;
  onChange: (metrics: MetricSource[]) => void; assistance: ReactNode;
}) {
  const t = useAdminText();
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [wording, setWording] = useState<"en" | "sv">("en");
  const editor = useRef<HTMLFieldSetElement>(null);
  const metrics = draft.metrics ?? [];
  const selected = metrics.find((metric) => metric.id === selectedId) ?? metrics[0];
  const compiled = useMemo(() => new Map((draft.metrics ?? []).map((metric) => [metric.id,
    catalog ? compileMetric(metric, draft.id, catalog) : { diagnostics: [] }])), [draft.metrics, draft.id, catalog]);
  const validation = selected ? compiled.get(selected.id) : undefined;
  const dependents = selected ? draft.rules.filter((rule) => rule.source.includes(JSON.stringify(selected.id))) : [];
  const name = (metric: MetricSource) => wording === "sv" ? metric.localization?.sv?.name || metric.name : metric.name;
  function change(update: Partial<MetricSource>) {
    if (selected) onChange(metrics.map((metric) => metric.id === selected.id ? { ...metric, ...update } : metric));
  }
  const field = (key: "name" | "description", value: string) => change(wording === "en" ? { [key]: value } : {
    localization: { schemaVersion: 1, sv: { ...selected?.localization?.sv, [key]: value } } });
  return <section className="validation-library metric-library" aria-labelledby="metric-library-heading">
    <h3 id="metric-library-heading">{t("metrics.library")}</h3>
    <p>{t("metrics.sharedVersion")}</p>
    <label className="validation-rule-row">{t("metrics.search")}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="validation-rule-table-scroll" tabIndex={0} role="region" aria-label={t("metrics.library")}>
      <table className="metric-library-table"><thead><tr><th>{t("metrics.name")}</th><th>{t("metrics.unit")}</th><th>{t("metrics.review")}</th>
        <th>{t("admin.state")}</th><th>{t("admin.validity")}</th><th>{t("metrics.actions")}</th></tr></thead>
        <tbody>{metrics.filter((metric) => `${metric.id} ${metric.name} ${metric.localization?.sv?.name ?? ""}`.toLowerCase().includes(search.toLowerCase())).map((metric) =>
          <tr key={metric.id} className={selected?.id === metric.id ? "is-selected" : undefined} onClick={activateListRow}>
            <th scope="row">{name(metric)}<small>{metric.id}</small></th><td>{metric.unit}</td><td>{t(metric.reviewEnabled ? "admin.enabled" : "admin.disabled")}</td>
            <td>{t(metric.enabled ? "admin.enabled" : "admin.disabled")}</td>
            <td>{t(compiled.get(metric.id)?.compiled ? "admin.valid" : "admin.invalid")}</td>
            <td><button type="button" data-list-row-action aria-label={`${t(canWrite ? "admin.edit" : "admin.viewDetails")}: ${name(metric)}`}
              onClick={() => { setSelectedId(metric.id); requestAnimationFrame(() => editor.current?.focus()); }}>{t(canWrite ? "admin.edit" : "admin.viewDetails")}</button></td>
          </tr>)}</tbody></table>
    </div>
    {metrics.length === 0 && <p>{t("metrics.empty")}</p>}
    {canWrite && <div className="form-actions"><button type="button" disabled={busy} onClick={() => {
      const id = crypto.randomUUID();
      onChange([...metrics, { id, name: t("metrics.newName"), description: "", enabled: false, reviewEnabled: false, unit: "s",
        source: JSON.stringify({ operator: "elapsed", start: { operator: "timestamp", elementId: "eTimes.01" },
          end: { operator: "timestamp", elementId: "eTimes.07" }, unit: "s" }, null, 2) }]);
      setSelectedId(id); requestAnimationFrame(() => editor.current?.focus());
    }}>{t("metrics.create")}</button></div>}
    {selected && <fieldset ref={editor} tabIndex={-1} className="validation-rule-editor" disabled={!canWrite || busy} aria-describedby="metric-diagnostics">
      <legend>{t("metrics.editor")}</legend>
      <label className="validation-rule-row">{t("admin.wordingLanguage")}<select value={wording} onChange={(event) => setWording(event.target.value as "en" | "sv")}>
        <option value="en">English</option><option value="sv">Svenska</option></select></label>
      <label className="validation-rule-row">{t("metrics.name")}<input value={wording === "en" ? selected.name : selected.localization?.sv?.name ?? ""} onChange={(event) => field("name", event.target.value)} /></label>
      <div className="validation-rule-row"><label htmlFor="metric-description">{t("metrics.description")}</label><textarea id="metric-description" rows={3} value={wording === "en" ? selected.description : selected.localization?.sv?.description ?? ""} onChange={(event) => field("description", event.target.value)} /></div>
      <label className="validation-rule-row">{t("metrics.unit")}<input value={selected.unit} onChange={(event) => change({ unit: event.target.value })} /></label>
      <label className="validation-rule-row">{t("admin.enabled")}<input type="checkbox" checked={selected.enabled} onChange={(event) => change({ enabled: event.target.checked })} /></label>
      <label className="validation-rule-row">{t("metrics.review")}<input type="checkbox" checked={selected.reviewEnabled} onChange={(event) => change({ reviewEnabled: event.target.checked })} /></label>
      <div className="validation-rule-row"><label htmlFor="metric-applicability">{t("metrics.applicability")}</label><textarea id="metric-applicability" rows={3} value={selected.applicability ?? ""} onChange={(event) => change({ applicability: event.target.value })} /></div>
      <div className="validation-rule-row"><label htmlFor="metric-expression">{t("metrics.expression")}</label><textarea id="metric-expression" rows={12} spellCheck={false} aria-invalid={validation?.diagnostics.some((item) => item.severity === "error") || undefined}
        aria-describedby="metric-expression-help metric-diagnostics" value={selected.source} onChange={(event) => change({ source: event.target.value })} /></div>
      <p id="metric-expression-help">{t("metrics.expressionHelp")}</p>
      {assistance}
      {(selected.unresolved?.length ?? 0) > 0 && <div className="validation-rule-row"><label htmlFor="metric-unresolved">{t("metrics.unresolved")}</label><textarea id="metric-unresolved" rows={4}
        value={selected.unresolved!.join("\n")} onChange={(event) => change({ unresolved: event.target.value.split("\n").filter((line) => line.trim()) })} /></div>}
      <div id="metric-diagnostics" role="status">{validation?.diagnostics.length ? <ul>{validation.diagnostics.map((item, index) => <li key={index}>{item.message}</li>)}</ul> : t("metrics.valid")}</div>
      {validation?.compiled && <p>{validation.compiled.explanation}</p>}
      <p>{t("metrics.dependents")}: {dependents.length ? dependents.map((rule) => `${rule.name} (${rule.enabled ? t("admin.enabled") : t("admin.disabled")})`).join(", ") : t("admin.none")}</p>
      {!!selected.provenance?.length && <details><summary>{t("metrics.provenance")}</summary>{selected.provenance.map((source, index) => <p key={index}>{source.subject} · {source.sourceRelease} · {source.context}<br />{source.originalMessage}<br /><code>{source.originalExpression}</code></p>)}</details>}
    </fieldset>}
  </section>;
}
