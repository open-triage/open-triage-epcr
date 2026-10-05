"use client";

import type { ClinicianSession, ReviewCriterionRoute, ReviewEligibleReviewer, ReviewOutcomeOption, ReviewAmendmentPolicy } from "@open-triage/contracts";
import { useEffect, useRef, useState } from "react";
import { useUnsavedChanges, confirmDiscardChanges } from "./unsaved-changes";
import { FieldHelp } from "./field-help";
import { useVisiblePolling } from "./use-visible-polling";
import { useAvailableHeight } from "./use-available-height";
import { listAccessRemoved } from "../app/list-refresh";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export type ReviewSettingsSection = "routing" | "backlog";

export function ReviewSettingsPanel({ session, language, online, section, active }: {
  session: ClinicianSession;
  language: AgencyLanguage;
  online: boolean;
  active: boolean;
  section?: ReviewSettingsSection;
}) {
  const administrator = session.capabilities?.includes("review:admin") ?? false;
  const dataset = session.capabilities?.includes("clinical:demo") ? "synthetic" : "real";
  const [refresh, setRefresh] = useState(0);
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);
  const [backlog, setBacklog] = useState<Array<{ reportId: string; state: string; attempts: number; lastError: string | null }> | null>(null);
  const [backlogError, setBacklogError] = useState(false);
  const [outcomesError, setOutcomesError] = useState(false);

  const [routes, setRoutes] = useState<ReviewCriterionRoute[] | null>(null);
  const [reviewers, setReviewers] = useState<ReviewEligibleReviewer[]>([]);
  const [routingError, setRoutingError] = useState(false);
  const [routingLoading, setRoutingLoading] = useState(true);
  const [savingRoutes, setSavingRoutes] = useState<Record<string, boolean>>({});
  const pendingRoutes = useRef(new Set<string>());
  const routingPanel = useAvailableHeight<HTMLDivElement>();
  const [routeDrafts, setRouteDrafts] = useState<Record<string, { route: ReviewCriterionRoute["route"];
    namedUserId: string | null; independentReview: boolean }>>({});

  const [outcomes, setOutcomes] = useState<ReviewOutcomeOption[]>([]);
  const [amendmentPolicy, setAmendmentPolicy] = useState<ReviewAmendmentPolicy | null>(null);
  const clearanceDirty = useRef(false);
  const deadlineDirty = useRef(false);
  const latestClearance = useRef<ReviewAmendmentPolicy | null>(null);
  const latestDeadline = useRef<{ deadlineHours: number; version: number } | null>(null);
  const [policyBusy, setPolicyBusy] = useState<"clearance" | "deadline" | null>(null);
  const [deadlineMessage, setDeadlineMessage] = useState<string | null>(null);
  const [clearanceDraft, setClearanceDraft] = useState<ReviewAmendmentPolicy["clearance"]>("confirm");
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [outcomeId, setOutcomeId] = useState("");
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);

  const [outcomeLabel, setOutcomeLabel] = useState("");
  const [outcomeMeaning, setOutcomeMeaning] = useState("");
  const [outcomeActive, setOutcomeActive] = useState(true);

  const [workflowError, setWorkflowError] = useState<"conflict" | "unavailable" | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);

  const [overduePolicy, setOverduePolicy] = useState<{ deadlineHours: number; version: number } | null>(null);
  const [deadlineHours, setDeadlineHours] = useState(24);

  const outcomeBaseline = outcomes.find((option) => option.id === outcomeId);
  const outcomeDirty = outcomeLabel !== (outcomeBaseline?.label ?? "") || outcomeMeaning !== (outcomeBaseline?.meaning ?? "") || outcomeActive !== (outcomeBaseline?.active ?? true);
  useUnsavedChanges(Object.keys(routeDrafts).length > 0 || outcomeDirty ||
    (!!amendmentPolicy && clearanceDraft !== amendmentPolicy.clearance) || (!!overduePolicy && deadlineHours !== overduePolicy.deadlineHours));

  useEffect(() => {
    if (!active || !online || !administrator) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/backlog?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const value = await response.json() as { work: typeof backlog };
      if (!controller.signal.aborted) { setBacklog(value.work); setBacklogError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setBacklog(null);
      setBacklogError(true);
    } });
    return () => controller.abort();
  }, [active, dataset, online, refresh, administrator]);

  useEffect(() => {
    if (!active || !online || !administrator) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/overdue-policy");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const value = await response.json() as { deadlineHours: number; version: number };
      if (!controller.signal.aborted) {
        latestDeadline.current = value;
        if (!deadlineDirty.current) { setOverduePolicy(value); setDeadlineHours(value.deadlineHours); }
      }
    }).catch(() => { if (!controller.signal.aborted) setOverduePolicy((previous) => deadlineDirty.current ? previous : null); });
    return () => controller.abort();
  }, [active, online, refresh, administrator]);

  useEffect(() => {
    if (!active || !online || !administrator) return;
    const controller = new AbortController();
    const routeUrl = apiRequestUrl("/api/review/routes");
    const reviewersUrl = apiRequestUrl("/api/review/eligible-reviewers");
    if (!routeUrl || !reviewersUrl) return;
    void Promise.all([fetch(routeUrl, browserRequestInit({ signal: controller.signal })),
      fetch(reviewersUrl, browserRequestInit({ signal: controller.signal }))]).then(async ([routeResponse, reviewerResponse]) => {
      if (!routeResponse.ok || !reviewerResponse.ok) throw new Error(String(!routeResponse.ok ? routeResponse.status : reviewerResponse.status));
      const [configured, eligible] = await Promise.all([
        routeResponse.json() as Promise<ReviewCriterionRoute[]>,
        reviewerResponse.json() as Promise<ReviewEligibleReviewer[]>]);
      if (!controller.signal.aborted) { setRoutes(configured); setReviewers(eligible); setRoutingError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) { setRoutes(null); setReviewers([]); }
      setRoutingError(true);
    } })
      .finally(() => { if (!controller.signal.aborted) setRoutingLoading(false); });
    return () => controller.abort();
  }, [active, online, refresh, administrator]);

  useEffect(() => {
    if (!active || !online || !administrator) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/amendment-policy");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const policy = await response.json() as ReviewAmendmentPolicy;
      if (!controller.signal.aborted) {
        latestClearance.current = policy;
        if (!clearanceDirty.current) { setAmendmentPolicy(policy); setClearanceDraft(policy.clearance); }
      }
    }).catch(() => { if (!controller.signal.aborted) setAmendmentPolicy((previous) => clearanceDirty.current ? previous : null); });
    return () => controller.abort();
  }, [active, online, refresh, administrator]);

  useEffect(() => {
    if (!active || !online || !administrator) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/outcomes");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewOutcomeOption[];
      if (!controller.signal.aborted) { setOutcomes(next); setOutcomesError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setOutcomes([]);
      setOutcomesError(true);
    } });
    return () => controller.abort();
  }, [active, online, refresh, administrator]);

  async function saveRoute(route: ReviewCriterionRoute) {
    if (routingError || pendingRoutes.current.has(route.criterionId)) return;
    const submittedDraft = routeDrafts[route.criterionId];
    const draft = submittedDraft ?? { route: route.route, namedUserId: route.namedUserId,
      independentReview: route.independentReview };
    const url = apiRequestUrl(`/api/review/routes/${route.criterionId}`);
    if (!url) return;
    pendingRoutes.current.add(route.criterionId);
    setSavingRoutes((previous) => ({ ...previous, [route.criterionId]: true }));
    setAssignmentMessage(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: route.version,
          route: draft.route, namedUserId: draft.route === "named" ? draft.namedUserId : null,
          independentReview: draft.independentReview }) }));
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewCriterionRoute;
      setRoutes((previous) => previous?.map((entry) => entry.criterionId === next.criterionId ? next : entry) ?? null);
      setRouteDrafts((previous) => {
        if (previous[route.criterionId] !== submittedDraft) return previous;
        const updated = { ...previous }; delete updated[route.criterionId]; return updated;
      });
      setAssignmentMessage(t("review.routingSaved"));
    } catch { setAssignmentMessage(t("review.assignmentChanged")); setRefresh((value) => value + 1); }
    finally {
      pendingRoutes.current.delete(route.criterionId);
      setSavingRoutes((previous) => { const updated = { ...previous }; delete updated[route.criterionId]; return updated; });
    }
  }

  async function saveAmendmentPolicy() {
    if (!amendmentPolicy || clearanceDraft === amendmentPolicy.clearance || policyBusy) return;
    const url = apiRequestUrl("/api/review/amendment-policy");
    if (!url) return;
    setPolicyMessage(t("settings.saving")); setPolicyBusy("clearance");
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: amendmentPolicy.version,
          clearance: clearanceDraft }) }));
      if (!response.ok) throw new Error(String(response.status));
      const updated = await response.json() as ReviewAmendmentPolicy;
      clearanceDirty.current = false; latestClearance.current = updated;
      setAmendmentPolicy(updated); setClearanceDraft(updated.clearance);
      setPolicyMessage(t("review.clearanceSaved"));
    } catch { setPolicyMessage(t("review.clearanceConflict")); setRefresh((value) => value + 1); }
    finally { setPolicyBusy(null); }
  }

  async function saveOutcome() {
    const url = apiRequestUrl("/api/review/outcomes");
    if (!url || workflowBusy) return;
    const current = outcomes.find((option) => option.id === outcomeId);
    setWorkflowBusy(true); setWorkflowError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(),
          ...(current ? { optionId: current.id, expectedRevision: current.revision } : {}),
          label: outcomeLabel, meaning: outcomeMeaning, active: outcomeActive }) }));
      if (response.status === 409) { setWorkflowError("conflict"); setRefresh((value) => value + 1); return; }
      if (!response.ok) throw new Error(String(response.status));
      setOutcomeId(""); setOutcomeLabel(""); setOutcomeMeaning(""); setOutcomeActive(true);
      setRefresh((value) => value + 1);
    } catch { setWorkflowError("unavailable"); }
    finally { setWorkflowBusy(false); }
  }

  async function saveOverduePolicy() {
    if (policyBusy || !overduePolicy || !Number.isInteger(deadlineHours) || deadlineHours < 1 || deadlineHours > 720) return;
    const url = apiRequestUrl("/api/review/overdue-policy");
    if (!url) return;
    setPolicyBusy("deadline"); setDeadlineMessage(t("settings.saving"));
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: overduePolicy.version,
          deadlineHours }) }));
      if (!response.ok) throw new Error(String(response.status));
      const updated = await response.json() as { deadlineHours: number; version: number };
      deadlineDirty.current = false; latestDeadline.current = updated;
      setOverduePolicy(updated); setDeadlineHours(updated.deadlineHours);
      setDeadlineMessage(t("review.policySaved"));
    } catch { setDeadlineMessage(t("review.policyConflict")); setRefresh((value) => value + 1); }
    finally { setPolicyBusy(null); }
  }

  useVisiblePolling(() => setRefresh((value) => value + 1), 15_000,
    active && online && administrator, "", false);

  useEffect(() => {
    if (!section || !active || !online) return;
    const heading = document.getElementById(section === "routing" ? "review-routing-heading" : "review-backlog-heading");
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [section, active, online]);

  if (!session.capabilities?.includes("review:admin")) return null;
  return <section className="review-workspace review-settings-workspace review-settings-card" aria-labelledby="review-settings-heading">
    <h2 id="review-settings-heading">{t("navigation.reviewSettings")}</h2>
    {!online ? <p role="status">{t("review.offline")}</p> : <>
      <section aria-labelledby="review-routing-heading">
        <h2 id="review-routing-heading" tabIndex={-1}>{t("review.routingHeading")}</h2>
        <p>{t("review.routingHelp")}</p>
        {assignmentMessage && <p role="status">{assignmentMessage}</p>}
        {routingError && routes !== null && <p role="alert">{t("review.routingRefreshFailed")}</p>}
        {routingError && <button type="button" disabled={routingLoading} onClick={() => {
          setRoutingLoading(true); setRefresh((value) => value + 1);
        }}>
          {t("review.retryRouting")}</button>}
        {routes === null ? <p role="status">{t(routingError ? "review.routingUnavailable" : "admin.loading")}</p> :
          routes.length === 0 ? <p>{t("review.noRoutes")}</p> : <div ref={routingPanel} className="review-table-scroll review-routing-scroll"
            tabIndex={0} role="region" aria-labelledby="review-routing-heading">
            <table className="review-routing-table" aria-labelledby="review-routing-heading">
              <thead><tr>{["review.routingCriterion", "review.routeMode", "review.independentReview", "admin.actions"].map((key) =>
                <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
              <tbody>{routes.map((route) => {
            const draft = routeDrafts[route.criterionId] ?? { route: route.route, namedUserId: route.namedUserId,
              independentReview: route.independentReview };
            return <tr key={route.criterionId}>
              <th scope="row"><FieldHelp className="review-routing-criterion" label={route.name}
                text={route.recoveryReason ? t("review.routeRecovered") : ""} />
                {route.recoveryReason && <span className="review-sr-only" role="alert">{t("review.routeRecovered")}</span>}
              </th>
              <td><label><span className="review-routing-field-label">{t("review.routeMode")}</span>
                <select id={`review-route-${route.criterionId}`} value={draft.route === "named" ? draft.namedUserId ?? "" : draft.route}
                onChange={(event) => {
                  const value = event.target.value;
                  const routeMode = value === "unassigned" || value === "author" ? value : "named";
                  setRouteDrafts((previous) => ({ ...previous, [route.criterionId]: {
                    route: routeMode, namedUserId: routeMode === "named" ? value : null,
                    independentReview: draft.independentReview } }));
                }}>
                <option value="" disabled>{t("review.chooseReviewer")}</option>
                <option value="unassigned">{t("review.routeUnassigned")}</option>
                <option value="author">{t("review.routeAuthor")}</option>
                {reviewers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
              </select></label></td>
              <td><div className="review-routing-independent"><FieldHelp focusable={false} id={`review-independent-help-${route.criterionId}`}
                text={draft.independentReview && draft.route === "named" ? t("review.independentNamedRoute") : ""}
                label={<label><input type="checkbox" checked={draft.independentReview}
                aria-describedby={draft.independentReview && draft.route === "named" ? `review-independent-help-${route.criterionId}` : undefined}
                onChange={(event) => setRouteDrafts((previous) => ({ ...previous,
                  [route.criterionId]: { ...draft, independentReview: event.target.checked } }))} />
                <span className="review-routing-field-label">{t("review.independentReview")}</span></label>} />
              </div>
              {draft.independentReview && draft.route === "author" &&
                <p role="alert">{t("review.independentAuthorRoute")}</p>}
              </td>
              <td><span className="review-routing-field-label">{t("admin.actions")}</span><div className="review-row-actions">
              <button className="button-primary" type="button" disabled={routingError || savingRoutes[route.criterionId] || (draft.route === "named" && !draft.namedUserId) ||
                (draft.independentReview && draft.route === "author")}
                onClick={() => void saveRoute(route)}>{t("review.saveRoute")}</button>
              {routeDrafts[route.criterionId] && <button type="button" onClick={() => setRouteDrafts((previous) => {
                const updated = { ...previous }; delete updated[route.criterionId]; return updated;
              })}>{t("admin.cancel")}</button>}
              </div></td>
            </tr>;
          })}</tbody></table></div>}
      </section>

      <section aria-labelledby="review-outcomes-heading">
        <h2 id="review-outcomes-heading">{t("review.outcomes")}</h2>
        {outcomesError && <><p role="alert">{t("list.optionsUnavailable")}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("list.retry")}</button></>}
        {workflowError && <p role="alert">{t(workflowError === "conflict" ? "review.workflowConflict" : "review.workflowUnavailable")}</p>}
        <p>{t("review.outcomeHistoryHelp")}</p>
        <label>{t("review.outcomeChoice")} <select value={outcomeId} onChange={(event) => {
          if (!confirmDiscardChanges(outcomeDirty)) return;
          const selected = outcomes.find((option) => option.id === event.target.value);
          setOutcomeId(event.target.value); setOutcomeLabel(selected?.label ?? "");
          setOutcomeMeaning(selected?.meaning ?? ""); setOutcomeActive(selected?.active ?? true);
        }}><option value="">{t("review.newOutcome")}</option>
          {outcomes.map((option) => <option key={option.id} value={option.id}>
            {option.label} (v{option.revision}{option.active ? "" : `, ${t("review.retired")}`})
          </option>)}</select></label>
        <label>{t("review.outcomeLabel")} <input value={outcomeLabel} maxLength={120}
          onChange={(event) => setOutcomeLabel(event.target.value)} /></label>
        <label>{t("review.outcomeMeaning")} <textarea value={outcomeMeaning} maxLength={1000}
          onChange={(event) => setOutcomeMeaning(event.target.value)} /></label>
        <label><input type="checkbox" checked={outcomeActive} onChange={(event) => setOutcomeActive(event.target.checked)} />
          {t("review.outcomeActive")}</label>
        <button className="button-primary" type="button" disabled={outcomesError || workflowBusy || !outcomeLabel.trim() || !outcomeMeaning.trim()}
          onClick={() => void saveOutcome()}>{t("review.saveOutcome")}</button>
      </section>

      <section aria-labelledby="review-overdue-heading">
        <h2 id="review-overdue-heading">{t("review.overdueSettings")}</h2>
        <label>{t("review.overdueDeadlineHours")} <input type="number" min={1} max={720}
          value={deadlineHours} disabled={!!policyBusy} onChange={(event) => {
            deadlineDirty.current = Number(event.target.value) !== overduePolicy?.deadlineHours; setDeadlineHours(Number(event.target.value)); setDeadlineMessage(null);
          }} /></label>
        <button className="button-primary" type="button" disabled={!!policyBusy || !overduePolicy || deadlineHours === overduePolicy.deadlineHours ||
          !Number.isInteger(deadlineHours) || deadlineHours < 1 || deadlineHours > 720}
          onClick={() => void saveOverduePolicy()}>{t("review.saveOverdueDeadline")}</button>
        {deadlineMessage && <p role="status">{deadlineMessage}</p>}
        {deadlineMessage === t("review.policyConflict") && !policyBusy && <button type="button" onClick={() => {
          if (!confirmDiscardChanges(deadlineDirty.current) || !latestDeadline.current) return;
          deadlineDirty.current = false; setOverduePolicy(latestDeadline.current); setDeadlineHours(latestDeadline.current.deadlineHours); setDeadlineMessage(null);
        }}>{t("review.reloadPolicy")}</button>}

      </section>

      <section aria-labelledby="review-amendment-policy-heading">
        <h2 id="review-amendment-policy-heading">{t("review.clearancePolicy")}</h2>
        <p>{t("review.clearancePolicyHelp")}</p>
        {amendmentPolicy ? <><label>{t("review.clearedCriterion")} <select value={clearanceDraft} disabled={!!policyBusy}
          onChange={(event) => { clearanceDirty.current = event.target.value !== amendmentPolicy.clearance; setClearanceDraft(event.target.value as ReviewAmendmentPolicy["clearance"]); setPolicyMessage(null); }}>
          <option value="confirm">{t("review.clearanceConfirm")}</option>
          <option value="automatic">{t("review.clearanceAutomatic")}</option>
        </select></label>
          <button className="button-primary" type="button" disabled={!!policyBusy || clearanceDraft === amendmentPolicy.clearance}
            onClick={() => void saveAmendmentPolicy()}>{t("review.saveClearancePolicy")}</button></> :
          <p role="status">{t("review.clearanceUnavailable")}</p>}
        {policyMessage && <p role="status">{policyMessage}</p>}
        {policyMessage === t("review.clearanceConflict") && !policyBusy && <button type="button" onClick={() => {
          if (!confirmDiscardChanges(clearanceDirty.current) || !latestClearance.current) return;
          clearanceDirty.current = false; setAmendmentPolicy(latestClearance.current); setClearanceDraft(latestClearance.current.clearance); setPolicyMessage(null);
        }}>{t("review.reloadPolicy")}</button>}
      </section>

      <section aria-labelledby="review-backlog-heading"><h2 id="review-backlog-heading" tabIndex={-1}>{t("review.backlog")}</h2>
        {backlogError && <><p role="alert">{t("review.processingUnavailable")}{backlog && ` ${t("list.refreshRetained")}`}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("list.retry")}</button></>}
        {backlog === null ? <p role="status">{t("review.processingUnavailable")}</p> : backlog.length === 0 ? <p>{t("review.backlogEmpty")}</p> : <ul>{backlog.map((work) =>
          <li key={work.reportId}><code>{work.reportId}</code> — {work.state}, {work.attempts} {t("review.attempts")}
            {work.lastError && <p>{work.lastError}</p>}</li>)}</ul>}</section>

    </>}
  </section>;
}
