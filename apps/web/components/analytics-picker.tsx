"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AnalyticsCatalogCounts, AnalyticsCatalogCountsRequest, AnalyticsCatalogPage, AnalyticsCatalogValue, AnalyticsDefinition, AnalyticsElement } from "@open-triage/contracts";
import { resolveMessage, resolveErrorMessage, type AgencyLanguage } from "../app/localization";
import { useRegionalFormat } from "../app/regional-format";
import { AnalyticsRequestError, analyticsRequest } from "./analytics-api";
import { useDebouncedValue } from "./use-debounced-value";
import { activateListRow } from "./list-row-action";

export function AnalyticsPicker({ purpose, element, selected, selectedElementIds, definition, language, csrfToken, onElement, onValues, onClose, onDenied }: {
  purpose: "metric" | "group" | "filter"; element?: AnalyticsElement; selected: AnalyticsCatalogValue[]; selectedElementIds: string[];
  definition: AnalyticsDefinition;
  language: AgencyLanguage; csrfToken: string; onElement: (element: AnalyticsElement | null) => void;
  onValues: (values: AnalyticsCatalogValue[]) => void; onClose: () => void; onDenied: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AnalyticsCatalogPage<AnalyticsElement | AnalyticsCatalogValue> | null>(null);
  const [choices, setChoices] = useState(selected);
  const [settled, setSettled] = useState("");
  const [failure, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [countRetry, setCountRetry] = useState(0);
  const [countState, setCountState] = useState<{ signature: string; data?: AnalyticsCatalogCounts; error?: string }>();
  const region = useRegionalFormat();
  const requestKey = JSON.stringify([element?.id, purpose, search, page, retry, csrfToken]);
  const busy = settled !== requestKey;
  const countRequest: AnalyticsCatalogCountsRequest | null = data && !busy && !failure ? { definition, selection: element ? {
    purpose: "values", element: element.id, values: data.items.flatMap((item) => "identity" in item ? [item.identity] : []),
  } : { purpose, ids: data.items.flatMap((item) => "id" in item ? [item.id] : []) } } : null;
  const countSignature = JSON.stringify([countRequest, csrfToken, countRetry]);
  const counts = countState?.signature === countSignature ? countState.data : undefined;
  const countError = countState?.signature === countSignature ? countState.error : undefined;
  const error = busy ? "" : failure;
  const metricPicker = purpose === "metric" && !element;
  const t = (key: string, values?: Record<string, string | number>) => resolveMessage(language, `analytics.${key}`, values);
  const countLabel = (included: number | undefined) => !counts && !countError ? "…" : included === undefined ? t("unavailableValue") :
    new Intl.NumberFormat(region ?? language).format(included);
  const elementRow = (item: AnalyticsElement | null, label: string) => {
    const disabled = busy || !!error || !!item && !(purpose === "group" ? item.grouping : purpose === "filter" ? item.filtering : item.aggregations.length);
    const select = () => { if (!disabled) onElement(item); };
    return { tabIndex: disabled ? -1 : 0, "aria-disabled": disabled, "aria-label": `${t("select")} ${label}`,
      onClick: (event: MouseEvent<HTMLTableRowElement>) => activateListRow(event, select),
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(); }
      } };
  };
  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    modal?.querySelector("input")?.focus();
    return () => modal?.close();
  }, []);
  useEffect(() => {
    if (search !== debouncedSearch) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ search, page: String(page), ...(element ? { element: element.id } : { purpose }) });
    void analyticsRequest<AnalyticsCatalogPage<AnalyticsElement | AnalyticsCatalogValue>>(`${element ? "values" : "elements"}?${query}`, csrfToken, controller.signal)
      .then((next) => { if (!controller.signal.aborted) { setData(next); setError(""); setSettled(requestKey); } })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof AnalyticsRequestError && [401, 403].includes(cause.status)) { onDenied(); return; }
        setSettled(requestKey); setError(cause instanceof Error ? cause.message : "");
      });
    return () => controller.abort();
  }, [csrfToken, element, page, purpose, retry, search, debouncedSearch, onDenied, requestKey]);
  useEffect(() => {
    const [body] = JSON.parse(countSignature) as [AnalyticsCatalogCountsRequest | null];
    if (!body) return;
    const controller = new AbortController();
    void analyticsRequest<AnalyticsCatalogCounts>("counts", csrfToken, controller.signal, body)
      .then((data) => { if (!controller.signal.aborted) setCountState({ signature: countSignature, data }); })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof AnalyticsRequestError && [401, 403].includes(cause.status)) { onDenied(); return; }
        setCountState({ signature: countSignature, error: cause instanceof Error ? cause.message : "analytics.unavailable" });
      });
    return () => controller.abort();
  }, [countSignature, csrfToken, onDenied]);
  return <dialog className="analytics-dialog" ref={dialog} aria-labelledby="analytics-picker-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id="analytics-picker-title">{element ? element.label : t(`pick.${purpose}`)}</h2><button type="button" onClick={onClose}>{t("close")}</button></header>
    <label>{t("search")}<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
    <p>{t(metricPicker ? "configuredCatalog" : data?.scope === "own" ? "catalogOwn" : "catalogAll")}</p>
    <p className="analytics-caption">{t("countContext")}</p>
    {countError && <p role="alert">{t("countsUnavailable")} {resolveErrorMessage(language, countError, "analytics.unavailable")} <button type="button" onClick={() => setCountRetry((value) => value + 1)}>{t("retry")}</button></p>}
    {error && <p role="alert">{resolveErrorMessage(language, error, "analytics.unavailable")} <button type="button" onClick={() => setRetry((value) => value + 1)}>{t("retry")}</button></p>}
    {busy && <p role="status">{t(metricPicker ? "loadingMetrics" : "loading")}</p>}
    <div className="analytics-picker-results" aria-busy={busy}>
      <table><thead><tr><th scope="col">{t(element ? "value" : metricPicker ? "metric" : "element")}</th><th scope="col">{t("includedCount")}</th></tr></thead><tbody>
        {!element && purpose === "group" && <tr className="list-action-row" aria-selected={!selectedElementIds.length} {...elementRow(null, t("noGrouping"))}>
          <td>{!selectedElementIds.length && <span aria-hidden="true">✓ </span>}{t("noGrouping")}</td><td>{countLabel(counts?.included)}</td>
        </tr>}
        {data?.items.map((item) => {
          if ("identity" in item) {
            const identity = JSON.stringify(item.identity);
            const checked = choices.some((choice) => JSON.stringify(choice.identity) === identity);
            return <tr key={identity} className="list-action-row" aria-selected={checked} onClick={activateListRow}>
              <td><label><input type="checkbox" data-list-row-action checked={checked}
                disabled={busy || !!error} onChange={(event) => setChoices((previous) => event.target.checked ? [...previous, item] :
                  previous.filter((choice) => JSON.stringify(choice.identity) !== identity))} />{item.label}</label><small>{String(item.identity.value)}</small></td>
              <td>{countLabel(counts?.values.find((entry) => entry.identity.type === item.identity.type && entry.identity.value === item.identity.value)?.included)}</td>
            </tr>;
          }
          const isSelected = selectedElementIds.includes(item.id);
          const label = item.datatype === "records" ? t("records") : item.label;
          return <tr key={item.id} className="list-action-row" aria-selected={isSelected} {...elementRow(item, label)}>
            <td>{isSelected && <span aria-hidden="true">✓ </span>}{label}<small>{item.configured ? `${t(`configured.${item.configured.kind}`)} · ${t("definitionVersion", { version: item.configured.version })}` : item.id}</small>{item.unsupportedReason && <small>{t("unsupported")}</small>}</td>
            <td>{countLabel(counts?.elements.find((entry) => entry.id === item.id)?.included)}</td>
          </tr>;
        })}
      </tbody></table>
      {!busy && !error && data?.total === 0 && <p>{t(metricPicker ? "noMatchingMetrics" : search ? "noMatches" : "noObserved")}</p>}
    </div>
    <footer><button type="button" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>{t("previous")}</button>
      <span>{t("page", { page, total: Math.max(1, Math.ceil((data?.total ?? 0) / 50)) })}</span>
      <button type="button" disabled={page * 50 >= (data?.total ?? 0) || busy} onClick={() => setPage(page + 1)}>{t("next")}</button>
      {element && <button className="button-primary" type="button" disabled={!choices.length || busy || !!error} onClick={() => onValues(choices)}>{t("applyValues", { count: choices.length })}</button>}
    </footer>
  </dialog>;
}
