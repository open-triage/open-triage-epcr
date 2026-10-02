"use client";

import type { ClinicianSession, ReviewAttentionKind, ReviewAttentionResponse, ReviewOverdueDraft, ReviewSignedReport, ReviewSignedReportsResponse, ReviewVolumeResult,
  ReviewQueueResponse, ReviewQueueItem, ReviewItemDetail, ReviewCriterionRoute,
  ReviewEligibleReviewer, ReviewOutcomeOption, ReviewAmendmentPolicy, ReviewOverdueExceptionCode, ReviewBulkResult, ReportNote } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { ReviewTabs } from "./review-tabs";
import { StationaryRecord } from "./stationary-record";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { ReviewVolumeChart } from "./review-volume-chart";
import { ReviewAnalysisBuilder } from "./review-analysis-builder";
import { ReviewWorkloadBuilder } from "./review-workload-builder";
import { downloadReviewCsv } from "./review-csv-download";

function dateString(date: Date): string { return date.toISOString().slice(0, 10); }

export function ReviewShell({ session, language, online, attention, onAttentionRefresh, callWindow }: {
  callWindow?: { reportId: string; itemId?: string; dataset: "real" | "synthetic" };
  session: ClinicianSession;
  language: AgencyLanguage;
  online: boolean;
  attention: ReviewAttentionResponse | null;
  onAttentionRefresh: (dataset: "real" | "synthetic") => void;
}) {
  const [dataset, setDataset] = useState<"real" | "synthetic">(
    callWindow?.dataset ?? (session.capabilities?.includes("clinical:demo") ? "synthetic" : "real"));
  const administrator = session.capabilities?.includes("review:admin") ?? false;
  const [tab, setTab] = useState<"queue" | "reports" | "analysis" | "settings">("queue");
  const [analysisTab, setAnalysisTab] = useState<"volume" | "clinical" | "workload" | "saved">("volume");
  const [detailTab, setDetailTab] = useState<"findings" | "history">("findings");
  const [assignment, setAssignment] = useState<"all" | "mine" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [queuePage, setQueuePage] = useState(1);
  const [bulkSelection, setBulkSelection] = useState<{ key: string; items: Record<string, number> }>(
    { key: "", items: {} });
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkResult, setBulkResult] = useState<ReviewBulkResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(false);
  const [attentionFilter, setAttentionFilter] = useState<ReviewAttentionKind | "">("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [criterion, setCriterion] = useState("");
  const [queueFrom, setQueueFrom] = useState("");
  const [queueTo, setQueueTo] = useState("");
  const [backlog, setBacklog] = useState<Array<{ reportId: string; state: string; attempts: number; lastError: string | null }> | null>(null);
  const [result, setResult] = useState<ReviewSignedReportsResponse | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(callWindow?.reportId ?? null);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [selectedReportItemId, setSelectedReportItemId] = useState<string | null>(callWindow?.itemId ?? null);
  const selectedItemId = selectedItem?.id ?? selectedReportItemId;
  const [itemDetail, setItemDetail] = useState<ReviewItemDetail | null>(null);
  const selectedKind = selectedItem?.kind ?? itemDetail?.kind;
  const selectedSignedAt = selectedItem?.signedAt ?? itemDetail?.signedAt;
  const waitingForItem = !!selectedItemId && !itemDetail;

  const [entryKind, setEntryKind] = useState<"comment" | "finding">("comment");
  const [handoffTarget, setHandoffTarget] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentPending, setCommentPending] = useState<{ commandId: string; expectedVersion: number;
    itemId: string; body: string; kind: "comment" | "finding" } | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<"conflict" | "denied" | "unavailable" | null>(null);
  const [claimError, setClaimError] = useState<"conflict" | "unavailable" | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [routes, setRoutes] = useState<ReviewCriterionRoute[] | null>(null);
  const [reviewers, setReviewers] = useState<ReviewEligibleReviewer[]>([]);
  const [itemReviewers, setItemReviewers] = useState<ReviewEligibleReviewer[]>([]);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, { route: ReviewCriterionRoute["route"];
    namedUserId: string | null; independentReview: boolean }>>({});
  const [assignmentTarget, setAssignmentTarget] = useState("");
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ReviewOutcomeOption[]>([]);
  const [amendmentPolicy, setAmendmentPolicy] = useState<ReviewAmendmentPolicy | null>(null);
  const [clearanceDraft, setClearanceDraft] = useState<ReviewAmendmentPolicy["clearance"]>("confirm");
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [outcomeId, setOutcomeId] = useState("");
  const [completionOutcomeId, setCompletionOutcomeId] = useState("");
  const [outcomeLabel, setOutcomeLabel] = useState("");
  const [outcomeMeaning, setOutcomeMeaning] = useState("");
  const [outcomeActive, setOutcomeActive] = useState(true);
  const [workflowError, setWorkflowError] = useState<"conflict" | "unavailable" | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [exceptionCode, setExceptionCode] = useState<ReviewOverdueExceptionCode | "">("");
  const [detail, setDetail] = useState<ReviewSignedReport | null>(null);
  const [draftDetail, setDraftDetail] = useState<ReviewOverdueDraft | null>(null);
  const [overduePolicy, setOverduePolicy] = useState<{ deadlineHours: number; version: number } | null>(null);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [detailError, setDetailError] = useState(false);
  const [from, setFrom] = useState(() => dateString(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => dateString(new Date()));
  const [volume, setVolume] = useState<ReviewVolumeResult | null>(null);
  const [volumeError, setVolumeError] = useState(false);
  const [volumeExportBusy, setVolumeExportBusy] = useState(false);
  const [volumeExportNotice, setVolumeExportNotice] = useState<string | null>(null);
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, key, parameters);

  useEffect(() => {
    if (!online) return;
    const update = () => { if (document.visibilityState === "visible") setRefresh((value) => value + 1); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update); };
  }, [online]);

  function openCall(reportId: string, itemId?: string) {
    const query = new URLSearchParams({ report: reportId, dataset, language });
    if (itemId) query.set("item", itemId);
    window.open(`${browserRequestConfiguration().basePath}/review-call/?${query}`, "_blank", "noopener,width=1440,height=1000");
  }

  const bulkScopeKey = JSON.stringify([dataset, queuePage, priority, status, attentionFilter, criterion, queueFrom, queueTo, assignment, search]);
  const activeBulkSelection = bulkSelection.key === bulkScopeKey ? bulkSelection.items : {};

  useEffect(() => {
    if (!online || callWindow || tab !== "queue") return;
    const controller = new AbortController();
    const query = new URLSearchParams({ dataset, page: String(queuePage) });
    query.set("assignment", assignment);
    if (search.trim()) query.set("search", search.trim());
    if (priority) query.set("priority", priority);
    if (status) query.set("status", status);
    if (attentionFilter) query.set("attention", attentionFilter);
    if (criterion) query.set("criterion", criterion);
    if (queueFrom) query.set("from", queueFrom);
    if (queueTo) query.set("to", queueTo);
    const url = apiRequestUrl(`/api/review/queue?${query}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewQueueResponse;
      if (!controller.signal.aborted) { setQueue(next); setQueueError(false); }
    }).catch(() => { if (!controller.signal.aborted) { setQueue(null); setQueueError(true); } });
    return () => controller.abort();
  }, [dataset, online, queuePage, priority, status, attentionFilter, criterion, queueFrom, queueTo, assignment, search, refresh, callWindow, tab]);

  useEffect(() => { if (!callWindow) onAttentionRefresh(dataset); }, [dataset, refresh, onAttentionRefresh, callWindow]);

  function showAttention(kind: ReviewAttentionKind | "") {
    setAttentionFilter(kind); setPriority(""); setStatus(""); setCriterion("");
    setQueueFrom(""); setQueueTo(""); setQueuePage(1);
    setTab("queue"); setAssignment("all"); setSearch("");
  }

  useEffect(() => {
    if (!online || callWindow || !session.capabilities?.includes("review:admin")) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/backlog?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const value = await response.json() as { work: typeof backlog };
      if (!controller.signal.aborted) setBacklog(value.work);
    }).catch(() => { if (!controller.signal.aborted) setBacklog(null); });
    return () => controller.abort();
  }, [dataset, online, refresh, session.capabilities, callWindow]);

  useEffect(() => {
    if (!online || callWindow || tab !== "reports") return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/reports?dataset=${dataset}&page=${page}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewSignedReportsResponse;
      if (!controller.signal.aborted) { setResult(next); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) { setResult(null); setError(true); } });
    return () => controller.abort();
  }, [dataset, online, page, refresh, callWindow, tab]);

  useEffect(() => {
    if (!online || !selected || waitingForItem || (selectedKind === "overdue-unsigned" && !selectedSignedAt)) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/reports/${selected}?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewSignedReport;
      if (!controller.signal.aborted) { setDetail(next); setDetailError(false); }
    }).catch(() => { if (!controller.signal.aborted) { setDetail(null); setDetailError(true); } });
    return () => controller.abort();
  }, [dataset, online, selected, waitingForItem, selectedKind, selectedSignedAt, refresh]);

  useEffect(() => {
    if (!online || !selectedItemId || selectedKind !== "overdue-unsigned" || !!selectedSignedAt) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/items/${selectedItemId}/draft?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      if (!controller.signal.aborted) { setDraftDetail(await response.json() as ReviewOverdueDraft); setDetailError(false); }
    }).catch(() => { if (!controller.signal.aborted) { setDraftDetail(null); setDetailError(true); } });
    return () => controller.abort();
  }, [dataset, online, selectedItemId, selectedKind, selectedSignedAt, refresh]);

  useEffect(() => {
    if (!online || callWindow || !session.capabilities?.includes("review:admin")) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/overdue-policy");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const value = await response.json() as { deadlineHours: number; version: number };
      if (!controller.signal.aborted) { setOverduePolicy(value); setDeadlineHours(value.deadlineHours); }
    }).catch(() => { if (!controller.signal.aborted) setOverduePolicy(null); });
    return () => controller.abort();
  }, [online, refresh, session.capabilities, callWindow]);

  useEffect(() => {
    if (!online || !selectedItemId) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/items/${selectedItemId}?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      if (!controller.signal.aborted) { setItemDetail(next); }
    }).catch(() => { if (!controller.signal.aborted) { setItemDetail(null); setDetail(null); setDraftDetail(null); setDetailError(true); } });
    return () => controller.abort();
  }, [dataset, online, selectedItemId, refresh]);

  useEffect(() => {
    if (!online || callWindow || !session.capabilities?.includes("review:admin")) return;
    const controller = new AbortController();
    const routeUrl = apiRequestUrl("/api/review/routes");
    const reviewersUrl = apiRequestUrl("/api/review/eligible-reviewers");
    if (!routeUrl || !reviewersUrl) return;
    void Promise.all([fetch(routeUrl, browserRequestInit({ signal: controller.signal })),
      fetch(reviewersUrl, browserRequestInit({ signal: controller.signal }))]).then(async ([routeResponse, reviewerResponse]) => {
      if (!routeResponse.ok || !reviewerResponse.ok) throw new Error("Review routing is unavailable");
      const [configured, eligible] = await Promise.all([
        routeResponse.json() as Promise<ReviewCriterionRoute[]>,
        reviewerResponse.json() as Promise<ReviewEligibleReviewer[]>]);
      if (!controller.signal.aborted) { setRoutes(configured); setReviewers(eligible); }
    }).catch(() => { if (!controller.signal.aborted) setRoutes(null); });
    return () => controller.abort();
  }, [online, refresh, session.capabilities, callWindow]);

  useEffect(() => {
    if (!online || callWindow || !session.capabilities?.includes("review:admin")) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/amendment-policy");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const policy = await response.json() as ReviewAmendmentPolicy;
      if (!controller.signal.aborted) { setAmendmentPolicy(policy); setClearanceDraft(policy.clearance); }
    }).catch(() => { if (!controller.signal.aborted) setAmendmentPolicy(null); });
    return () => controller.abort();
  }, [online, refresh, session.capabilities, callWindow]);

  useEffect(() => {
    if (!online || !selectedItemId || (!administrator && itemDetail?.assigneeId !== session.user.id)) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/eligible-reviewers?itemId=${selectedItemId}&dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const eligible = await response.json() as ReviewEligibleReviewer[];
      if (!controller.signal.aborted) setItemReviewers(eligible);
    }).catch(() => { if (!controller.signal.aborted) setItemReviewers([]); });
    return () => controller.abort();
  }, [online, selectedItemId, dataset, refresh, administrator, itemDetail?.assigneeId, session.user.id]);

  async function saveRoute(route: ReviewCriterionRoute) {
    const draft = routeDrafts[route.criterionId] ?? { route: route.route, namedUserId: route.namedUserId,
      independentReview: route.independentReview };
    const url = apiRequestUrl(`/api/review/routes/${route.criterionId}`);
    if (!url) return;
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
      setRouteDrafts((previous) => { const updated = { ...previous }; delete updated[route.criterionId]; return updated; });
      setAssignmentMessage(t("review.routingSaved"));
    } catch { setAssignmentMessage(t("review.assignmentChanged")); setRefresh((value) => value + 1); }
  }

  async function saveAmendmentPolicy() {
    if (!amendmentPolicy || clearanceDraft === amendmentPolicy.clearance) return;
    const url = apiRequestUrl("/api/review/amendment-policy");
    if (!url) return;
    setPolicyMessage(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: amendmentPolicy.version,
          clearance: clearanceDraft }) }));
      if (!response.ok) throw new Error(String(response.status));
      setAmendmentPolicy(await response.json() as ReviewAmendmentPolicy);
      setPolicyMessage(t("review.clearanceSaved"));
    } catch { setPolicyMessage(t("review.clearanceConflict")); setRefresh((value) => value + 1); }
  }

  async function assign(item: ReviewItemDetail, forwarding = false) {
    const url = apiRequestUrl(`/api/review/items/${item.id}/${forwarding ? "forward" : "assign"}`);
    if (forwarding && commentDraft.trim()) return;
    if (!url) return;
    setAssignmentMessage(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: item.version,
          dataset, assigneeId: (forwarding ? handoffTarget : assignmentTarget) || null }) }));
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      setItemDetail(next); setSelectedItem(next);
      setQueue((previous) => previous ? { ...previous,
        items: previous.items.map((entry) => entry.id === item.id ? next : entry) } : previous);
      setAssignmentMessage(t("review.assignmentSaved"));
      setRefresh((value) => value + 1);
    } catch { setAssignmentMessage(t("review.assignmentChanged")); setRefresh((value) => value + 1); }
  }

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/outcomes");
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      if (!controller.signal.aborted) setOutcomes(await response.json() as ReviewOutcomeOption[]);
    }).catch(() => { if (!controller.signal.aborted) setOutcomes([]); });
    return () => controller.abort();
  }, [online, refresh]);

  async function progress(item: ReviewItemDetail, status: "in-review" | "awaiting-clinician" | "completed") {
    const url = apiRequestUrl(`/api/review/items/${item.id}/progress`);
    if (!url || workflowBusy || commentDraft.trim()) return;
    setWorkflowBusy(true); setWorkflowError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: item.version,
          dataset, status, ...(status === "completed" ? { outcomeOptionId: completionOutcomeId } : {}) }) }));
      if (response.status === 409) { setWorkflowError("conflict"); setRefresh((value) => value + 1); return; }
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      setItemDetail(next); setSelectedItem(next); setRefresh((value) => value + 1);
    } catch { setWorkflowError("unavailable"); }
    finally { setWorkflowBusy(false); }
  }

  async function closeOverdueException(item: ReviewItemDetail) {
    const url = apiRequestUrl(`/api/review/items/${item.id}/close-exceptionally`);
    if (!url || workflowBusy || !exceptionCode) return;
    setWorkflowBusy(true); setWorkflowError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: item.version,
          dataset, reasonCode: exceptionCode }) }));
      if (response.status === 409) { setWorkflowError("conflict"); setRefresh((value) => value + 1); return; }
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      setItemDetail(next); setSelectedItem(next); setExceptionCode(""); setRefresh((value) => value + 1);
    } catch { setWorkflowError("unavailable"); }
    finally { setWorkflowBusy(false); }
  }

  async function sendComment(item: ReviewItemDetail) {
    const body = commentDraft.trim();
    const url = apiRequestUrl(`/api/review/items/${item.id}/comments`);
    if (!url || !body || commentBusy) return;
    const command = commentPending?.itemId === item.id && commentPending.body === body && commentPending.kind === entryKind
      ? commentPending : { commandId: crypto.randomUUID(), expectedVersion: item.version, itemId: item.id, body, kind: entryKind };
    setCommentPending(command); setCommentBusy(true); setCommentError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: command.commandId, expectedVersion: command.expectedVersion,
          dataset, body, kind: command.kind }) }));
      if (response.status === 409) { setCommentPending(null); setCommentError("conflict");
        setRefresh((value) => value + 1); return; }
      if (response.status === 403) { setCommentPending(null); setCommentError("denied");
        setRefresh((value) => value + 1); return; }
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      setItemDetail(next); if (selectedItem?.id === item.id) setSelectedItem(next);
      setCommentDraft(""); setCommentPending(null); setRefresh((value) => value + 1);
    } catch { setCommentError("unavailable"); }
    finally { setCommentBusy(false); }
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
    if (!overduePolicy || !Number.isInteger(deadlineHours) || deadlineHours < 1 || deadlineHours > 720) return;
    const url = apiRequestUrl("/api/review/overdue-policy");
    if (!url) return;
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: overduePolicy.version,
          deadlineHours }) }));
      if (!response.ok) throw new Error(String(response.status));
      setOverduePolicy(await response.json() as { deadlineHours: number; version: number });
    } catch { setOverduePolicy(null); setRefresh((value) => value + 1); }
  }

  async function claim(item: ReviewQueueItem) {
    const url = apiRequestUrl(`/api/review/items/${item.id}/claim`);
    if (!url || claiming) return;
    setClaiming(item.id);
    setClaimError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: item.version, dataset }) }));
      if (response.status === 409) { setClaimError("conflict"); setRefresh((value) => value + 1); return; }
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      setQueue((previous) => previous ? { ...previous,
        items: previous.items.map((entry) => entry.id === item.id ? next : entry) } : previous);
      if (selectedItem?.id === item.id) { setSelectedItem(next); setItemDetail(next);
        setAssignmentTarget(next.assigneeId ?? ""); }
      setRefresh((value) => value + 1);
    } catch { setClaimError("unavailable"); }
    finally { setClaiming(null); }
  }

  async function runBulk(action: "claim" | "assign") {
    const selections = Object.entries(activeBulkSelection).map(([itemId, expectedVersion]) =>
      ({ itemId, expectedVersion, commandId: crypto.randomUUID() }));
    if (!selections.length || bulkBusy || (action === "assign" && !bulkAssignee)) return;
    const url = apiRequestUrl(`/api/review/items/bulk-${action}`);
    if (!url) return;
    setBulkBusy(true); setBulkError(false); setBulkResult(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ dataset, selections,
          ...(action === "assign" ? { assigneeId: bulkAssignee } : {}) }) }));
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json() as ReviewBulkResult;
      setBulkResult(result);
      setBulkSelection({ key: bulkScopeKey, items: {} });
      setQueue((previous) => previous ? { ...previous, items: previous.items.map((item) =>
        result.results.find((entry) => entry.itemId === item.id && entry.item)?.item ?? item) } : previous);
      setRefresh((value) => value + 1);
    } catch { setBulkError(true); }
    finally { setBulkBusy(false); }
  }

  useEffect(() => {
    if (!online || callWindow || tab !== "analysis" || analysisTab !== "volume" || from > to) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/volume?dataset=${dataset}&from=${from}&to=${to}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewVolumeResult;
      if (!controller.signal.aborted) { setVolume(next); setVolumeError(false); }
    }).catch(() => { if (!controller.signal.aborted) setVolumeError(true); });
    return () => controller.abort();
  }, [dataset, from, to, online, refresh, callWindow, tab, analysisTab]);

  const exportVolumeCsv = async (records = false) => {
    if (!volume) return;
    setVolumeExportBusy(true); setVolumeExportNotice(null);
    const outcome = await downloadReviewCsv("volume", volume, session.csrfToken ?? session.accessToken ?? "", records);
    if (outcome.status === "refreshed") {
      setVolume(outcome.result); setVolumeExportNotice(t("review.csvRefreshed"));
    } else if (outcome.status === "denied") {
      setVolume(null); setVolumeExportNotice(t("review.csvDenied"));
    } else if (outcome.status === "error") setVolumeExportNotice(t("review.csvUnavailable"));
    setVolumeExportBusy(false);
  };

  const viewDetail = detail ?? (draftDetail ? { ...draftDetail, amendmentSequence: 0,
    reviewItems: [] as NonNullable<ReviewSignedReport["reviewItems"]> } : null);
  const mainTabs = ["queue", "reports", "analysis", ...(administrator ? ["settings"] : [])] as Array<typeof tab>;
  const panel = (id: string, value: string, active: string) => ({ role: "tabpanel", id: `${id}-panel-${value}`,
    "aria-labelledby": `${id}-tab-${value}`, hidden: value !== active, tabIndex: 0 });
  const reportLabel = (id: string, number?: string | null) => number ? number :
    `${t("review.report")} · ${id.slice(0, 8).toUpperCase()}`;
  const ageLabel = (matchedAt: string) => {
    const count = Math.max(0, Math.floor((Date.parse(queue?.asOf ?? "") - Date.parse(matchedAt)) / 86400000));
    return count === 0 ? t("review.workspace.today") : count === 1 ? t("review.workspace.oneDay") : t("review.ageDays", { count });
  };
  const criterionLabel = (item: Pick<ReviewQueueItem, "criterionId"> & Partial<Pick<ReviewQueueItem, "kind" | "criterionName">>) => item.kind === "overdue-unsigned" ? t("review.overdueUnsigned") :
    item.criterionName ?? routes?.find((route) => route.criterionId === item.criterionId)?.name ?? t("review.findings");
  return <main className="review-workspace" aria-labelledby="review-heading">
    <header className="review-heading review-card">
      <div><h1 id="review-heading">{t("navigation.review")}</h1><p>{session.organization.name}</p></div>
      {!callWindow && <div className="review-heading-actions">
        <label><span className="review-sr-only">{t("review.dataset")}</span><select value={dataset} onChange={(event) => {
          setResult(null); setDetail(null); setDraftDetail(null); setSelected(null); setSelectedItem(null);
          setSelectedReportItemId(null); setCommentDraft(""); setCommentPending(null);
          setVolume(null); setVolumeError(false); setQueue(null); setSearch("");
          setDataset(event.target.value as "real" | "synthetic"); setPage(1); setQueuePage(1);
        }}><option value="real">{t("review.real")}</option><option value="synthetic">{t("review.synthetic")}</option></select></label>

      </div>}
      {callWindow && <button type="button" onClick={() => window.close()}>{t("review.close")}</button>}
    </header>
    {!callWindow && <ReviewTabs id="review-main" label={t("review.workspace.navigation")} value={tab} onChange={setTab}
      options={mainTabs.map((value) => ({ value, label: t(`review.workspace.${value}`) }))} />}
    {!online ? <p role="status" className="review-card">{t("review.offline")}</p> : <>
    <div className={`review-content${callWindow ? " review-call-content" : ""}`}>
      {!callWindow && <>
      <div {...panel("review-main", "queue", tab)}>
        <div className="review-work-filters" role="group" aria-label={t("review.workspace.workFilters")}>
          {(["all", "mine", "unassigned"] as const).map((value) => <button key={value} type="button"
            aria-pressed={assignment === value && !attentionFilter} onClick={() => {
              setAssignment(value); setAttentionFilter(""); setQueuePage(1);
            }}>{t(`review.workspace.${value}`)} <span className="review-count-badge">{queue?.assignmentCounts?.[value] ?? "—"}</span></button>)}
          {attention && <div className="review-attention-links">
            {administrator && !!attention.unavailableAssignees && <button type="button" onClick={() => showAttention("unavailable-assignees")}>{t("review.attentionUnavailable", { count: attention.unavailableAssignees })}</button>}
            {administrator && !!attention.unavailableRoutes && <button type="button" onClick={() => { setTab("settings");  }}>{t("review.attentionRoutes", { count: attention.unavailableRoutes })}</button>}
            {administrator && !!attention.processingFailures && <button type="button" onClick={() => { setTab("settings");  }}>{t("review.attentionFailures", { count: attention.processingFailures })}</button>}
          </div>}
        </div>
      <section className="review-card review-queue-card" aria-labelledby="review-queue-heading">
        <h2 id="review-queue-heading">{t("review.queue")}</h2>
        {attentionFilter && <p role="status">{t(`review.attentionFilter.${attentionFilter}`)}{" "}
          <button type="button" onClick={() => showAttention("")}>{t("review.attentionAll")}</button></p>}
        <div className="review-controls review-filters">
          <label className="review-search">{t("review.workspace.search")}<input type="search" value={search}
            placeholder={t("review.workspace.searchPlaceholder")} maxLength={120}
            onChange={(event) => { setSearch(event.target.value); setQueuePage(1); }} /></label>
          <label>{t("review.priority")} <select value={priority} onChange={(event) => { setPriority(event.target.value); setQueuePage(1); }}>
            <option value="">{t("review.all")}</option><option value="high">{t("review.high")}</option>
            <option value="medium">{t("review.medium")}</option><option value="low">{t("review.low")}</option>
          </select></label>
          <label>{t("review.status")} <select value={status} onChange={(event) => { setStatus(event.target.value); setQueuePage(1); }}>
            <option value="">{t("review.all")}</option><option value="new">{t("review.new")}</option>
            <option value="in-review">{t("review.inReview")}</option>
            <option value="awaiting-clinician">{t("review.awaitingClinician")}</option>
            <option value="completed">{t("review.completed")}</option>
          </select></label>
          <button type="button" aria-expanded={moreFilters} aria-controls="review-advanced-filters"
            onClick={() => setMoreFilters(!moreFilters)}>{t("review.workspace.moreFilters")}</button>
        </div>
        <div id="review-advanced-filters" className="review-controls" hidden={!moreFilters}>
          <label>{t("review.criterion")} <select value={criterion} onChange={(event) => { setCriterion(event.target.value); setQueuePage(1); }}>
            <option value="">{t("review.all")}</option>
            {(routes ?? [...new Map((queue?.items ?? []).filter((item) => item.kind !== "overdue-unsigned").map((item) => [item.criterionId, { criterionId: item.criterionId, name: criterionLabel(item) }])).values()]).map((route) => <option key={route.criterionId} value={route.criterionId}>{route.name}</option>)}
          </select></label>
          <label>{t("review.from")} <input type="date" value={queueFrom} onChange={(event) => { setQueueFrom(event.target.value); setQueuePage(1); }} /></label>
          <label>{t("review.to")} <input type="date" value={queueTo} onChange={(event) => { setQueueTo(event.target.value); setQueuePage(1); }} /></label>
        </div>
        {queueError && <p role="alert">{t("review.queueUnavailable")}</p>}
        {claimError && <p role="alert">{t(claimError === "conflict" ? "review.claimConflict" : "review.claimUnavailable")}</p>}
        {workflowError && <p role="alert">{t(workflowError === "conflict" ? "review.workflowConflict" : "review.workflowUnavailable")}</p>}
        {queue && <><p>{t("review.queueCount", { count: queue.total })}</p>
          {(session.capabilities?.includes("review:all") || session.capabilities?.includes("review:admin")) &&
            <section className="review-bulk" aria-labelledby="review-bulk-heading"><h3 id="review-bulk-heading">{t("review.workspace.bulkActions")}</h3><div className="review-controls">
              <button type="button" onClick={() => setBulkSelection({ key: bulkScopeKey, items: Object.fromEntries(
                queue.items.map((item) => [item.id, item.version])) })}>{t("review.bulkSelectPage")}</button>
              <button type="button" onClick={() => setBulkSelection({ key: bulkScopeKey, items: {} })}>{t("review.bulkClearSelection")}</button>
              <span>{t("review.bulkSelected", { count: Object.keys(activeBulkSelection).length })}</span>
              {session.capabilities?.includes("review:all") && <button type="button"
                disabled={!Object.keys(activeBulkSelection).length || bulkBusy}
                onClick={() => void runBulk("claim")}>{t("review.bulkClaim")}</button>}
              {session.capabilities?.includes("review:admin") && <>
                <label>{t("review.bulkAssignee")} <select value={bulkAssignee}
                  onChange={(event) => setBulkAssignee(event.target.value)}>
                  <option value="">{t("review.chooseReviewer")}</option>
                  {reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName}</option>)}
                </select></label>
                <button type="button" disabled={!Object.keys(activeBulkSelection).length || !bulkAssignee || bulkBusy}
                  onClick={() => void runBulk("assign")}>{t("review.bulkAssign")}</button>
              </>}
            </div></section>}
          {bulkError && <p role="alert">{t("review.bulkUnavailable")}</p>}
          {bulkResult && <section aria-label={t("review.bulkResults")}>
            <p>{t("review.bulkSummary", { succeeded: bulkResult.results.filter((entry) => entry.status === "succeeded").length,
              failed: bulkResult.results.filter((entry) => entry.status === "failed").length })}</p>
            <ul>{bulkResult.results.map((entry) => <li key={entry.itemId}>{reportLabel(queue.items.find((item) => item.id === entry.itemId)?.reportId ?? entry.itemId)}: {entry.status === "succeeded" ?
              t("review.bulkSucceeded") : t(`review.bulkReason.${entry.reason}`)}</li>)}</ul>
          </section>}
          {queue.items.length === 0 ? <p>{t("review.queueEmpty")}</p> : <div className="review-table-scroll">
            <table className="review-queue-table" aria-labelledby="review-queue-heading">
              <thead><tr>
                {["review.workspace.select", "review.report", "review.workspace.reviewReason", "review.priority",
                  "review.status", "review.assignee", "review.age", "review.workspace.actions"].map((key) =>
                  <th key={key} scope="col">{t(key)}</th>)}
              </tr></thead><tbody>
            {queue.items.map((item) => <tr key={item.id} className="review-queue-row">
              <td><input type="checkbox" aria-label={t("review.bulkSelectItem", { id: item.id })}
                checked={Object.hasOwn(activeBulkSelection, item.id)} onChange={(event) => {
                  setBulkSelection((previous) => {
                    const next = previous.key === bulkScopeKey ? { ...previous.items } : {};
                    if (event.target.checked) next[item.id] = item.version;
                    else delete next[item.id];
                    return { key: bulkScopeKey, items: next };
                  });
                }} /></td>
              <td><button type="button" className="review-record-button review-queue-open" onClick={() => openCall(item.reportId, item.id)}>
                <strong>{reportLabel(item.reportId, item.reportNumber)}</strong>
              </button></td>
              <td><span className="review-row-criterion" tabIndex={0}>{criterionLabel(item)}<span className="review-criterion-tooltip" role="tooltip">{item.criterionDescription ?? item.findings.map((finding) => finding.message).join(" · ")}</span></span></td>
              <td><span className={`review-badge priority-${item.priority}`}>{t(`review.${item.priority}`)}</span></td>
              <td><span className={`review-badge status-${item.status}`}>{t(`review.${item.status === "in-review" ? "inReview" : item.status === "awaiting-clinician" ? "awaitingClinician" : item.status}`)}{item.reopened && ` · ${t("review.reopened")}`}</span></td>
              <td>{item.assigneeId ? item.assigneeId === session.user.id ? t("review.assignedToYou") : item.assigneeName ?? t("review.workspace.reviewer") : t("review.unassigned")}</td>
              <td>{ageLabel(item.firstMatchedAt)}</td>
              <td>{!item.assigneeId && item.status === "new" && session.capabilities?.includes("review:all") && <button type="button" disabled={!!claiming} onClick={() => void claim(item)}>{t("review.claim")}</button>}</td>
            </tr>)}
            </tbody></table>
          </div>}
          <nav className="review-pagination" aria-label={t("review.queuePages")}>
            <button type="button" disabled={queuePage === 1} onClick={() => setQueuePage(queuePage - 1)}>{t("review.previous")}</button>
            <span>{t("review.page", { page: queuePage })}</span>
            <button type="button" disabled={queuePage * queue.pageSize >= queue.total} onClick={() => setQueuePage(queuePage + 1)}>{t("review.next")}</button>
          </nav></>}
      </section>

      </div>
      <div {...panel("review-main", "reports", tab)}><section className="review-card"><h2>{t("review.heading")}</h2>
      {error && <p role="alert">{t("review.unavailable")}</p>}
      {!result && !error && <p role="status">{t("review.loading")}</p>}
      {result && <>
        <p>{t("review.count", { count: result.total })}</p>
        {result.reports.length === 0 ? <p>{t("review.empty")}</p> :
          <div className="review-record-list" role="list">{result.reports.map((report) => <div role="listitem" key={report.id}>
            <button type="button" className="review-record-button review-signed-row" onClick={() => openCall(report.id)}>
              <strong>{reportLabel(report.id, report.reportNumber)}</strong><span>{report.reportingDate}</span>
              <span>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.signedAt))}</span>
              {result.identifying && <span>{report.documentingClinician ?? "—"}</span>}
            </button>
          </div>)}</div>}
        <nav className="review-pagination" aria-label={t("review.pages")}>
          <button type="button" disabled={page === 1} onClick={() => { setResult(null); setPage(page - 1); }}>{t("review.previous")}</button>
          <span>{t("review.page", { page })}</span>
          <button type="button" disabled={page * result.pageSize >= result.total}
            onClick={() => { setResult(null); setPage(page + 1); }}>{t("review.next")}</button>
        </nav>
      </>}

</section></div>
      <div {...panel("review-main", "analysis", tab)}>
        <ReviewTabs id="review-analysis" label={t("review.workspace.analysis")} value={analysisTab} onChange={setAnalysisTab}
          options={(["volume", "clinical", "workload", "saved"] as const).map((value) => ({ value, label: t(`review.workspace.${value}`) }))} />
        <div {...panel("review-analysis", "volume", analysisTab)}>      <section className="review-card" aria-labelledby="review-volume-heading">
        <h2 id="review-volume-heading">{t("review.volumeHeading")}</h2>
        <div className="review-controls">
          <label>{t("review.from")}{" "}<input type="date" value={from} max={to}
            onChange={(event) => { setVolume(null); setVolumeError(false); setFrom(event.target.value); }} /></label>
          <label>{t("review.to")}{" "}<input type="date" value={to} min={from}
            onChange={(event) => { setVolume(null); setVolumeError(false); setTo(event.target.value); }} /></label>
        </div>
        <p>{t("review.volumeUnit")}</p>
        {volumeError && <p role="alert">{t("review.volumeUnavailable")}</p>}
        {volumeExportNotice && <p role="alert">{volumeExportNotice}</p>}
        {!volume && !volumeError && <p role="status">{t("review.volumeLoading")}</p>}
        {volume?.freshness.status === "stale" && <p role="alert">{t("review.volumeStale")}</p>}
        {volume?.freshness.status === "current" && <>
          {volume.exportRevision && <button type="button" disabled={volumeExportBusy}
            onClick={() => void exportVolumeCsv()}>{t("review.csvDownload")}</button>}
          {volume.exportRevision && <button type="button" disabled={volumeExportBusy}
            onClick={() => void exportVolumeCsv(true)}>{t("review.csvRecordsDownload")}</button>}
          <p>{t("review.volumeTotal", { count: volume.total ?? 0 })}{" · "}
            {t("review.volumeScope", { scope: t(`review.scope.${volume.population.scope}`) })}{" · "}
            {t("review.volumeFresh", { time: new Intl.DateTimeFormat(language, {
              dateStyle: "medium", timeStyle: "short" }).format(new Date(volume.freshness.observedAt)) })}</p>
          <div className="review-metrics">
            <div><span>{t("review.workspace.signedReports")}</span><strong>{volume.total ?? 0}</strong></div>
            <div><span>{t("review.workspace.dailyAverage")}</span><strong>{new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format((volume.total ?? 0) / Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1))}</strong></div>
            <div><span>{t("review.workspace.busiestDay")}</span><strong>{Math.max(0, ...volume.points.map((point) => point.count))}</strong></div>
          </div>
          <ReviewVolumeChart points={volume.points} title={t("review.volumeChartLabel")} />
          <details><summary>{t("review.workspace.exactValues")}</summary><table><caption>{t("review.volumeTable")}</caption><thead><tr>
            <th>{t("review.reportingDate")}</th><th>{t("review.volumeCount")}</th>
          </tr></thead><tbody>{volume.points.map((point) => <tr key={point.date}>
            <td>{point.date}</td><td>{point.count}</td>
          </tr>)}</tbody></table></details>
        </>}
      </section>
</div>
        <div hidden id={`review-analysis-panel-${analysisTab === "saved" ? "clinical" : "saved"}`} role="tabpanel"
          aria-labelledby={`review-analysis-tab-${analysisTab === "saved" ? "clinical" : "saved"}`} />
        <div role="tabpanel" id={`review-analysis-panel-${analysisTab === "saved" ? "saved" : "clinical"}`}
          aria-labelledby={`review-analysis-tab-${analysisTab === "saved" ? "saved" : "clinical"}`}
          hidden={analysisTab !== "clinical" && analysisTab !== "saved"} className="review-card">      <ReviewAnalysisBuilder view={analysisTab === "saved" ? "saved" : "clinical"} dataset={dataset}
        from={from} to={to} language={language} refresh={refresh}
        csrfToken={session.csrfToken ?? session.accessToken ?? ""}
        administrator={session.capabilities?.includes("review:admin") &&
          session.capabilities?.includes("review:all") || false} />
</div>
        <div {...panel("review-analysis", "workload", analysisTab)} className="review-card">
          <div className="review-controls"><label>{t("review.from")}<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>{t("review.to")}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label></div>
      <ReviewWorkloadBuilder key={`workload-${dataset}-${from}-${to}-${refresh}`} dataset={dataset}
        from={from} to={to} language={language}
        csrfToken={session.csrfToken ?? session.accessToken ?? ""} />
</div>
      </div>
      {administrator && <div {...panel("review-main", "settings", tab)}>
        <div className="review-settings-layout">
          <div className="review-card review-settings-card">
            <div>
      {session.capabilities?.includes("review:admin") && <section aria-labelledby="review-routing-heading">
        <h2 id="review-routing-heading">{t("review.routingHeading")}</h2>
        <p>{t("review.routingHelp")}</p>
        {assignmentMessage && <p role="status">{assignmentMessage}</p>}
        {routes === null ? <p role="status">{t("review.routingUnavailable")}</p> :
          routes.length === 0 ? <p>{t("review.noRoutes")}</p> : <ul className="review-routing-list">{routes.map((route) => {
            const draft = routeDrafts[route.criterionId] ?? { route: route.route, namedUserId: route.namedUserId,
              independentReview: route.independentReview };
            return <li key={route.criterionId}>
              <strong>{route.name}</strong>
              {route.recoveryReason && <p role="alert">{t("review.routeRecovered")}</p>}
              <label>{t("review.routeMode")}{" "}<select value={draft.route} onChange={(event) =>
                setRouteDrafts((previous) => ({ ...previous, [route.criterionId]: {
                  route: event.target.value as ReviewCriterionRoute["route"], namedUserId: null,
                  independentReview: draft.independentReview } }))}>
                <option value="unassigned">{t("review.routeUnassigned")}</option>
                <option value="author">{t("review.routeAuthor")}</option>
                <option value="named">{t("review.routeNamed")}</option>
              </select></label>
              {draft.route === "named" && <label>{t("review.namedReviewer")}{" "}<select value={draft.namedUserId ?? ""}
                onChange={(event) => setRouteDrafts((previous) => ({ ...previous,
                  [route.criterionId]: { route: "named", namedUserId: event.target.value || null,
                    independentReview: draft.independentReview } }))}>
                <option value="">{t("review.chooseReviewer")}</option>
                {reviewers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
              </select></label>}
              <label><input type="checkbox" checked={draft.independentReview}
                onChange={(event) => setRouteDrafts((previous) => ({ ...previous,
                  [route.criterionId]: { ...draft, independentReview: event.target.checked } }))} />
                {t("review.independentReview")}</label>
              {draft.independentReview && draft.route === "author" &&
                <p role="alert">{t("review.independentAuthorRoute")}</p>}
              {draft.independentReview && draft.route === "named" &&
                <p>{t("review.independentNamedRoute")}</p>}
              <button type="button" disabled={(draft.route === "named" && !draft.namedUserId) ||
                (draft.independentReview && draft.route === "author")}
                onClick={() => void saveRoute(route)}>{t("review.saveRoute")}</button>
            </li>;
          })}</ul>}
      </section>}

</div>
            <div>
      {session.capabilities?.includes("review:admin") && <section aria-labelledby="review-outcomes-heading">
        <h2 id="review-outcomes-heading">{t("review.outcomes")}</h2>
        <p>{t("review.outcomeHistoryHelp")}</p>
        <label>{t("review.outcomeChoice")} <select value={outcomeId} onChange={(event) => {
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
        <button type="button" disabled={workflowBusy || !outcomeLabel.trim() || !outcomeMeaning.trim()}
          onClick={() => void saveOutcome()}>{t("review.saveOutcome")}</button>
      </section>}

</div>
            <div>
      {session.capabilities?.includes("review:admin") && <section aria-labelledby="review-overdue-heading">
        <h2 id="review-overdue-heading">{t("review.overdueSettings")}</h2>
        <label>{t("review.overdueDeadlineHours")} <input type="number" min={1} max={720}
          value={deadlineHours} onChange={(event) => setDeadlineHours(Number(event.target.value))} /></label>
        <button type="button" disabled={!overduePolicy || deadlineHours === overduePolicy.deadlineHours ||
          !Number.isInteger(deadlineHours) || deadlineHours < 1 || deadlineHours > 720}
          onClick={() => void saveOverduePolicy()}>{t("review.saveOverdueDeadline")}</button>
      </section>}

</div>
            <div>
      {session.capabilities?.includes("review:admin") && <section aria-labelledby="review-amendment-policy-heading">
        <h2 id="review-amendment-policy-heading">{t("review.clearancePolicy")}</h2>
        <p>{t("review.clearancePolicyHelp")}</p>
        {amendmentPolicy ? <><label>{t("review.clearedCriterion")} <select value={clearanceDraft}
          onChange={(event) => setClearanceDraft(event.target.value as ReviewAmendmentPolicy["clearance"])}>
          <option value="confirm">{t("review.clearanceConfirm")}</option>
          <option value="automatic">{t("review.clearanceAutomatic")}</option>
        </select></label>
          <button type="button" disabled={clearanceDraft === amendmentPolicy.clearance}
            onClick={() => void saveAmendmentPolicy()}>{t("review.saveClearancePolicy")}</button></> :
          <p role="status">{t("review.clearanceUnavailable")}</p>}
        {policyMessage && <p role="status">{policyMessage}</p>}
      </section>}

</div>
            <div>
      {backlog && <section aria-labelledby="review-backlog-heading"><h2 id="review-backlog-heading">{t("review.backlog")}</h2>
        {backlog.length === 0 ? <p>{t("review.backlogEmpty")}</p> : <ul>{backlog.map((work) =>
          <li key={work.reportId}><code>{work.reportId}</code> — {work.state}, {work.attempts} {t("review.attempts")}
            {work.lastError && <p>{work.lastError}</p>}</li>)}</ul>}</section>}

</div>
          </div>
        </div>
      </div>}
      </>}
      {callWindow && viewDetail && <article className="review-card review-call-form" aria-label={t("review.report")}>

          {!draftDetail && <p>{t("review.amendments", { count: viewDetail.amendmentSequence })}</p>}
          {!!viewDetail.reviewItems?.length && <section><h3>{t("review.reportItems")}</h3><ul>
            {viewDetail.reviewItems.map((item) => <li key={item.id}><button type="button"
              onClick={() => { if (commentDraft.trim()) return; setSelectedItem(null); setSelectedReportItemId(item.id); setItemDetail(null);
                setDetailTab("findings"); setCommentDraft(""); setCommentPending(null); }}>{criterionLabel(item)}</button>:
              {" "}{t(`review.${item.status === "in-review" ? "inReview" : item.status === "awaiting-clinician" ? "awaitingClinician" : item.status}`)}
              {item.outcome && <> — {item.outcome.label}: {item.outcome.meaning}</>}
              {item.clearancePending && <> — {t("review.clearancePending")}</>}
              {item.closureReason && <> — {t("review.automaticClosure")}</>}</li>)}
          </ul></section>}
          {viewDetail.document && viewDetail.clinicalForm ? <StationaryRecord key={viewDetail.id} readOnly
            document={viewDetail.document} formDefinition={viewDetail.clinicalForm.definition}
            catalogFields={viewDetail.clinicalForm.catalogFields} customFields={viewDetail.clinicalForm.customFields}
            customGroups={viewDetail.clinicalForm.customGroups} catalogGroups={viewDetail.clinicalForm.catalogGroups}
            language={language} onDocumentChange={() => {}} /> : <>
          {viewDetail.groups.map((group) => <section key={group.id}>
            <h3>{group.parentGroupInstanceId ? `${viewDetail.groups.find((item) => item.id === group.parentGroupInstanceId)?.label ?? ""} / ` : ""}
              {group.label} {group.ordinal > 0 ? `#${group.ordinal + 1}` : ""}</h3>
            <ReviewValues values={viewDetail.values.filter((value) => value.groupInstanceId === group.id)} />
          </section>)}
          <ReviewValues values={viewDetail.values.filter((value) => !value.groupInstanceId)} />
          </>}
          {viewDetail.notes.length > 0 && <section><h3>{t("review.notes")}</h3>
            {viewDetail.notes.map((note) => <ReviewNote key={note.id} note={note} reportId={viewDetail.id} dataset={dataset} language={language} />)}
          </section>}
      </article>}
      {selected && (tab === "queue" || tab === "reports") && <aside className="review-card review-inspector" aria-label={t("review.detail")}>
        <header className="review-inspector-heading"><div><p className="eyebrow">{t("review.workspace.selectedReview")}</p>
          <h2>{reportLabel(selected, (itemDetail ?? selectedItem)?.reportNumber ?? result?.reports.find((report) => report.id === selected)?.reportNumber)}</h2></div>
          <button type="button" aria-label={t("review.close")} onClick={() => {
            if (callWindow) { window.close(); return; }
            setSelected(null); setSelectedItem(null); setSelectedReportItemId(null); setItemDetail(null);
            setDetail(null); setDraftDetail(null); setCommentDraft(""); setCommentPending(null);
          }}>×</button></header>
        <ReviewTabs id="review-detail" label={t("review.detail")} value={detailTab} onChange={setDetailTab}
          options={(["findings", "history"] as const).map((value) => ({ value, label: t(value === "findings" ? "review.documentFindings" : "review.workspace.history") }))} />
        {detailError && <p role="alert">{t("review.detailUnavailable")}</p>}
        {!viewDetail && !detailError && <p role="status">{t("review.detailLoading")}</p>}
        {workflowError && <p role="alert">{t(workflowError === "conflict" ? "review.workflowConflict" : "review.workflowUnavailable")}</p>}
        {claimError && <p role="alert">{t(claimError === "conflict" ? "review.claimConflict" : "review.claimUnavailable")}</p>}
        {viewDetail && <>
          {draftDetail && <><h3>{t("review.overdueDraft")}</h3><p>{t("review.overdueDeadline")}: {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draftDetail.deadlineAt))}</p></>}
          <div {...panel("review-detail", "findings", detailTab)}>
          {itemDetail && <>
                  {itemDetail.canComment && <div>
                    <label>{t("review.entryType")} <select value={entryKind} onChange={(event) => { setEntryKind(event.target.value as "comment" | "finding"); setCommentPending(null); }}>
                      <option value="comment">{t("review.commentLabel")}</option><option value="finding">{t("review.documentFindings")}</option>
                    </select></label>
                    <label>{t(entryKind === "finding" ? "review.documentFindings" : "review.commentLabel")} <textarea value={commentDraft} maxLength={4000}
                      onChange={(event) => { setCommentDraft(event.target.value); setCommentPending(null); }} /></label>
                    <button type="button" disabled={commentBusy || !commentDraft.trim()}
                      onClick={() => void sendComment(itemDetail)}>{t(entryKind === "finding" ? "review.saveFindings" : "review.sendComment")}</button>
                  </div>}
            {commentError && <p role="alert">{t(`review.commentError.${commentError}`)}</p>}
            {commentDraft.trim() && <p role="status">{t("review.saveEntryFirst")}</p>}
          </>}

          {(selectedItem || itemDetail) && <section aria-label={t("review.findings")}><h3>{t("review.findings")}</h3>
            {itemDetail?.recoveryReason && <p role="alert">{t("review.recovered")}</p>}
            <p>{t("review.assignee")}: {itemDetail?.assigneeId ?
              (itemDetail.assigneeId === session.user.id ? t("review.assignedToYou") : (itemDetail.assigneeName ?? t("review.workspace.reviewer"))) : t("review.unassigned")}</p>
            {itemDetail && !itemDetail.assigneeId && itemDetail.status === "new" && session.capabilities?.includes("review:all") &&
              <button type="button" disabled={!!claiming} onClick={() => void claim(itemDetail)}>{t("review.claim")}</button>}
            {itemDetail && session.capabilities?.includes("review:admin") && <details className="review-assignment"><summary>{t("review.assignReviewer")}</summary><div>
              <label>{t("review.assignReviewer")}{" "}<select value={assignmentTarget}
                onChange={(event) => setAssignmentTarget(event.target.value)}>
                <option value="">{t("review.unassigned")}</option>
                {itemReviewers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
              </select></label>
              <button type="button" disabled={assignmentTarget === (itemDetail.assigneeId ?? "")}
                onClick={() => void assign(itemDetail)}>{t("review.saveAssignment")}</button>
            </div></details>}
            {itemDetail && <><p>{t("review.status")}: {t(`review.${itemDetail.status === "in-review" ? "inReview" : itemDetail.status === "awaiting-clinician" ? "awaitingClinician" : itemDetail.status}`)}</p>
              {itemDetail.resolutionReason === "resolved-by-signing" && <p>{t("review.resolvedBySigning")}</p>}
              {itemDetail.resolutionReason === "closed-exceptionally" && <p>
                {t("review.closedExceptionally")}: {t(`review.exception.${itemDetail.exceptionCode}`)}</p>}
              {!!itemDetail.overdueHistory?.length && <ol>{itemDetail.overdueHistory.map((event) =>
                <li key={event.itemVersion}>{t(`review.overdueHistory.${event.action}`)}
                  {event.reasonCode && <>: {t(`review.exception.${event.reasonCode}`)}</>}
                  {event.actorId && <> · <code>{event.actorId}</code></>}
                  {" · "}{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.recordedAt))}</li>)}</ol>}
              {itemDetail.reopened && <p role="status">{t("review.reopened")}</p>}
              {itemDetail.clearancePending && <p role="status">{t("review.clearancePending")}</p>}
              {itemDetail.closureReason && <p>{t("review.automaticClosure")}</p>}
              {itemDetail.kind === "overdue-unsigned" && itemDetail.status !== "completed" &&
                session.capabilities?.includes("review:admin") && <div className="review-controls">
                  <label>{t("review.exceptionReason")} <select value={exceptionCode}
                    onChange={(event) => setExceptionCode(event.target.value as ReviewOverdueExceptionCode | "")}>
                    <option value="">{t("review.chooseExceptionReason")}</option>
                    {(["duplicate-follow-up", "report-not-required", "administrative-exception"] as const).map((code) =>
                      <option key={code} value={code}>{t(`review.exception.${code}`)}</option>)}</select></label>
                  <button type="button" disabled={!exceptionCode || workflowBusy || !!commentDraft.trim()}
                    onClick={() => void closeOverdueException(itemDetail)}>{t("review.closeExceptionally")}</button>
                </div>}
              {itemDetail.outcome && <p>{t("review.outcomeChoice")}: {itemDetail.outcome.label} — {itemDetail.outcome.meaning}</p>}
              {itemDetail.assigneeId === session.user.id && <div className="review-controls">
                {itemDetail.status === "new" && <button type="button" disabled={workflowBusy || !!commentDraft.trim()}
                  onClick={() => void progress(itemDetail, "in-review")}>{t("review.startReview")}</button>}
                {itemDetail.status === "in-review" && <button type="button" disabled={workflowBusy || !!commentDraft.trim()}
                  onClick={() => void progress(itemDetail, "awaiting-clinician")}>{t("review.awaitClinician")}</button>}
                {itemDetail.status === "awaiting-clinician" && <button type="button" disabled={workflowBusy || !!commentDraft.trim()}
                  onClick={() => void progress(itemDetail, "in-review")}>{t("review.resumeReview")}</button>}
                {itemDetail.kind !== "overdue-unsigned" && ["in-review", "awaiting-clinician", "completed"].includes(itemDetail.status) && <>
                  <label>{t("review.outcomeChoice")} <select value={completionOutcomeId}
                    onChange={(event) => setCompletionOutcomeId(event.target.value)}>
                    <option value="">{t("review.chooseOutcome")}</option>
                    {outcomes.filter((option) => option.active).map((option) =>
                      <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
                  <button className="review-primary" type="button" disabled={workflowBusy || !!commentDraft.trim() || !completionOutcomeId}
                    onClick={() => void progress(itemDetail, "completed")}>
                    {t(itemDetail.status === "completed" ? "review.changeOutcome" : "review.complete")}</button>
                </>}
              </div>}
            </>}
            {itemDetail && itemDetail.status !== "completed" && (administrator || itemDetail.assigneeId === session.user.id) && <div className="review-controls">
              <label>{t("review.furtherReviewer")} <select value={handoffTarget} onChange={(event) => setHandoffTarget(event.target.value)}>
                <option value="">{t("review.chooseReviewer")}</option>
                {itemReviewers.filter((user) => user.id !== session.user.id && user.id !== itemDetail.assigneeId).map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
              </select></label>
              <button type="button" disabled={!handoffTarget || !!commentDraft.trim() || commentBusy} onClick={() => void assign(itemDetail, true)}>{t("review.forward")}</button>
              {assignmentMessage && <p role="status">{assignmentMessage}</p>}
            </div>}
            <p>{t("review.criterion")}: {criterionLabel((itemDetail ?? selectedItem)!)}</p>
            <ul>{(itemDetail ?? selectedItem)!.findings.map((finding, index) => <li key={index}>
              {finding.message}
              <small className="review-age">{viewDetail.values.find((value) => value.elementId === finding.primaryTarget.elementId)?.label ?? finding.primaryTarget.elementId}</small>
            </li>)}</ul></section>}

            {!selectedItem && !itemDetail && <p>{t("review.workspace.chooseFinding")}</p>}

          </div>
          <div {...panel("review-detail", "history", detailTab)}>
{itemDetail ? <>
              <section aria-label={t("review.discussionHeading")}><h4>{t("review.discussionHeading")}</h4>
                {itemDetail.commentsRestricted ? <p>{t("review.discussionRestricted")}</p> : <>
                  {(itemDetail.comments ?? []).length === 0 ? <p>{t("review.discussionEmpty")}</p> :
                    <ol>{(itemDetail.comments ?? []).map((comment) => <li key={comment.id}>
                      <strong>{comment.actorName}</strong>{comment.kind === "finding" && <span className="review-badge">{t("review.documentFindings")}</span>} <time dateTime={comment.recordedAt}>
                        {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.recordedAt))}
                      </time><p>{comment.body}</p>
                    </li>)}</ol>}


            </>}
                {commentError && <p role="alert">{t(`review.commentError.${commentError}`)}</p>}
              </section>
          </> : <p>{t("review.workspace.chooseFinding")}</p>}

            {itemDetail && <section><h4>{t("review.assignmentHistory")}</h4>
              {itemDetail.assignmentHistory.length === 0 ? <p>{t("review.noAssignmentHistory")}</p> :
                <ol>{itemDetail.assignmentHistory.map((event) => <li key={event.commandId}>
                  {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.assignedAt))}: {t(`review.assignmentAction.${event.action ?? "claimed"}`)} {event.assigneeId === session.user.id ? t("review.assignedToYou") : event.assigneeId ? <code>{event.assigneeId}</code> : t("review.unassigned")}
                </li>)}</ol>}</section>}
{itemDetail && <>              <section><h4>{t("review.progressHistory")}</h4>
                {!itemDetail.progressHistory?.length ? <p>{t("review.noProgressHistory")}</p> :
                  <ol>{itemDetail.progressHistory.map((event) => <li key={event.commandId}>
                    {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.recordedAt))}: {t(`review.${event.status === "in-review" ? "inReview" : event.status === "awaiting-clinician" ? "awaitingClinician" : event.status}`)}
                    {event.outcome && <> — {event.outcome.label}: {event.outcome.meaning}</>}
                    {event.reason && <> — {t(`review.progressReason.${event.reason}`)}</>}
                    {" · "}{event.actorId ? <code>{event.actorId}</code> : t("review.systemActor")}
                  </li>)}</ol>}</section>
              <section><h4>{t("review.amendmentHistory")}</h4>
                {!itemDetail.amendmentHistory?.length ? <p>{t("review.noAmendmentHistory")}</p> :
                  <ol>{itemDetail.amendmentHistory.map((event) => <li key={event.evaluationId}>
                    {t("review.amendmentSequence", { sequence: event.amendmentSequence })}: {t(`review.amendmentAction.${event.action}`)}
                    {" · "}{t("review.ruleVersion")}: <code>{event.validationVersionId}</code>
                    {event.findings.map((finding, index) => <p key={index}>{finding.message}</p>)}
                    {event.changes.length > 0 && <ul>{event.changes.map((change, index) => <li key={index}>
                      {t(`review.inputChange.${change.change}`)}: {change.elementId ?? t("review.groupMembership")}
                      {change.groupInstanceId && <> / <code>{change.groupInstanceId}</code></>}
                    </li>)}</ul>}
                  </li>)}</ol>}
              </section>
</>}
          </div>
        </>}
      </aside>}
    </div>
    </>}
  </main>;
}

function ReviewValues({ values }: { values: ReviewSignedReport["values"] }) {
  return values.length > 0 && <dl>{values.map((value) => <div key={value.id}>
    <dt>{value.label}{value.ordinal > 0 ? ` #${value.ordinal + 1}` : ""}</dt>
    <dd>{value.codeDisplay ?? value.absenceDisplay ?? String(value.value ?? "—")}</dd>
  </div>)}</dl>;
}

function ReviewNote({ note, reportId, dataset, language }: { note: ReportNote; reportId: string;
  dataset: "real" | "synthetic"; language: AgencyLanguage }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  const t = (key: string) => resolveMessage(language, key);
  const load = async () => {
    if (note.type === "text") return;
    const url = apiRequestUrl(`/api/review/reports/${reportId}/${note.type}/${note.id}/content?dataset=${dataset}`);
    if (!url) return;
    try {
      const response = await fetch(url, browserRequestInit());
      if (!response.ok) throw new Error(String(response.status));
      setMediaUrl(URL.createObjectURL(await response.blob())); setError(false);
    } catch { setError(true); }
  };
  return <article>
    <p>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.capturedAt))}</p>
    {note.type === "text" ? <p>{note.content}</p> : <>
      {note.caption && <p>{note.caption}</p>}
      <button type="button" onClick={() => void load()}>{note.type === "photo" ? t("review.openPhoto") : t("review.playAudio")}</button>
      {error && <p role="alert">{t("review.mediaUnavailable")}</p>}
      {mediaUrl && (note.type === "photo" ? <img src={mediaUrl} alt={note.caption ?? t("review.photo")} /> :
        <audio src={mediaUrl} controls />)}
    </>}
  </article>;
}
