"use client";
import { MetricEvidence } from "./metric-evidence";

import type { ClinicianSession, ReviewAttentionKind, ReviewAttentionResponse, ReviewOverdueDraft, ReviewSignedReport,
  ReviewQueueResponse, ReviewQueueItem, ReviewItemDetail, ReviewCriterionRoute,
  ReviewEligibleReviewer, ReviewOutcomeOption, ReviewOverdueExceptionCode, ReviewBulkResult } from "@open-triage/contracts";
import { useEffect, useRef, useState } from "react";
import { useAvailableHeight } from "./use-available-height";
import { activateListRow } from "./list-row-action";
import { listAccessRemoved } from "../app/list-refresh";
import { useUnsavedChanges, confirmDiscardChanges } from "./unsaved-changes";
import { ReviewCriterionHelp } from "./review-criterion-help";
import { ReviewTabs } from "./review-tabs";
import { ReviewReport } from "./review-report";
import { ReviewStatusBadge } from "./review-status-badge";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { AnalyticsWorkspace } from "./analytics-workspace";

type ReviewAction = "comment" | "assign" | "complete" | "await" | "resume" | "exception";

export function ReviewShell({ session, language, online, attention, onAttentionRefresh, callWindow, onOpenSettings }: {
  onOpenSettings?: (section: "routing" | "backlog") => void;
  callWindow?: { reportId: string; itemId?: string; dataset: "real" | "synthetic" };
  session: ClinicianSession;
  language: AgencyLanguage;
  online: boolean;
  attention: ReviewAttentionResponse | null;
  onAttentionRefresh: (dataset: "real" | "synthetic") => void;
}) {
  const dataset = callWindow?.dataset ?? (session.capabilities?.includes("clinical:demo") ? "synthetic" : "real");
  const administrator = session.capabilities?.includes("review:admin") ?? false;
  const queueCard = useAvailableHeight<HTMLElement>(64);
  const queueScroll = useRef<HTMLDivElement>(null);
  const queuePosition = useRef({ x: 0, y: 0, tableX: 0, tableY: 0, cardY: 0 });
  const [tab, setTab] = useState<"queue" | "analysis">("queue");
  const [detailTab, setDetailTab] = useState<"findings" | "summary" | "history">("findings");
  const [fullReportOpen, setFullReportOpen] = useState(!!callWindow);
  const [fullFindingsOpen, setFullFindingsOpen] = useState(true);
  const reportToolbar = useRef<HTMLElement>(null);
  const reportTrigger = useRef<HTMLElement | null>(null);
  const [assignment, setAssignment] = useState<"all" | "mine" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [loadedQueueScope, setLoadedQueueScope] = useState("");
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
  const [refresh, setRefresh] = useState(0);
  const [queueRefresh, setQueueRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(callWindow?.reportId ?? null);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [selectedReportItemId, setSelectedReportItemId] = useState<string | null>(callWindow?.itemId ?? null);
  const selectedItemId = selectedItem?.id ?? selectedReportItemId;
  const [itemDetail, setItemDetail] = useState<ReviewItemDetail | null>(null);
  const [itemError, setItemError] = useState(false);

  const [reviewAction, setReviewAction] = useState<ReviewAction>("comment");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
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
  const [itemReviewersFor, setItemReviewersFor] = useState<string | null>(null);
  const [reviewersError, setReviewersError] = useState(false);
  const [itemReviewersError, setItemReviewersError] = useState(false);
  const [outcomesError, setOutcomesError] = useState(false);
  const [outcomes, setOutcomes] = useState<ReviewOutcomeOption[]>([]);
  const [completionOutcomeId, setCompletionOutcomeId] = useState("");
  const [workflowError, setWorkflowError] = useState<"conflict" | "unavailable" | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [exceptionCode, setExceptionCode] = useState<ReviewOverdueExceptionCode | "">("");
  const [detail, setDetail] = useState<ReviewSignedReport | null>(null);
  const [draftDetail, setDraftDetail] = useState<ReviewOverdueDraft | null>(null);
  const currentItem = itemDetail ?? selectedItem;
  // Queue entries already tell us which endpoint to use. Only direct item links
  // need the item request before choosing between a signed report and a draft.
  const reportSource = selectedItemId && !currentItem ? (detail ? "signed" : null) :
    currentItem?.kind === "overdue-unsigned" && !currentItem.signedAt ? "draft" : "signed";
  const [detailError, setDetailError] = useState(false);
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

  useEffect(() => {
    if (!online || callWindow || tab !== "queue" || fullReportOpen) return;
    // Refresh the visible queue promptly without reloading report details or analysis.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setQueueRefresh((value) => value + 1);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [online, callWindow, tab, fullReportOpen]);

  const closingNeedsAssignment = !!itemDetail && itemDetail.assigneeId !== session.user.id;
  const canAssignToSelf = administrator && !itemReviewersError && itemReviewersFor === selectedItemId &&
    itemReviewers.some((reviewer) => reviewer.id === session.user.id);
  const actionOptions: Array<{ value: ReviewAction; label: string; submitLabel?: string }> = [{ value: "comment", label: t("review.commentLabel"), submitLabel: t("review.sendComment") }];
  if (itemDetail) {
    if (administrator) actionOptions.push({ value: "assign", label: t("review.assignReviewer"),
      submitLabel: itemDetail.status === "completed" ? t("review.reopenAndAssign") : t("review.assignReviewer") });
    if (itemDetail.assigneeId === session.user.id) {
      if (["new", "in-review"].includes(itemDetail.status)) actionOptions.push({ value: "await", label: t("review.awaitClinician") });
      if (itemDetail.status === "awaiting-clinician") actionOptions.push({ value: "resume", label: t("review.resumeReview") });
    }
    if (itemDetail.kind !== "overdue-unsigned" && (itemDetail.assigneeId === session.user.id || administrator))
      actionOptions.push({ value: "complete", label: t(itemDetail.status === "completed" ? "review.changeOutcome" : "review.closeReview"),
        submitLabel: t(itemDetail.status === "completed" ? "review.changeOutcome" : "review.closeReview") });
    if (itemDetail.kind === "overdue-unsigned" && itemDetail.status !== "completed" && administrator)
      actionOptions.push({ value: "exception", label: t("review.closeExceptionally") });
  }
  const selectedAction = actionOptions.find((option) => option.value === reviewAction) ?? actionOptions[0]!;
  const activeAction = selectedAction.value;
  const entryKind: "comment" | "finding" = activeAction === "complete" ? "finding" : "comment";
  const actionReviewers = (itemReviewersFor === selectedItemId ? itemReviewers : []).filter((user) =>
    itemDetail?.status === "completed" || user.id !== itemDetail?.assigneeId);
  const actionInvalid = !itemDetail ||
    itemError || (activeAction === "assign" && itemReviewersError) || (activeAction === "complete" && outcomesError) ||
    (activeAction === "comment" && (!itemDetail.canComment || !commentDraft.trim())) ||
    (!!commentDraft.trim() && !itemDetail.canComment) ||
    (activeAction === "assign" && !actionReviewers.some((user) => user.id === handoffTarget)) ||
    (activeAction === "complete" && closingNeedsAssignment && !canAssignToSelf) ||
    (activeAction === "complete" && !outcomes.some((option) => option.active && option.id === completionOutcomeId)) ||
    (activeAction === "exception" && !exceptionCode);
  const findingsDirty = !!commentDraft.trim() || reviewAction !== "comment";

  function resetFindingsAction() {
    setReviewAction("comment"); setHandoffTarget(""); setCompletionOutcomeId(""); setExceptionCode("");
    setCommentDraft(""); setCommentPending(null); setActionNotice(null);
  }

  useUnsavedChanges(findingsDirty);

  function selectReport(reportId: string, item?: ReviewQueueItem, full = false) {
    if (actionBusy || (findingsDirty && !confirmDiscardChanges(true))) return;
    if (reportId === selected && item?.id === selectedItemId && (detailError || itemError)) setRefresh((value) => value + 1);
    if (full && !fullReportOpen) queuePosition.current = { x: window.scrollX, y: window.scrollY,
      tableX: queueScroll.current?.scrollLeft ?? 0, tableY: queueScroll.current?.scrollTop ?? 0,
      cardY: queueCard.current?.scrollTop ?? 0 };
    reportTrigger.current = item ? document.getElementById(`review-view-${item.id}`) : null;
    setSelected(reportId); setSelectedItem(item ?? null); setSelectedReportItemId(item?.id ?? null);
    if (item?.id !== selectedItemId) setItemDetail(null);
    setItemError(false);
    if (reportId !== selected) { setDetail(null); setDraftDetail(null); }
    setDetailError(false); setDetailTab("findings"); setFullReportOpen(full); setFullFindingsOpen(true);
    resetFindingsAction(); setCommentError(null); setWorkflowError(null); setClaimError(null);
  }

  const bulkScopeKey = JSON.stringify([dataset, queuePage, priority, status, attentionFilter, criterion, queueFrom, queueTo, assignment, search]);
  const queueScopeCurrent = loadedQueueScope === bulkScopeKey;
  const activeBulkSelection = bulkSelection.key === loadedQueueScope ? bulkSelection.items : {};

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
      if (!controller.signal.aborted) { setQueue(next); setLoadedQueueScope(bulkScopeKey); setQueueError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setQueue(null);
      setQueueError(true);
    } });
    return () => controller.abort();
  }, [dataset, online, queuePage, priority, status, attentionFilter, criterion, queueFrom, queueTo, assignment, search, refresh, queueRefresh, callWindow, tab, bulkScopeKey]);

  useEffect(() => { if (!callWindow) onAttentionRefresh(dataset); }, [dataset, refresh, onAttentionRefresh, callWindow]);

  function showAttention(kind: ReviewAttentionKind | "") {
    setAttentionFilter(kind); setPriority(""); setStatus(""); setCriterion("");
    setQueueFrom(""); setQueueTo(""); setQueuePage(1);
    setTab("queue"); setAssignment("all"); setSearch("");
  }

  useEffect(() => {
    if (!online || !selected || reportSource !== "signed") return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/reports/${selected}?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewSignedReport;
      if (!controller.signal.aborted) { setDetail(next); setDetailError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setDetail(null);
      setDetailError(true);
    } });
    return () => controller.abort();
  }, [dataset, online, selected, reportSource, refresh]);

  useEffect(() => {
    if (!online || !selectedItemId || reportSource !== "draft") return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/items/${selectedItemId}/draft?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      if (!controller.signal.aborted) { setDraftDetail(await response.json() as ReviewOverdueDraft); setDetailError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setDraftDetail(null);
      setDetailError(true);
    } });
    return () => controller.abort();
  }, [dataset, online, selectedItemId, reportSource, refresh]);

  useEffect(() => {
    if (!online || !selectedItemId) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/items/${selectedItemId}?dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      if (!controller.signal.aborted) { setItemDetail(next); setItemError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setItemDetail(null);
      setItemError(true);
    } });
    return () => controller.abort();
  }, [dataset, online, selectedItemId, refresh]);

  useEffect(() => {
    if (!online || callWindow || !administrator) return;
    const controller = new AbortController();
    const url = apiRequestUrl("/api/review/routes");
    if (!url) return;
    const reviewersUrl = apiRequestUrl("/api/review/eligible-reviewers");
    if (!reviewersUrl) return;
    void Promise.all([fetch(url, browserRequestInit({ signal: controller.signal })),
      fetch(reviewersUrl, browserRequestInit({ signal: controller.signal }))]).then(async ([response, reviewerResponse]) => {
      if (!response.ok || !reviewerResponse.ok) throw new Error(String(!response.ok ? response.status : reviewerResponse.status));
      const [configured, eligible] = await Promise.all([
        response.json() as Promise<ReviewCriterionRoute[]>, reviewerResponse.json() as Promise<ReviewEligibleReviewer[]>]);
      if (!controller.signal.aborted) { setRoutes(configured); setReviewers(eligible); setReviewersError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) { setRoutes(null); setReviewers([]); }
      setReviewersError(true);
    } });
    return () => controller.abort();
  }, [online, refresh, administrator, callWindow]);

  useEffect(() => {
    if (!online || !selectedItemId || !administrator) return;
    const controller = new AbortController();
    const url = apiRequestUrl(`/api/review/eligible-reviewers?itemId=${selectedItemId}&dataset=${dataset}`);
    if (!url) return;
    void fetch(url, browserRequestInit({ signal: controller.signal })).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const eligible = await response.json() as ReviewEligibleReviewer[];
      if (!controller.signal.aborted) { setItemReviewers(eligible); setItemReviewersFor(selectedItemId); setItemReviewersError(false); }
    }).catch((cause) => { if (!controller.signal.aborted) {
      if (listAccessRemoved(cause)) setItemReviewers([]);
      setItemReviewersError(true);
    } });
    return () => controller.abort();
  }, [online, selectedItemId, dataset, refresh, administrator]);

  useEffect(() => {
    if (!online) return;
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
  }, [online, refresh]);

  async function submitReviewAction(item: ReviewItemDetail) {
    if (actionBusy || workflowBusy || actionInvalid) return;
    setActionBusy(true); setActionNotice(null); setWorkflowError(null); setCommentError(null);
    let commentSaved = false;
    try {
      let current = item;
      if (activeAction === "complete" && closingNeedsAssignment) {
        const url = apiRequestUrl(`/api/review/items/${current.id}/assign`);
        if (!url) throw new Error("Review API is unavailable");
        const response = await fetch(url, browserRequestInit({ method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: current.version,
            dataset, assigneeId: session.user.id }) }));
        if (response.status === 409) { setWorkflowError("conflict"); return; }
        if (!response.ok) throw new Error(String(response.status));
        current = await response.json() as ReviewItemDetail;
        setItemDetail(current); setSelectedItem(current);
      }
      if (commentDraft.trim()) {
        const next = await sendComment(current);
        if (!next) return;
        current = next; commentSaved = true;
      }
      if (activeAction !== "comment") {
        const endpoint = activeAction === "assign" ? "assign" : activeAction === "exception" ? "close-exceptionally" : "progress";
        const url = apiRequestUrl(`/api/review/items/${current.id}/${endpoint}`);
        if (!url) throw new Error("Review API is unavailable");
        const response = await fetch(url, browserRequestInit({ method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: current.version, dataset,
            ...(activeAction === "assign" ? { assigneeId: handoffTarget } :
              activeAction === "exception" ? { reasonCode: exceptionCode } :
                { status: activeAction === "complete" ? "completed" : activeAction === "await" ? "awaiting-clinician" : "in-review",
                  ...(activeAction === "complete" ? { outcomeOptionId: completionOutcomeId } : {}) }) }) }));
        if (response.status === 409) {
          setWorkflowError("conflict");
          if (commentSaved) setActionNotice(t("review.commentSavedActionFailed"));
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const next = await response.json() as ReviewItemDetail;
        setItemDetail(next); setSelectedItem(next);
      }
      resetFindingsAction(); setActionNotice(t("review.actionSaved"));
    } catch {
      setWorkflowError("unavailable");
      if (commentSaved) setActionNotice(t("review.commentSavedActionFailed"));
    } finally {
      setActionBusy(false); setRefresh((value) => value + 1);
    }
  }

  async function sendComment(item: ReviewItemDetail) {
    const body = commentDraft.trim();
    const url = apiRequestUrl(`/api/review/items/${item.id}/comments`);
    if (!url || !body || commentBusy) return null;
    const command = commentPending?.itemId === item.id && commentPending.body === body && commentPending.kind === entryKind
      ? commentPending : { commandId: crypto.randomUUID(), expectedVersion: item.version, itemId: item.id, body, kind: entryKind };
    setCommentPending(command); setCommentBusy(true); setCommentError(null);
    try {
      const response = await fetch(url, browserRequestInit({ method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
        body: JSON.stringify({ commandId: command.commandId, expectedVersion: command.expectedVersion,
          dataset, body, kind: command.kind }) }));
      if (response.status === 409) { setCommentPending(null); setCommentError("conflict");
        setRefresh((value) => value + 1); return null; }
      if (response.status === 403) { setCommentPending(null); setCommentError("denied");
        setRefresh((value) => value + 1); return null; }
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as ReviewItemDetail;
      setItemDetail(next); if (selectedItem?.id === item.id) setSelectedItem(next);
      setCommentDraft(""); setCommentPending(null);
      return next;
    } catch { setCommentError("unavailable"); return null; }
    finally { setCommentBusy(false); }
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
      if (selectedItem?.id === item.id) { setSelectedItem(next); setItemDetail(next); }
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

  const viewDetail = reportSource === "signed" ? detail : (draftDetail ? { ...draftDetail, amendmentSequence: 0,
    reviewItems: [] as NonNullable<ReviewSignedReport["reviewItems"]> } : null);
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
  const closeReport = () => {
    if (callWindow) window.close();
    else {
      setFullReportOpen(false); setFullFindingsOpen(true);
      requestAnimationFrame(() => {
        if (queueScroll.current) { queueScroll.current.scrollTop = queuePosition.current.tableY; queueScroll.current.scrollLeft = queuePosition.current.tableX; }
        if (queueCard.current) queueCard.current.scrollTop = queuePosition.current.cardY;
        window.scrollTo(queuePosition.current.x, queuePosition.current.y);
        reportTrigger.current?.focus({ preventScroll: true });
      });
    }
  };
  const closeFindings = () => { setFullFindingsOpen(false); document.getElementById("review-findings-toggle")?.focus(); };
  return <main className="review-workspace" aria-label={t("navigation.review")}>
    {callWindow ? <header className="review-heading review-card">
      <h1 id="review-heading">{t("navigation.review")}</h1>
      <button type="button" onClick={() => window.close()}>{t("review.close")}</button>
    </header> : <div className="review-workspace-selector"><ReviewTabs id="review-main" label={t("navigation.review")}
      value={tab} onChange={(next) => {
        if (tab === "queue") queuePosition.current = { x: window.scrollX, y: window.scrollY,
          tableX: queueScroll.current?.scrollLeft ?? 0, tableY: queueScroll.current?.scrollTop ?? 0,
          cardY: queueCard.current?.scrollTop ?? 0 };
        setTab(next);
        if (next === "queue") requestAnimationFrame(() => {
          if (queueScroll.current) { queueScroll.current.scrollTop = queuePosition.current.tableY; queueScroll.current.scrollLeft = queuePosition.current.tableX; }
          if (queueCard.current) queueCard.current.scrollTop = queuePosition.current.cardY;
          window.scrollTo(queuePosition.current.x, queuePosition.current.y);
        });
      }} options={[{ value: "queue", label: t("navigation.review") }, { value: "analysis", label: t("analytics.title") }]} /></div>}
    {!callWindow && <div {...panel("review-main", "analysis", tab)}>
      <AnalyticsWorkspace key={`${session.user.id}:${session.organization.id}:${dataset}:${[...(session.capabilities ?? [])].sort().join(",")}`}
        session={session} language={language} online={online} active={tab === "analysis"} />
    </div>}
    {!online ? <p role="status" className="review-card">{t("review.offline")}</p> : <>
    <div {...(!callWindow ? panel("review-main", "queue", tab) : {})} className={`review-content${selected ? " has-inspector" : ""}${fullReportOpen ? ` review-call-content${fullFindingsOpen ? " has-findings" : ""}` : ""}`}>
      {!callWindow && <div className="review-queue-panels" hidden={fullReportOpen}>
      <div role="region" aria-labelledby="review-queue-heading">
        <div className="review-work-filters" role="group" aria-label={t("review.workspace.workFilters")}>
          {(["all", "mine", "unassigned"] as const).map((value) => <button key={value} type="button"
            aria-pressed={assignment === value && !attentionFilter} onClick={() => {
              setAssignment(value); setAttentionFilter(""); setQueuePage(1);
            }}>{t(`review.workspace.${value}`)} <span className="review-count-badge">{queue?.assignmentCounts?.[value] ?? "—"}</span></button>)}
          {attention && <div className="review-attention-links">
            {administrator && !!attention.unavailableAssignees && <button type="button" onClick={() => showAttention("unavailable-assignees")}>{t("review.attentionUnavailable", { count: attention.unavailableAssignees })}</button>}
            {administrator && !!attention.unavailableRoutes && <button type="button" onClick={() => onOpenSettings?.("routing")}>{t("review.attentionRoutes", { count: attention.unavailableRoutes })}</button>}
            {administrator && !!attention.processingFailures && <button type="button" onClick={() => onOpenSettings?.("backlog")}>{t("review.attentionFailures", { count: attention.processingFailures })}</button>}
          </div>}
        </div>
      <section ref={queueCard} className="review-card review-queue-card" aria-labelledby="review-queue-heading">
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
            <option value="">{t("review.all")}</option>
            <option value="incomplete">{t("review.incomplete")}</option><option value="new">{t("review.new")}</option>
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
        {queue && !queueScopeCurrent && !queueError && <p role="status">{t("list.refreshRetained")}</p>}
        {queueError && <p role="alert">{t("review.queueUnavailable")}{queue && ` ${t("list.refreshRetained")}`}</p>}
        {(queueError || reviewersError) && <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("list.retry")}</button>}
        {reviewersError && <p role="alert">{t("review.routingUnavailable")}{reviewers.length > 0 && ` ${t("list.refreshRetained")}`}</p>}
        {claimError && <p role="alert">{t(claimError === "conflict" ? "review.claimConflict" : "review.claimUnavailable")}</p>}
        {workflowError && <p role="alert">{t(workflowError === "conflict" ? "review.workflowConflict" : "review.workflowUnavailable")}</p>}
        {queue && <><p>{t("review.queueCount", { count: queue.total })}</p>
          {(session.capabilities?.includes("review:all") || session.capabilities?.includes("review:admin")) &&
            <section className="review-bulk" aria-label={t("review.workspace.bulkActions")}><div className="review-controls">
              <button type="button" disabled={!queueScopeCurrent} onClick={() => setBulkSelection({ key: loadedQueueScope, items: Object.fromEntries(
                queue.items.map((item) => [item.id, item.version])) })}>{t("review.bulkSelectPage")}</button>
              <button type="button" onClick={() => setBulkSelection({ key: loadedQueueScope, items: {} })}>{t("review.bulkClearSelection")}</button>
              <span>{t("review.bulkSelected", { count: Object.keys(activeBulkSelection).length })}</span>
              {session.capabilities?.includes("review:all") && <button type="button"
                disabled={!queueScopeCurrent || queueError || !Object.keys(activeBulkSelection).length || bulkBusy}
                onClick={() => void runBulk("claim")}>{t("review.bulkClaim")}</button>}
              {session.capabilities?.includes("review:admin") && <>
                <label>{t("review.bulkAssignee")} <select value={bulkAssignee}
                  onChange={(event) => setBulkAssignee(event.target.value)}>
                  <option value="">{t("review.chooseReviewer")}</option>
                  {reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName}</option>)}
                </select></label>
                <button type="button" disabled={!queueScopeCurrent || queueError || reviewersError || !Object.keys(activeBulkSelection).length || !bulkAssignee || bulkBusy}
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
          {queue.items.length === 0 ? <p>{t("review.queueEmpty")}</p> : <div ref={queueScroll} className="review-table-scroll" tabIndex={0} role="region" aria-label={t("review.queue")}>
            <table className="review-queue-table" aria-labelledby="review-queue-heading">
              <thead><tr>
                {["review.workspace.select", "review.report", "review.workspace.reviewReason", "review.priority",
                  "review.status", "review.assignee", "review.age", "review.workspace.actions"].map((key) =>
                  <th key={key} scope="col">{t(key)}</th>)}
              </tr></thead><tbody>
            {queue.items.map((item) => <tr key={item.id} className="review-queue-row"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button, input, a, label")) return;
                selectReport(item.reportId, item);
              }}>
              <td><input type="checkbox" disabled={!queueScopeCurrent} aria-label={t("review.bulkSelectItem", { id: item.id })}
                checked={Object.hasOwn(activeBulkSelection, item.id)} onChange={(event) => {
                  setBulkSelection((previous) => {
                    const next = previous.key === bulkScopeKey ? { ...previous.items } : {};
                    if (event.target.checked) next[item.id] = item.version;
                    else delete next[item.id];
                    return { key: bulkScopeKey, items: next };
                  });
                }} /></td>
              <td><strong>{reportLabel(item.reportId, item.reportNumber)}</strong></td>
              <td><ReviewCriterionHelp id={`review-reason-${item.id}`} label={criterionLabel(item)}
                description={item.criterionDescription ?? item.findings.map((finding) => finding.message).join(" · ")} /></td>
              <td><span className={`review-badge priority-${item.priority}`}>{t(`review.${item.priority}`)}</span></td>
              <td><ReviewStatusBadge item={item} language={language} /></td>
              <td>{item.assigneeId ? item.assigneeId === session.user.id ? t("review.assignedToYou") : item.assigneeName ?? t("review.workspace.reviewer") : t("review.unassigned")}</td>
              <td>{ageLabel(item.firstMatchedAt)}</td>
              <td><div className="review-row-actions"><button id={`review-view-${item.id}`} type="button" aria-label={t("review.workspace.viewReview", { report: reportLabel(item.reportId, item.reportNumber) })}
                aria-expanded={fullReportOpen && selectedItemId === item.id} aria-controls={fullReportOpen ? "review-full-report" : undefined}
                onClick={() => selectReport(item.reportId, item, true)}>{t("review.workspace.view")}</button>
                {!item.assigneeId && ["new", "in-review"].includes(item.status) && session.capabilities?.includes("review:all") && <button type="button" disabled={!!claiming} onClick={() => void claim(item)}>{t("review.claim")}</button>}</div></td>
            </tr>)}
            </tbody></table>
          </div>}
          <nav className="review-pagination" aria-label={t("review.queuePages")}>
            <button type="button" disabled={queue.page === 1} onClick={() => setQueuePage(queue.page - 1)}>{t("review.previous")}</button>
            <span>{t("review.page", { page: queue.page })}</span>
            <button type="button" disabled={queue.page * queue.pageSize >= queue.total} onClick={() => setQueuePage(queue.page + 1)}>{t("review.next")}</button>
          </nav></>}
      </section>

      </div>

      </div>}
      {fullReportOpen && <article id="review-full-report" className="review-call-form" aria-label={t("review.workspace.report")}>
        {detailError && viewDetail && <><p role="alert">{t("review.detailUnavailable")} {t("list.refreshRetained")}</p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("list.retry")}</button></>}
        {viewDetail ? <ReviewReport key={viewDetail.id} report={viewDetail} full language={language} dataset={dataset}
          toolbarRef={reportToolbar} findingsOpen={fullFindingsOpen} onToggleFindings={() => setFullFindingsOpen(!fullFindingsOpen)}
          onClose={closeReport} /> : <>
          <header ref={reportToolbar} className="review-report-toolbar">
            <button type="button" className="review-report-close" aria-label={t("review.workspace.closeReport")} onClick={closeReport}>×</button>
          </header>
          {detailError ? <p role="alert">{t("review.detailUnavailable")}</p> : <p role="status">{t("review.detailLoading")}</p>}
        </>}
      </article>}
      {selected && (!fullReportOpen || fullFindingsOpen) && <WorkspaceSidebar id="review-inspector"
        className={`review-card review-inspector${fullReportOpen ? " review-findings-sidebar" : ""}`} label={t("review.detail")}
        docked={fullReportOpen && !!viewDetail} anchor={reportToolbar} onEscape={fullReportOpen ? closeFindings : undefined}>
        <header className="review-inspector-heading"><div><p className="eyebrow">{t("review.workspace.selectedReview")}</p>
          <h2>{reportLabel(selected, (itemDetail ?? selectedItem)?.reportNumber)}</h2></div>
          <button type="button" aria-label={t("review.close")} onClick={() => {
            if (fullReportOpen) { closeFindings(); return; }
            if (callWindow) { window.close(); return; }
            setSelected(null); setSelectedItem(null); setSelectedReportItemId(null); setItemDetail(null); setFullReportOpen(false);
            setDetail(null); setDraftDetail(null); resetFindingsAction();
          }} disabled={actionBusy || findingsDirty}>×</button></header>
        {!!viewDetail?.reviewItems?.length && <section className="review-report-items" aria-label={t("review.reportItems")}><h3>{t("review.reportItems")}</h3><ul>
          {viewDetail.reviewItems.map((reportItem) => {
            const item = reportItem.id === itemDetail?.id ? { ...reportItem, ...itemDetail } : reportItem;
            return <li key={item.id}><div className="review-report-item-row" onClick={activateListRow}><span>{criterionLabel(item)}</span><ReviewStatusBadge item={item} language={language} />
              <button type="button" data-list-row-action aria-label={t("review.selectItem", { criterion: criterionLabel(item) })}
              aria-current={selectedItemId === item.id ? "true" : undefined}
              disabled={(actionBusy || findingsDirty) && selectedItemId !== item.id}
              onClick={() => {
                if (selectedItemId === item.id) return;
                setSelectedItem(null); setSelectedReportItemId(item.id); setItemDetail(null); setItemError(false);
                setDraftDetail(null); setDetailError(false); setDetailTab("findings");
                resetFindingsAction(); setCommentError(null); setWorkflowError(null); setClaimError(null);
              }}>
              {t("review.workspace.select")}
            </button></div>
              {selectedItemId === item.id && <small className="review-active-item">{t("review.workspace.activeItem")}</small>}
              {item.outcome && <p>{item.outcome.label}: {item.outcome.meaning}</p>}
              {item.clearancePending && <p>{t("review.clearancePending")}</p>}
              {item.closureReason && <p>{t("review.automaticClosure")}</p>}
            </li>;
          })}
        </ul></section>}
        <ReviewTabs id="review-detail" label={t("review.detail")} value={detailTab} onChange={setDetailTab}
          options={(["findings", "summary", "history"] as const).map((value) => ({ value, label: t(`review.workspace.${value === "findings" ? "actions" : value}`) }))} />
        {itemError && <p role="alert">{t("review.itemUnavailable")}</p>}
        {(itemReviewersError || outcomesError) && <p role="alert">{t("list.optionsUnavailable")}</p>}
        {(itemError || itemReviewersError || outcomesError || detailError) && <button type="button"
          onClick={() => setRefresh((value) => value + 1)}>{t("list.retry")}</button>}
        {detailError && !fullReportOpen && <p role="alert">{t("review.detailUnavailable")}</p>}
        {!viewDetail && !detailError && !fullReportOpen && <p role="status">{t("review.detailLoading")}</p>}
        {commentError && <p role="alert">{t(`review.commentError.${commentError}`)}</p>}
        {workflowError && <p role="alert">{t(workflowError === "conflict" ? "review.workflowConflict" : "review.workflowUnavailable")}</p>}
        {claimError && <p role="alert">{t(claimError === "conflict" ? "review.claimConflict" : "review.claimUnavailable")}</p>}
        {viewDetail && <>
          {draftDetail && <><h3>{t("review.overdueDraft")}</h3><p>{t("review.overdueDeadline")}: {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draftDetail.deadlineAt))}</p></>}
          <div {...panel("review-detail", "findings", detailTab)}>
          {itemDetail?.findings.map((finding, index) => <MetricEvidence key={index} evidence={finding.metricEvidence} language={language} />)}
          {itemDetail && <form className="review-action-form" aria-label={t("review.actionForm")} aria-busy={actionBusy}
            onSubmit={(event) => { event.preventDefault(); void submitReviewAction(itemDetail); }}>
            <label>{t("review.action")} <select value={activeAction} disabled={actionBusy}
              onChange={(event) => { setReviewAction(event.target.value as ReviewAction);
                setCommentError(null); setWorkflowError(null); setActionNotice(null); }}>
              {actionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            {activeAction === "assign" && <label>{t("review.workspace.reviewer")} <select value={handoffTarget} disabled={actionBusy}
              onChange={(event) => setHandoffTarget(event.target.value)}>
              <option value="">{t("review.chooseReviewer")}</option>
              {actionReviewers.map((user) =>
                <option key={user.id} value={user.id}>{user.documentingClinician
                  ? t("review.documentingClinician", { name: user.displayName }) : user.displayName}</option>)}
            </select></label>}
            {activeAction === "assign" && itemDetail.status === "completed" && <p>{t("review.reopenByAssignmentHelp")}</p>}
            {activeAction === "complete" && <label>{t("review.outcomeChoice")} <select value={completionOutcomeId} disabled={actionBusy}
              onChange={(event) => setCompletionOutcomeId(event.target.value)}>
              <option value="">{t("review.chooseOutcome")}</option>
              {outcomes.filter((option) => option.active).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select></label>}
            {activeAction === "complete" && closingNeedsAssignment && <p>{t(canAssignToSelf
              ? "review.closeAssignsToYou" : "review.closeRequiresEligibleReviewer")}</p>}
            {activeAction === "exception" && <label>{t("review.exceptionReason")} <select value={exceptionCode} disabled={actionBusy}
              onChange={(event) => setExceptionCode(event.target.value as ReviewOverdueExceptionCode | "")}>
              <option value="">{t("review.chooseExceptionReason")}</option>
              {(["duplicate-follow-up", "report-not-required", "administrative-exception"] as const).map((code) =>
                <option key={code} value={code}>{t(`review.exception.${code}`)}</option>)}
            </select></label>}
            <label>{t(entryKind === "finding" ? "review.documentFindings" : "review.commentLabel")}
              <textarea value={commentDraft} maxLength={4000} disabled={actionBusy || !itemDetail.canComment}
                aria-describedby={!itemDetail.canComment ? "review-comment-restricted" : activeAction !== "comment" ? "review-comment-optional" : undefined}
                onChange={(event) => { setCommentDraft(event.target.value); setCommentPending(null); setActionNotice(null); }} />
            </label>
            {!itemDetail.canComment ? <p id="review-comment-restricted">{t(itemDetail.commentsRestricted ? "review.discussionRestricted" : "review.commentUnavailable")}</p> :
              activeAction !== "comment" && <p id="review-comment-optional">{t("review.optionalActionComment")}</p>}
            <button className="review-primary" type="submit" disabled={actionBusy || workflowBusy || actionInvalid}>
              {actionBusy ? t("settings.saving") : selectedAction.submitLabel ?? selectedAction.label}
            </button>
            {actionNotice && <p role="status">{actionNotice}</p>}
          </form>}

            {!selectedItem && !itemDetail && <p>{t("review.workspace.chooseFinding")}</p>}

          </div>
          <div {...panel("review-detail", "summary", detailTab)}>
            <button type="button" className="review-primary" disabled={fullReportOpen} onClick={() => { setFullReportOpen(true); setFullFindingsOpen(true); }}>{t("review.workspace.openReport")}</button>
            {!draftDetail && <p>{t("review.amendments", { count: viewDetail.amendmentSequence })}</p>}
            {detailTab === "summary" && <ReviewReport key={viewDetail.id} report={viewDetail} language={language} dataset={dataset} />}
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
              </section>
          </> : <p>{t("review.workspace.chooseFinding")}</p>}

            {itemDetail?.kind === "overdue-unsigned" && <section><h4>{t("review.overdueUnsigned")}</h4>
              {itemDetail.resolutionReason === "resolved-by-signing" && <p>{t("review.resolvedBySigning")}</p>}
              {itemDetail.resolutionReason === "closed-exceptionally" && <p>
                {t("review.closedExceptionally")}: {t(`review.exception.${itemDetail.exceptionCode}`)}</p>}
              {!!itemDetail.overdueHistory?.length && <ol>{itemDetail.overdueHistory.map((event) =>
                <li key={event.itemVersion}>{t(`review.overdueHistory.${event.action}`)}
                  {event.reasonCode && <>: {t(`review.exception.${event.reasonCode}`)}</>}
                  {event.actorId && <> · <code>{event.actorId}</code></>}
                  {" · "}{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.recordedAt))}</li>)}</ol>}
            </section>}

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
                    {event.findings.map((finding, index) => <div key={index}><p>{finding.message}</p><MetricEvidence evidence={finding.metricEvidence} language={language} /></div>)}
                    {event.changes.length > 0 && <ul>{event.changes.map((change, index) => <li key={index}>
                      {t(`review.inputChange.${change.change}`)}: {change.elementId ?? t("review.groupMembership")}
                      {change.groupInstanceId && <> / <code>{change.groupInstanceId}</code></>}
                    </li>)}</ul>}
                  </li>)}</ol>}
              </section>
</>}
          </div>
        </>}
      </WorkspaceSidebar>}
    </div>
    </>}
  </main>;
}
