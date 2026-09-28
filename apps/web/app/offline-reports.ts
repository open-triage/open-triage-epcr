import type { ActiveReportResource, ClinicianSession, DispatchPriority, EncounterDocument, OpenCall, OpenAssignmentResponse, ReopenOpenCallResponse } from "@open-triage/contracts";
import type { ActiveDraftReport, RetainedSignedDraftAttempt, SaveDraftReportCommand, SavedDraftReport } from "./draft-report";
import { browserRequestConfiguration } from "./browser-api";
import { sameJsonValue } from "./json-values";
import { protectedStorageActive, removeProtectedReport, updateProtectedReport, type RecoveredProtectedPayload } from "./protected-clinical-storage";

export const OFFLINE_REPORTS_STORAGE_KEY = "open-triage:offline-reports-v1";

export interface QueuedDraftChange {
  readonly command: SaveDraftReportCommand;
  readonly attempted: boolean;
}

export interface CachedOpenReport {
  readonly report: ActiveDraftReport & {
    readonly documentingUserId: string;
    readonly catalogReleaseId: string;
  };
  readonly ownerUserId: string;
  readonly callNumber: string;
  readonly workflowState: "open";
  readonly syncStatus: "saved" | "pending";
  readonly lastSavedAt: string;
  readonly validationErrorCount: number;
  readonly localValidationErrorCount?: number;
  readonly queuedChanges: ReadonlyArray<QueuedDraftChange>;
}

type StoragePort = Pick<Storage, "getItem" | "setItem">;
let protectedRuntimeReports: CachedOpenReport[] = [];

/** Clears all decrypted report objects when the authenticated browser identity ends. */
export function clearProtectedRuntimeReports(): void {
  protectedRuntimeReports = [];
}
type OpenedCallContext = {
  readonly callNumber: string;
  readonly dispatchedAt?: string;
  readonly dispatchReason?: string | null;
  readonly dispatchPriority?: DispatchPriority | null;
  readonly chiefComplaint?: string | null;
  readonly unit?: { readonly callSign: string };
};

function read(storage: StoragePort): CachedOpenReport[] {
  if (typeof window !== "undefined") {
    // Internal updates are immutable. Clone at the public read boundary so a
    // list refresh does not copy every full document just to read summaries.
    return protectedRuntimeReports;
  }
  try {
    const value: unknown = JSON.parse(storage.getItem(OFFLINE_REPORTS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((candidate): candidate is CachedOpenReport => {
      if (!candidate || typeof candidate !== "object") return false;
      const record = candidate as Partial<CachedOpenReport>;
      return !!record.report && typeof record.report.id === "string" && typeof record.ownerUserId === "string"
        && typeof record.callNumber === "string" && Array.isArray(record.queuedChanges);
    });
  } catch {
    return [];
  }
}

function write(storage: StoragePort, reports: ReadonlyArray<CachedOpenReport>): void {
  if (typeof window !== "undefined") {
    const previous = new Map(protectedRuntimeReports.map((report) => [report.report.id, report]));
    const changed: CachedOpenReport[] = [];
    protectedRuntimeReports = reports.map((report) => {
      const existing = previous.get(report.report.id);
      if (existing && sameJsonValue(existing, report)) return existing;
      const snapshot = structuredClone(report);
      changed.push(snapshot);
      return snapshot;
    });
    if (browserRequestConfiguration().mode === "server") {
      // A summary refresh must not encrypt every other open report again.
      for (const report of changed) {
        if (protectedStorageActive(report.report.id)) updateProtectedReport(report.report.id, report);
      }
    }
    return;
  }
  const serialized = JSON.stringify(reports);
  if (storage.getItem(OFFLINE_REPORTS_STORAGE_KEY) !== serialized) storage.setItem(OFFLINE_REPORTS_STORAGE_KEY, serialized);
}

function replace(storage: StoragePort, report: CachedOpenReport): void {
  const reports = typeof window === "undefined" ? read(storage) : protectedRuntimeReports;
  const index = reports.findIndex((candidate) => candidate.report.id === report.report.id);
  if (index >= 0 && sameJsonValue(reports[index], report)) return;
  write(storage, index < 0 ? [...reports, report] : reports.map((candidate, position) => position === index ? report : candidate));
}

export function cacheOpenedReport(
  storage: StoragePort,
  session: ClinicianSession,
  opened: OpenAssignmentResponse,
  call: string | OpenedCallContext,
  now = new Date(),
): CachedOpenReport {
  const callNumber = typeof call === "string" ? call : call.callNumber;
  const existing = read(storage).find((candidate) => candidate.report.id === opened.report.id);
  const cached: CachedOpenReport = {
    report: {
      ...existing?.report,
      ...opened.report,
      callNumber,
      ...(typeof call === "string" ? {} : {
        ...(call.dispatchedAt ? { dispatchedAt: call.dispatchedAt } : {}),
        ...(call.dispatchReason !== undefined ? { dispatchReason: call.dispatchReason } : {}),
        ...(call.dispatchPriority !== undefined ? { dispatchPriority: call.dispatchPriority } : {}),
        ...(call.chiefComplaint !== undefined ? { chiefComplaint: call.chiefComplaint } : {}),
        ...(call.unit?.callSign ? { unitCallSign: call.unit.callSign } : {}),
      }),
      ...(existing?.queuedChanges.length && existing.report.document ? {
        revision: existing.report.revision,
        document: existing.report.document,
        dispatchConflicts: existing.report.dispatchConflicts ?? [],
      } : {}),
    },
    ownerUserId: session.user.id,
    callNumber,
    workflowState: "open",
    syncStatus: existing?.queuedChanges.length ? "pending" : "saved",
    lastSavedAt: existing?.lastSavedAt ?? now.toISOString(),
    validationErrorCount: existing?.validationErrorCount ?? 0,
    localValidationErrorCount: existing?.localValidationErrorCount,
    queuedChanges: existing?.queuedChanges ?? [],
  };
  replace(storage, cached);
  return structuredClone(cached);
}

export function restoreRecoveredReport(
  storage: StoragePort,
  ownerUserId: string,
  reportId: string,
  payload: RecoveredProtectedPayload,
): boolean {
  const candidate = payload.report;
  if (!candidate || typeof candidate !== "object") return false;
  const recovered = candidate as Partial<CachedOpenReport>;
  if (recovered.ownerUserId !== ownerUserId || recovered.workflowState !== "open" ||
      !recovered.report || recovered.report.id !== reportId ||
      recovered.report.documentingUserId !== ownerUserId || !Array.isArray(recovered.queuedChanges)) return false;
  replace(storage, recovered as CachedOpenReport);
  return true;
}

export function cacheReopenedReport(
  storage: StoragePort,
  session: ClinicianSession,
  opened: ReopenOpenCallResponse,
  now = new Date(),
): CachedOpenReport {
  return cacheOpenedReport(storage, session, { assignmentId: "cached-reopen", report: opened.report, replacementAssignment: null }, {
    callNumber: opened.callNumber,
    ...(opened.dispatchedAt ? { dispatchedAt: opened.dispatchedAt } : {}),
    ...(opened.dispatchReason !== undefined ? { dispatchReason: opened.dispatchReason } : {}),
    ...(opened.dispatchPriority !== undefined ? { dispatchPriority: opened.dispatchPriority } : {}),
    ...(opened.chiefComplaint !== undefined ? { chiefComplaint: opened.chiefComplaint } : {}),
    ...(opened.unitCallSign ? { unit: { callSign: opened.unitCallSign } } : {}),
  }, now);
}

export function cacheOpenCallSummary(storage: StoragePort, session: ClinicianSession, call: OpenCall): void {
  const existing = read(storage).find((candidate) => candidate.report.id === call.reportId);
  replace(storage, {
    report: {
      ...existing?.report,
      id: call.reportId,
      revision: existing?.queuedChanges.length ? existing.report.revision : call.revision,
      formVersionId: call.formVersionId,
      callNumber: call.callNumber,
      documentingUserId: session.user.id,
      catalogReleaseId: call.catalogReleaseId,
      status: "draft",
      demoMutable: call.demoMutable,
      ...(call.expiresAt ? { expiresAt: call.expiresAt } : {}),
      ...(call.dispatchedAt ? { dispatchedAt: call.dispatchedAt } : {}),
      ...(call.dispatchReason !== undefined ? { dispatchReason: call.dispatchReason } : {}),
      ...(call.dispatchPriority !== undefined ? { dispatchPriority: call.dispatchPriority } : {}),
      ...(call.chiefComplaint !== undefined ? { chiefComplaint: call.chiefComplaint } : {}),
      ...(call.unitCallSign ? { unitCallSign: call.unitCallSign } : {}),
      ...(call.agencyTimeZone ? { agencyTimeZone: call.agencyTimeZone } : {}),
    },
    ownerUserId: session.user.id,
    callNumber: call.callNumber,
    workflowState: "open",
    syncStatus: existing?.queuedChanges.length ? "pending" : "saved",
    lastSavedAt: existing?.queuedChanges.length ? existing.lastSavedAt : call.lastSavedAt,
    validationErrorCount: existing?.localValidationErrorCount ?? call.validationErrorCount,
    localValidationErrorCount: existing?.localValidationErrorCount,
    queuedChanges: existing?.queuedChanges ?? [],
  });
}

export function saveCachedValidationErrorCount(storage: StoragePort, reportId: string, count: number): void {
  const existing = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!existing || (existing.validationErrorCount === count && existing.localValidationErrorCount === count)) return;
  replace(storage, { ...existing, validationErrorCount: count, localValidationErrorCount: count });
}

/** Keeps the actionable offline report self-contained as the canonical document changes locally. */
export function cacheLocalReportDocument(storage: StoragePort, reportId: string, document: EncounterDocument): void {
  const existing = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!existing) return;
  replace(storage, { ...existing, report: { ...existing.report, document } });
}

function ownedReports(storage: StoragePort, ownerUserId: string): CachedOpenReport[] {
  return read(storage)
    .filter((candidate) => candidate.ownerUserId === ownerUserId
      && candidate.report.documentingUserId === ownerUserId
      && candidate.workflowState === "open")
    .sort((left, right) => right.lastSavedAt.localeCompare(left.lastSavedAt));
}

export function cachedOpenReports(storage: StoragePort, ownerUserId: string): CachedOpenReport[] {
  return structuredClone(ownedReports(storage, ownerUserId));
}

/**
 * Removes saved browser summaries that an authoritative server refresh no
 * longer returns. Pending offline work remains available for synchronization
 * (or an explicit server rejection) instead of being discarded here.
 */
export function reconcileServerOpenReports(
  storage: StoragePort,
  ownerUserId: string,
  serverReportIds: ReadonlyArray<string>,
): string[] {
  const serverIds = new Set(serverReportIds);
  const reports = read(storage);
  const removed = reports.filter((candidate) => candidate.ownerUserId === ownerUserId
    && candidate.report.documentingUserId === ownerUserId
    && candidate.workflowState === "open"
    && candidate.queuedChanges.length === 0
    && !serverIds.has(candidate.report.id));
  if (removed.length) {
    const removedIds = new Set(removed.map(({ report }) => report.id));
    write(storage, reports.filter((candidate) => !removedIds.has(candidate.report.id)));
  }
  return removed.map(({ report }) => report.id);
}

/** Removes generated synthetic reports, including queued work, at the published server deadline. */
export function purgeExpiredOfflineReports(storage: StoragePort, now = new Date()): string[] {
  const deadline = now.getTime();
  const reports = read(storage);
  const expired = reports.filter(({ report }) => report.expiresAt !== undefined
    && Date.parse(report.expiresAt) <= deadline).map(({ report }) => report.id);
  if (expired.length) {
    const ids = new Set(expired);
    write(storage, reports.filter(({ report }) => !ids.has(report.id)));
  }
  return expired;
}

/** Removes completed report metadata only after every local command was accepted. */
export function purgeCompletedOfflineReports(storage: StoragePort, reportIds: ReadonlyArray<string>): void {
  if (!reportIds.length) return;
  const completed = new Set(reportIds);
  write(storage, read(storage).filter((candidate) => !completed.has(candidate.report.id) || candidate.queuedChanges.length > 0));
}

export function removeSignedOfflineReport(storage: StoragePort, reportId: string): void {
  write(storage, read(storage).filter((candidate) => candidate.report.id !== reportId));
  if (typeof window !== "undefined") removeProtectedReport(reportId);
}

/** Removes all browser-held state after a server-confirmed draft deletion. */
export const removeOfflineReport = removeSignedOfflineReport;

export function cachedOpenCalls(storage: StoragePort, ownerUserId: string): OpenCall[] {
  return structuredClone(ownedReports(storage, ownerUserId).map((cached) => ({
    reportId: cached.report.id,
    callNumber: cached.callNumber,
    lastSavedAt: cached.lastSavedAt,
    syncStatus: cached.syncStatus,
    validationErrorCount: cached.localValidationErrorCount ?? cached.validationErrorCount,
    revision: cached.report.revision,
    formVersionId: cached.report.formVersionId,
    catalogReleaseId: cached.report.catalogReleaseId,
    demoMutable: cached.report.demoMutable === true,
    ...(cached.report.expiresAt ? { expiresAt: cached.report.expiresAt } : {}),
    ...(cached.report.dispatchedAt ? { dispatchedAt: cached.report.dispatchedAt } : {}),
    ...(cached.report.dispatchReason !== undefined ? { dispatchReason: cached.report.dispatchReason } : {}),
    ...(cached.report.dispatchPriority !== undefined ? { dispatchPriority: cached.report.dispatchPriority } : {}),
    ...(cached.report.chiefComplaint !== undefined ? { chiefComplaint: cached.report.chiefComplaint } : {}),
    ...(cached.report.unitCallSign ? { unitCallSign: cached.report.unitCallSign } : {}),
    ...(cached.report.agencyTimeZone ? { agencyTimeZone: cached.report.agencyTimeZone } : {}),
  })));
}

export function cachedReopenResponse(storage: StoragePort, ownerUserId: string, reportId: string): ReopenOpenCallResponse | null {
  const cached = structuredClone(ownedReports(storage, ownerUserId).find((candidate) => candidate.report.id === reportId));
  if (!cached?.report.document) return null;
  return { callNumber: cached.callNumber, report: { ...cached.report, document: cached.report.document, dispatchConflicts: cached.report.dispatchConflicts ?? [], status: "draft" } };
}

export function queueDraftChange(storage: StoragePort, reportId: string, command: SaveDraftReportCommand): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) throw new Error(`Report ${reportId} is not cached for offline use`);
  const queued = [...cached.queuedChanges];
  const last = queued.at(-1);
  if (last && !last.attempted && last.command.demoAction === command.demoAction) {
    // These are incremental deltas, not full snapshots. Preserve earlier edits
    // (including tombstones), and never fold clinician edits into a demo action.
    const merge = <T extends { id: string }>(previous: readonly T[], next: readonly T[]): T[] =>
      [...new Map([...previous, ...next].map((value) => [value.id, value])).values()];
    queued[queued.length - 1] = { command: { ...command,
      commandId: last.command.commandId, expectedRevision: last.command.expectedRevision,
      groups: merge(last.command.groups, command.groups),
      occurrences: merge(last.command.occurrences, command.occurrences),
    }, attempted: false };
  }
  else queued.push({ command, attempted: false });
  replace(storage, { ...cached, syncStatus: "pending", queuedChanges: queued });
}

export function nextDraftChange(storage: StoragePort, reportId: string): QueuedDraftChange | null {
  return structuredClone(read(storage).find((candidate) => candidate.report.id === reportId)?.queuedChanges[0] ?? null);
}

export function queuedDraftChanges(storage: StoragePort, reportId: string): ReadonlyArray<QueuedDraftChange> {
  return structuredClone(read(storage).find((candidate) => candidate.report.id === reportId)?.queuedChanges ?? []);
}

export function markDraftChangeAttempted(storage: StoragePort, reportId: string, commandId: string): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) return;
  replace(storage, { ...cached, queuedChanges: cached.queuedChanges.map((queued) => queued.command.commandId === commandId ? { ...queued, attempted: true } : queued) });
}

export function acceptDraftChange(
  storage: StoragePort,
  reportId: string,
  commandId: string,
  saved: SavedDraftReport | RetainedSignedDraftAttempt,
  now = new Date(),
): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) return;
  const queuedChanges = cached.queuedChanges.filter((queued) => queued.command.commandId !== commandId);
  replace(storage, {
    ...cached,
    report: { ...cached.report, revision: saved.revision },
    syncStatus: queuedChanges.length ? "pending" : "saved",
    lastSavedAt: now.toISOString(),
    queuedChanges,
  });
}

export function rebaseQueuedDraftChanges(storage: StoragePort, reportId: string, serverRevision: number): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached?.queuedChanges.length) return;
  replace(storage, {
    ...cached,
    report: { ...cached.report, revision: serverRevision },
    queuedChanges: cached.queuedChanges.map((queued, index) => queued.attempted ? queued : {
      command: { ...queued.command, expectedRevision: serverRevision + index }, attempted: false,
    }),
  });
}

export function reconcileCachedActiveReport(
  storage: StoragePort,
  reportId: string,
  resource: ActiveReportResource,
  document: EncounterDocument,
): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) return;
  replace(storage, {
    ...cached,
    report: {
      ...cached.report,
      revision: resource.reportRevision,
      document,
      dispatchConflicts: resource.dispatchConflicts,
      dispatchCancellation: resource.dispatchCancellation,
    },
  });
}

/** Explicitly abandons a known stale local queue and trusts the supplied server snapshot. */
export function discardQueuedDraftChanges(
  storage: StoragePort,
  reportId: string,
  serverRevision: number,
  serverSavedAt: string,
): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) return;
  replace(storage, {
    ...cached,
    report: { ...cached.report, revision: serverRevision },
    syncStatus: "saved",
    lastSavedAt: serverSavedAt,
    queuedChanges: [],
  });
}

export function expectedRevisionForNextChange(storage: StoragePort, reportId: string, fallbackRevision: number,
  demoAction?: SaveDraftReportCommand["demoAction"]): number {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  const last = cached?.queuedChanges.at(-1);
  if (last && !last.attempted && last.command.demoAction === demoAction) return last.command.expectedRevision;
  return (cached?.report.revision ?? fallbackRevision) + (cached?.queuedChanges.length ?? 0);
}

/** Keeps independently synchronized note revisions aligned with later form commands. */
export function advanceCachedReportRevision(storage: StoragePort, reportId: string, revision: number): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached || revision <= cached.report.revision) return;
  replace(storage, { ...cached, report: { ...cached.report, revision } });
}
