"use client";

import type { ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult,
  ReviewAnalysisReviewFilters, ReviewSavedAnalysis, ReviewSavedAnalysisOpen } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { ReviewAnalysisChart } from "./review-analysis-chart";
import { downloadReviewCsv } from "./review-csv-download";

const starters = [
  { id: "eSituation.09", label: "review.analysisComplaint" },
  { id: "eSituation.11", label: "review.analysisImpression" },
  { id: "eDisposition.30", label: "review.analysisDisposition" },
  { id: "review.duration.response", label: "review.analysisResponse" },
  { id: "review.duration.scene", label: "review.analysisScene" },
  { id: "review.duration.transport", label: "review.analysisTransport" },
] as const;

export function ReviewAnalysisBuilder({ dataset, from, to, language, refresh, csrfToken, administrator, view = "clinical" }: {
  view?: "clinical" | "saved";
  dataset: "real" | "synthetic"; from: string; to: string;
  language: AgencyLanguage; refresh: number; csrfToken: string; administrator: boolean;
}) {
  const [fields, setFields] = useState<ReviewAnalysisField[]>([]);
  const [fieldId, setFieldId] = useState("eSituation.09");
  const [operation, setOperation] = useState<ReviewAnalysisDefinition["operation"]>("distribution");
  const [reducer, setReducer] = useState<ReviewAnalysisDefinition["reducer"] | "">("");
  const [unit, setUnit] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [filterId, setFilterId] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [reviewFilters, setReviewFilters] = useState<ReviewAnalysisReviewFilters>({ criteria: [], outcomes: [] });
  const [reviewCriterionId, setReviewCriterionId] = useState("");
  const [reviewOutcomeId, setReviewOutcomeId] = useState("");
  const [analysisFrom, setAnalysisFrom] = useState(from);
  const [analysisTo, setAnalysisTo] = useState(to);
  const [saved, setSaved] = useState<ReviewSavedAnalysis[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [activeSavedId, setActiveSavedId] = useState("");
  const [savedMeta, setSavedMeta] = useState<ReviewSavedAnalysis | null>(null);
  const [savedName, setSavedName] = useState("");
  const [shareDraft, setShareDraft] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedBusy, setSavedBusy] = useState(false);
  const [openSequence, setOpenSequence] = useState(0);
  const [result, setResult] = useState<ReviewAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/analysis/review-filters?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      if (!controller.signal.aborted) setReviewFilters(await response.json() as ReviewAnalysisReviewFilters);
    }).catch(() => { if (!controller.signal.aborted) setReviewFilters({ criteria: [], outcomes: [] }); });
    return () => controller.abort();
  }, [dataset, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/analysis/saved");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      if (!controller.signal.aborted) setSaved(await response.json() as ReviewSavedAnalysis[]);
    }).catch(() => { if (!controller.signal.aborted) setSaved([]); });
    return () => controller.abort();
  }, [refresh, openSequence]);

  useEffect(() => {
    if (!activeSavedId) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/analysis/saved/${activeSavedId}?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const opened = await response.json() as ReviewSavedAnalysisOpen;
      if (controller.signal.aborted) return;
      const definition = opened.result.definition;
      setSavedMeta(opened.saved); setSavedName(opened.saved.name); setShareDraft(opened.saved.shared);
      setFieldId(definition.fieldId); setOperation(definition.operation);
      setReducer(definition.reducer ?? ""); setUnit(definition.unit ?? "");
      setGroupBy(definition.groupBy ?? ""); setFilterId(definition.filters.field?.id ?? "");
      setFilterValue(definition.filters.field?.value ?? "");
      setReviewCriterionId(definition.filters.review?.criterionId ?? "");
      setReviewOutcomeId(definition.filters.review?.outcomeOptionId ?? "");
      setAnalysisFrom(definition.filters.from); setAnalysisTo(definition.filters.to);
      setResult(opened.result); setSavedError(null); setError(null);
    }).catch((cause) => {
      if (!controller.signal.aborted) { setResult(null); setSavedMeta(null);
        setSavedError(t(cause instanceof Error && cause.message === "403" ? "review.savedAccessChanged" :
          cause instanceof Error && cause.message === "404" ? "review.savedUnavailable" :
            "review.savedDefinitionUnavailable")); }
    });
    return () => controller.abort();
  // Saved views are deliberately re-evaluated on workspace refresh and dataset changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSavedId, dataset, refresh, openSequence]);

  const field = fields.find((item) => item.id === fieldId);
  const definition = (): ReviewAnalysisDefinition => ({ fieldId, operation,
    ...(field?.repeating && field.kind === "numeric" && reducer ? { reducer } : {}),
    ...(fieldId === "eMedications.05" && unit ? { unit: unit.trim() } : {}),
    ...(groupBy ? { groupBy } : {}),
    filters: { from: analysisFrom, to: analysisTo, dataset,
      ...(filterId && filterValue ? { field: { id: filterId, value: filterValue } } : {}),
      ...(reviewCriterionId || reviewOutcomeId ? { review: {
        ...(reviewCriterionId ? { criterionId: reviewCriterionId } : {}),
        ...(reviewOutcomeId ? { outcomeOptionId: reviewOutcomeId } : {}) } } : {}) } });
  const run = async () => {
    const url = apiRequestUrl("/api/review/analysis");
    if (!url) return;
    setResult(null); setError(null); setExportNotice(null);
    const current = definition();
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(current) }));
      if (!response.ok) throw new Error(String(response.status));
      setResult(await response.json() as ReviewAnalysisResult);
    } catch { setError(t("review.analysisUnavailable")); }
  };

  const save = async (update: boolean) => {
    if (!savedName.trim() || savedBusy || (update && (!savedMeta || !savedMeta.editable))) return;
    const url = apiRequestUrl(`/api/review/analysis/saved${update ? `/${savedMeta!.id}` : ""}`);
    if (!url) return;
    setSavedBusy(true); setSavedError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ commandId: crypto.randomUUID(),
          ...(update ? { expectedVersion: savedMeta!.version } : {}),
          name: savedName.trim(), shared: administrator && shareDraft,
          definition: definition() }) }));
      if (!response.ok) throw new Error(String(response.status));
      const value = await response.json() as ReviewSavedAnalysis;
      setSavedMeta(value); setSelectedSavedId(value.id); setActiveSavedId(value.id);
      setOpenSequence((current) => current + 1);
    } catch (cause) {
      setSavedError(t(cause instanceof Error && cause.message === "409" ? "review.savedConflict" :
        cause instanceof Error && cause.message === "403" ? "review.savedAccessChanged" :
          "review.savedDefinitionUnavailable"));
    } finally { setSavedBusy(false); }
  };

  const exportCsv = async (records = false) => {
    if (!result) return;
    setExportBusy(true); setExportNotice(null);
    const outcome = await downloadReviewCsv("analysis", result, csrfToken, records);
    if (outcome.status === "refreshed") {
      setResult(outcome.result); setExportNotice(t("review.csvRefreshed"));
    } else if (outcome.status === "denied") {
      setResult(null); setExportNotice(t("review.csvDenied"));
    } else if (outcome.status === "error") setExportNotice(t("review.csvUnavailable"));
    setExportBusy(false);
  };

  return <section aria-labelledby="review-analysis-heading">
    <h2 id="review-analysis-heading">{t(view === "saved" ? "review.savedHeading" : "review.analysisHeading")}</h2>
    <p>{t("review.analysisHelp")}</p>
    <section hidden={view !== "saved"} aria-labelledby="review-saved-heading">
      <h3 id="review-saved-heading">{t("review.savedHeading")}</h3>
      <div className="review-controls">
        <label>{t("review.savedChoose")} <select value={selectedSavedId}
          onChange={(event) => setSelectedSavedId(event.target.value)}>
          <option value="">{t("review.savedChoosePlaceholder")}</option>
          {saved.map((entry) => <option key={entry.id} value={entry.id}>
            {entry.name}{entry.shared ? ` (${t("review.savedShared")})` : ""}
          </option>)}</select></label>
        <button type="button" disabled={!selectedSavedId || savedBusy}
          onClick={() => { setActiveSavedId(selectedSavedId);
            setOpenSequence((current) => current + 1); }}>{t("review.savedOpen")}</button>
      </div>
      <div className="review-controls">
        <label>{t("review.savedName")} <input value={savedName} maxLength={120}
          onChange={(event) => setSavedName(event.target.value)} /></label>
        {administrator && <label><input type="checkbox" checked={shareDraft}
          onChange={(event) => setShareDraft(event.target.checked)} />{t("review.savedPublish")}</label>}
        <button type="button" disabled={!savedName.trim() || savedBusy}
          onClick={() => void save(false)}>{t("review.savedCreate")}</button>
        <button type="button" disabled={!savedMeta?.editable || !savedName.trim() || savedBusy}
          onClick={() => void save(true)}>{t("review.savedUpdate")}</button>
      </div>
      {savedMeta && <p>{t("review.savedVersion", { version: savedMeta.version })}</p>}
      {savedError && <p role="alert">{savedError}</p>}
    </section>
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
        {fields.filter((item) => item.kind === "categorical" && item.operations.includes("distribution") &&
          (field?.source === "custom" ? item.source === "custom" || !item.repeating
            : !item.source && !item.repeating)).map((item) =>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div>
    <div className="review-controls">
      <label>{t("review.from")} <input type="date" value={analysisFrom}
        onChange={(event) => { setAnalysisFrom(event.target.value); setResult(null); }} /></label>
      <label>{t("review.to")} <input type="date" value={analysisTo}
        onChange={(event) => { setAnalysisTo(event.target.value); setResult(null); }} /></label>
      <label>{t("review.analysisFilter")}{" "}<select value={filterId} onChange={(event) => {
        setFilterId(event.target.value); setFilterValue(""); setResult(null);
      }}><option value="">{t("review.analysisAll")}</option>
        {fields.filter((item) => item.kind === "categorical" && item.operations.includes("distribution") &&
          (field?.source === "custom" ? item.source === "custom" || !item.repeating
            : !item.source)).map((item) =>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {filterId && <label>{t("review.analysisFilterValue")}{" "}<input value={filterValue}
        maxLength={256} onChange={(event) => { setFilterValue(event.target.value); setResult(null); }} /></label>}
      <label>{t("review.analysisReviewCriterion")} <select value={reviewCriterionId}
        onChange={(event) => { setReviewCriterionId(event.target.value); setResult(null); }}>
        <option value="">{t("review.analysisAll")}</option>
        {reviewFilters.criteria.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>{t("review.analysisRecordedOutcome")} <select value={reviewOutcomeId}
        onChange={(event) => { setReviewOutcomeId(event.target.value); setResult(null); }}>
        <option value="">{t("review.analysisAll")}</option>
        {reviewFilters.outcomes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <button type="button" disabled={!field || field.operations.length === 0 || analysisFrom > analysisTo || (filterId !== "" && !filterValue) ||
        (field.repeating && field.kind === "numeric" && !reducer) ||
        (fieldId === "eMedications.05" && !unit.trim())}
        onClick={() => void run()}>{t("review.analysisRun")}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {exportNotice && <p role="alert">{exportNotice}</p>}
    {result?.freshness.status === "stale" && <p role="alert">{t("review.volumeStale")}</p>}
    {result?.freshness.status === "current" && <>
      <p>{t("review.analysisReportUnit")}</p>
      {result.exportRevision && <button type="button" disabled={exportBusy}
        onClick={() => void exportCsv()}>{t("review.csvDownload")}</button>}
      {result.exportRevision && <button type="button" disabled={exportBusy}
        onClick={() => void exportCsv(true)}>{t("review.csvRecordsDownload")}</button>}
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
