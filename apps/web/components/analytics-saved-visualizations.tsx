"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AnalyticsDefinition, AnalyticsOpenedVisualization, AnalyticsSavedVisualization, AnalyticsSaveVisualizationCommand } from "@open-triage/contracts";
import { resolveErrorMessage, resolveMessage, type AgencyLanguage } from "../app/localization";
import { analyticsRequest, AnalyticsRequestError } from "./analytics-api";
import { activateListRow } from "./list-row-action";

const subscribeToDocument = () => () => {};
const documentBody = () => document.body;
const serverBody = () => null;

export function AnalyticsSavedVisualizations({ definition, saved, language, csrfToken, disabled, canSave, active, onSaved, onRestore, onDenied }: {
  definition: AnalyticsDefinition; saved: AnalyticsSavedVisualization | null; language: AgencyLanguage; csrfToken: string;
  disabled: boolean; canSave: boolean; active: boolean; onSaved: (saved: AnalyticsSavedVisualization) => void;
  onRestore: (opened: AnalyticsOpenedVisualization) => void; onDenied: () => void;
}) {
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, `analytics.${key}`, parameters);
  const [mode, setMode] = useState<"list" | "new" | "confirm" | null>(null);
  const [target, setTarget] = useState<AnalyticsSavedVisualization | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<AnalyticsSavedVisualization[]>([]);
  const [busy, setBusy] = useState(active && !disabled);
  const [error, setError] = useState("");
  const portalHost = useSyncExternalStore(subscribeToDocument, documentBody, serverBody);
  const [availability, setAvailability] = useState({ active, disabled });
  if (availability.active !== active || availability.disabled !== disabled) {
    setAvailability({ active, disabled });
    // Reset interrupted UI with the new props before committing the DOM.
    if (!active || disabled) { setMode(null); setBusy(false); }
    else setBusy(true);
  }
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const listTrigger = useRef<HTMLElement | null>(null);
  const cancelReplace = useRef<HTMLButtonElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const command = useRef<{ signature: string; value: AnalyticsSaveVisualizationCommand } | null>(null);
  const close = useCallback(() => { request.current?.abort(); request.current = null; setMode(null); setTarget(null); setError(""); setBusy(false); }, []);
  useEffect(() => {
    if (mode && active && !disabled) {
      if (!dialog.current?.open) dialog.current?.showModal();
      if (mode === "confirm") cancelReplace.current?.focus();
      else if (mode === "new") nameInput.current?.focus();
      else listTrigger.current?.focus({ preventScroll: true });
    }
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus({ preventScroll: true }); }
  }, [mode, active, disabled, portalHost]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (!active || disabled) request.current?.abort(); }, [active, disabled]);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof AnalyticsRequestError && [401, 403].includes(cause.status)) {
      setItems([]); setName(""); command.current = null; close(); onDenied(); return;
    }
    setError(cause instanceof Error ? resolveErrorMessage(language, cause.message, "analytics.savedUnavailable") : resolveMessage(language, "analytics.savedUnavailable"));
  }, [language, close, onDenied]);
  const performRequest = useCallback(<T,>(path: string, done: (value: T) => void, body?: unknown) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    return analyticsRequest<T>(path, csrfToken, controller.signal, body).then((value) => {
      if (!controller.signal.aborted) done(value);
    }).catch((cause) => { if (!controller.signal.aborted) fail(cause); })
      .finally(() => { if (request.current === controller) { request.current = null; setBusy(false); } });
  }, [csrfToken, fail]);
  useEffect(() => {
    if (active && !disabled) void performRequest<AnalyticsSavedVisualization[]>("saved", (values) => {
      setItems(values); setError("");
    });
  }, [active, disabled, performRequest]);
  function run<T>(path: string, done: (value: T) => void, body?: unknown) {
    setBusy(true); setError("");
    return performRequest(path, done, body);
  }
  function open() {
    trigger.current = document.activeElement as HTMLElement; listTrigger.current = null;
    setError(""); setMode("list");
    void run<AnalyticsSavedVisualization[]>("saved", setItems);
  }
  function save() {
    const replacing = mode === "confirm" ? target : null;
    const nextName = replacing?.name ?? name.trim();
    if (!nextName || busy || (mode !== "new" && !replacing)) return;
    const id = replacing?.id;
    const signature = JSON.stringify([id, nextName, definition, replacing?.version]);
    if (command.current?.signature !== signature) command.current = { signature, value: {
      commandId: crypto.randomUUID(), name: nextName, definition,
      ...(replacing ? { expectedVersion: replacing.version } : {}),
    } };
    void run<AnalyticsSavedVisualization>(id ? `saved/${id}` : "saved", (value) => {
      setItems((current) => [value, ...current.filter((item) => item.id !== value.id)]);
      onSaved(value); close();
    }, command.current.value);
  }
  const back = () => { setMode("list"); setTarget(null); setError(""); };
  return <div className="analytics-saved-controls">
    {/* Reset after each choice so the same saved view can be restored again. */}
    <label>{t("savedVisualizations")}<select disabled={disabled || busy} value=""
      onChange={(event) => { if (event.target.value) void run<AnalyticsOpenedVisualization>(`saved/${event.target.value}`, onRestore); }}>
      <option value="">{t("chooseVisualization")}</option>
      {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <button type="button" disabled={disabled || busy || !canSave} onClick={open}>{t("saveVisualization")}</button>
    {saved && <small>{t("loadedVisualization", { name: saved.name })}</small>}
    {!mode && busy && <p role="status">{t("savedWorking")}</p>}
    {!mode && error && <><p role="alert">{error}</p><button type="button" disabled={disabled || busy} onClick={() => void run<AnalyticsSavedVisualization[]>("saved", setItems)}>{t("retry")}</button></>}
    {portalHost && createPortal(<dialog className="analytics-dialog analytics-saved-dialog" ref={dialog} aria-labelledby="analytics-saved-title"
      aria-describedby={mode === "confirm" ? "analytics-replace-description" : "analytics-saved-description"}
      onCancel={(event) => { if (mode === "confirm" && !busy) { event.preventDefault(); back(); } else close(); }}>
      <header><h2 id="analytics-saved-title">{t(mode === "confirm" ? "confirmReplace" : mode === "new" ? "addVisualization" : "saveVisualization")}</h2>
        <button type="button" onClick={close}>{t("close")}</button></header>
      {mode !== "confirm" && <p id="analytics-saved-description">{t("personalVisualizations")}</p>}
      {mode === "new" && <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); save(); }}>
        <label>{t("visualizationName")}<input ref={nameInput} required maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <footer><button className="button-primary" type="submit" disabled={busy || !name.trim()}>{t("save")}</button>
          <button type="button" disabled={busy} onClick={back}>{t("cancel")}</button></footer>
      </form>}
      <div hidden={mode !== "list"} className="analytics-saved-list">
        <div className="analytics-picker-results"><table><caption>{t("savedVisualizations")}</caption><thead><tr><th>{t("visualizationName")}</th><th>{t("actions")}</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id} className="list-action-row" aria-selected={saved?.id === item.id} onClick={activateListRow}><td>{item.name}</td><td><button type="button" data-list-row-action disabled={busy}
            onClick={(event) => { listTrigger.current = event.currentTarget; setTarget(item); setMode("confirm"); setError(""); }}
            aria-label={t("replaceVisualization", { name: item.name })}>{t("replace")}</button></td></tr>)}</tbody></table></div>
        {!busy && !error && !items.length && <p>{t("noSavedVisualizations")}</p>}
        {error && <button type="button" disabled={busy} onClick={() => void run<AnalyticsSavedVisualization[]>("saved", setItems)}>{t("retry")}</button>}
        <footer><button type="button" disabled={busy} onClick={(event) => { listTrigger.current = event.currentTarget; setName(""); setMode("new"); setError(""); }}>{t("addVisualization")}</button></footer>
      </div>
      {mode === "confirm" && target && <>
        <p id="analytics-replace-description">{t("replaceConfirmation", { name: target.name })}</p>
        <footer><button className="button-primary" type="button" disabled={busy} onClick={save}>{t("replace")}</button>
          <button ref={cancelReplace} type="button" disabled={busy} onClick={back}>{t("cancel")}</button></footer>
      </>}
      {busy && <p role="status">{t("savedWorking")}</p>}{error && <p role="alert">{error}</p>}
    </dialog>, portalHost)}
  </div>;
}
