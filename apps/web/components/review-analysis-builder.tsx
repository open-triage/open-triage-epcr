"use client";

import type { ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { ReviewAnalysisChart } from "./review-analysis-chart";

const starters = [
  { id: "eSituation.09", label: "review.analysisComplaint" },
  { id: "eSituation.11", label: "review.analysisImpression" },
  { id: "eDisposition.30", label: "review.analysisDisposition" },
  { id: "review.duration.response", label: "review.analysisResponse" },
  { id: "review.duration.scene", label: "review.analysisScene" },
  { id: "review.duration.transport", label: "review.analysisTransport" },
] as const;

export function ReviewAnalysisBuilder({ dataset, from, to, language, refresh, csrfToken }: {
  dataset: "real" | "synthetic"; from: string; to: string;
  language: AgencyLanguage; refresh: number; csrfToken: string;
}) {
  const [fields, setFields] = useState<ReviewAnalysisField[]>([]);
  const [fieldId, setFieldId] = useState("eSituation.09");
  const [operation, setOperation] = useState<ReviewAnalysisDefinition["operation"]>("distribution");
  const [reducer, setReducer] = useState<ReviewAnalysisDefinition["reducer"] | "">("");
  const [unit, setUnit] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [filterId, setFilterId] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [result, setResult] = useState<ReviewAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);

  useEffect(() => {
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/analysis/fields");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      if (!controller.signal.aborted) setFields(await response.json() as ReviewAnalysisField[]);
    }).catch(() => { if (!controller.signal.aborted) setError(t("review.analysisUnavailable")); });
    return () => controller.abort();
  // The metadata is reloaded on explicit refresh; dataset does not alter the field policy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const field = fields.find((item) => item.id === fieldId);
  const run = async () => {
    const url = apiRequestUrl("/api/review/analysis");
    if (!url) return;
    setResult(null); setError(null);
    const definition: ReviewAnalysisDefinition = { fieldId, operation,
      ...(field?.repeating && field.kind === "numeric" && reducer ? { reducer } : {}),
      ...(fieldId === "eMedications.05" && unit ? { unit: unit.trim() } : {}),
      ...(groupBy ? { groupBy } : {}),
      filters: { from, to, dataset,
        ...(filterId && filterValue ? { field: { id: filterId, value: filterValue } } : {}) } };
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(definition) }));
      if (!response.ok) throw new Error(String(response.status));
      setResult(await response.json() as ReviewAnalysisResult);
    } catch { setError(t("review.analysisUnavailable")); }
  };

  return <section aria-labelledby="review-analysis-heading">
    <h2 id="review-analysis-heading">{t("review.analysisHeading")}</h2>
    <p>{t("review.analysisHelp")}</p>
    <div className="review-controls">{starters.map((starter) =>
      <button key={starter.id} type="button" disabled={!fields.some((item) => item.id === starter.id)}
        onClick={() => { const next = fields.find((item) => item.id === starter.id);
          setFieldId(starter.id); setOperation(next?.operations[0] ?? "distribution");
          setReducer(""); setUnit(""); setGroupBy(""); setFilterId(""); setFilterValue(""); setResult(null); }}>
        {t(starter.label)}
      </button>)}</div>
    <div className="review-controls">
      <label>{t("review.analysisField")}{" "}<select value={fieldId} onChange={(event) => {
        const next = fields.find((item) => item.id === event.target.value);
        setFieldId(event.target.value); setOperation(next?.operations[0] ?? "distribution");
        setReducer(""); setUnit(""); setGroupBy(""); setFilterId(""); setFilterValue(""); setResult(null);
      }}>{fields.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}</select></label>
      {field?.unsupportedReason && <p role="note">{t("review.analysisUnsupportedCustom")}</p>}
      {field?.interval && <p role="note">{t("review.analysisInterval", {
        start: field.interval.start, end: field.interval.end, unit: field.unit ?? "min" })} {t("review.analysisIntervalPolicy")}</p>}
      <label>{t("review.analysisOperation")}{" "}<select value={operation} onChange={(event) => {
        setOperation(event.target.value as ReviewAnalysisDefinition["operation"]); setResult(null);
      }}>{field?.operations.map((item) => <option key={item} value={item}>{t(`review.analysis.${item}`)}</option>)}</select></label>
      {field?.repeating && field.kind === "numeric" && <label>{t("review.analysisReducer")}{" "}
        <select value={reducer} onChange={(event) => { setReducer(event.target.value as ReviewAnalysisDefinition["reducer"]); setResult(null); }}>
          <option value="">{t("review.analysisChooseReducer")}</option>
          {(["first", "last", "minimum", "maximum"] as const).map((item) =>
            <option key={item} value={item}>{t(`review.analysis.reducer.${item}`)}</option>)}
        </select></label>}
      {fieldId === "eMedications.05" && <label>{t("review.analysisUnit")}{" "}
        <input value={unit} maxLength={40} onChange={(event) => { setUnit(event.target.value); setResult(null); }} /></label>}
      <label>{t("review.analysisGroup")}{" "}<select value={groupBy} onChange={(event) => {
        setGroupBy(event.target.value); setResult(null);
      }}><option value="">{t("review.analysisAll")}</option>
        {fields.filter((item) => item.kind === "categorical" && !item.repeating && !item.source && field?.source !== "custom").map((item) =>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div>
    <div className="review-controls">
      <label>{t("review.analysisFilter")}{" "}<select value={filterId} onChange={(event) => {
        setFilterId(event.target.value); setFilterValue(""); setResult(null);
      }}><option value="">{t("review.analysisAll")}</option>
        {fields.filter((item) => item.kind === "categorical" && !item.source && field?.source !== "custom").map((item) =>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {filterId && <label>{t("review.analysisFilterValue")}{" "}<input value={filterValue}
        maxLength={256} onChange={(event) => { setFilterValue(event.target.value); setResult(null); }} /></label>}
      <button type="button" disabled={!field || field.operations.length === 0 || from > to || (filterId !== "" && !filterValue) ||
        (field.repeating && field.kind === "numeric" && !reducer) ||
        (fieldId === "eMedications.05" && !unit.trim())}
        onClick={() => void run()}>{t("review.analysisRun")}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {result?.freshness.status === "stale" && <p role="alert">{t("review.volumeStale")}</p>}
    {result?.freshness.status === "current" && <>
      <p>{t("review.analysisScope", { scope: t(`review.scope.${result.population.scope}`) })}{" · "}
        {t("review.volumeFresh", { time: new Intl.DateTimeFormat(language, {
          dateStyle: "medium", timeStyle: "short" }).format(new Date(result.freshness.observedAt)) })}</p>
      {result.groups.length === 0 && <p>{t("review.analysisEmpty")}</p>}
      {result.field.repeating && result.field.kind === "categorical" &&
        <p>{t("review.analysisMultiCategory")}</p>}
      {result.definition.reducer && <p>{t("review.analysisReducerContext", {
        reducer: t(`review.analysis.reducer.${result.definition.reducer}`) })}{" "}
        {t("review.analysisOrderContext")}</p>}
      {result.groups.map((group, index) => <section key={`${group.group ?? "all"}-${index}`}>
        {result.definition.groupBy && <h3>{group.group ?? t("review.analysisMissingGroup")}</h3>}
        <p>{t("review.analysisDenominator", { count: group.denominator })}{" · "}
          {t("review.analysisMissing", { count: group.missing })}{" · "}
          {t("review.analysisAbsent", { count: group.absent })}
          {group.invalid !== undefined && <> {" · "}{t("review.analysisInvalid", { count: group.invalid })}</>}</p>
        {result.definition.operation === "distribution" ? <>
          <ReviewAnalysisChart values={group.values} title={t("review.analysisChart")} />
          <table><caption>{result.field.label}</caption><thead><tr>
            <th>{t("review.analysisValue")}</th><th>{t("review.volumeCount")}</th>
            <th>{t("review.analysisPercent")}</th></tr></thead><tbody>
            {group.values.map((item) => <tr key={item.value ?? "missing"}><td>{item.value ?? "—"}</td>
              <td>{item.count}</td><td>{item.percentage.toFixed(1)}%</td></tr>)}
          </tbody></table>
        </> : <p>{t(`review.analysis.${result.definition.operation}`)}: {group.summary ?? "—"}
          {result.field.unit ? ` ${result.field.unit}` : ""}</p>}
      </section>)}
    </>}
  </section>;
}
