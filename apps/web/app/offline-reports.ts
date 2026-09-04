import type { ClinicianSession, OpenCall, OpenAssignmentResponse, ReopenOpenCallResponse } from "@open-triage/contracts";
import type { ActiveDraftReport, SaveDraftReportCommand, SavedDraftReport } from "./draft-report";

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
type OpenedCallContext = {
  readonly callNumber: string;
  readonly dispatchedAt?: string;
  readonly dispatchReason?: string | null;
  readonly chiefComplaint?: string | null;
  readonly unit?: { readonly callSign: string };
};

function read(storage: StoragePort): CachedOpenReport[] {
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
  storage.setItem(OFFLINE_REPORTS_STORAGE_KEY, JSON.stringify(reports));
}

function replace(storage: StoragePort, report: CachedOpenReport): CachedOpenReport {
  const reports = read(storage).filter((candidate) => candidate.report.id !== report.report.id);
  write(storage, [...reports, report]);
  return report;
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
  return replace(storage, {
    report: {
      ...existing?.report,
      ...opened.report,
      callNumber,
      ...(typeof call === "string" ? {} : {
        ...(call.dispatchedAt ? { dispatchedAt: call.dispatchedAt } : {}),
        ...(call.dispatchReason !== undefined ? { dispatchReason: call.dispatchReason } : {}),
        ...(call.chiefComplaint !== undefined ? { chiefComplaint: call.chiefComplaint } : {}),
        ...(call.unit?.callSign ? { unitCallSign: call.unit.callSign } : {}),
      }),
    },
    ownerUserId: session.user.id,
    callNumber,
    workflowState: "open",
    syncStatus: existing?.queuedChanges.length ? "pending" : "saved",
    lastSavedAt: existing?.lastSavedAt ?? now.toISOString(),
    validationErrorCount: existing?.validationErrorCount ?? 0,
    localValidationErrorCount: existing?.localValidationErrorCount,
    queuedChanges: existing?.queuedChanges ?? [],
  });
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
    ...(opened.chiefComplaint !== undefined ? { chiefComplaint: opened.chiefComplaint } : {}),
    ...(opened.unitCallSign ? { unit: { callSign: opened.unitCallSign } } : {}),
  }, now);
}

export function cacheOpenCallSummary(storage: StoragePort, session: ClinicianSession, call: OpenCall): CachedOpenReport {
  const existing = read(storage).find((candidate) => candidate.report.id === call.reportId);
  return replace(storage, {
    report: {
      ...existing?.report,
      id: call.reportId,
      revision: existing?.queuedChanges.length ? existing.report.revision : call.revision,
      formVersionId: call.formVersionId,
      callNumber: call.callNumber,
      documentingUserId: session.user.id,
      catalogReleaseId: call.catalogReleaseId,
      status: "draft",
      ...(call.dispatchedAt ? { dispatchedAt: call.dispatchedAt } : {}),
      ...(call.dispatchReason !== undefined ? { dispatchReason: call.dispatchReason } : {}),
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
  if (!existing) return;
  replace(storage, { ...existing, validationErrorCount: count, localValidationErrorCount: count });
}

export function cachedOpenReports(storage: StoragePort, ownerUserId: string): CachedOpenReport[] {
  return read(storage)
    .filter((candidate) => candidate.ownerUserId === ownerUserId
      && candidate.report.documentingUserId === ownerUserId
      && candidate.workflowState === "open")
    .sort((left, right) => right.lastSavedAt.localeCompare(left.lastSavedAt));
}

/** Removes completed report metadata only after every local command was accepted. */
export function purgeCompletedOfflineReports(storage: StoragePort, reportIds: ReadonlyArray<string>): void {
  if (!reportIds.length) return;
  const completed = new Set(reportIds);
  write(storage, read(storage).filter((candidate) => !completed.has(candidate.report.id) || candidate.queuedChanges.length > 0));
}

export function removeSignedOfflineReport(storage: StoragePort, reportId: string): void {
  write(storage, read(storage).filter((candidate) => candidate.report.id !== reportId));
}

export function cachedOpenCalls(storage: StoragePort, ownerUserId: string): OpenCall[] {
  return cachedOpenReports(storage, ownerUserId).map((cached) => ({
    reportId: cached.report.id,
    callNumber: cached.callNumber,
    lastSavedAt: cached.lastSavedAt,
    syncStatus: cached.syncStatus,
    validationErrorCount: cached.localValidationErrorCount ?? cached.validationErrorCount,
    revision: cached.report.revision,
    formVersionId: cached.report.formVersionId,
    catalogReleaseId: cached.report.catalogReleaseId,
    ...(cached.report.dispatchedAt ? { dispatchedAt: cached.report.dispatchedAt } : {}),
    ...(cached.report.dispatchReason !== undefined ? { dispatchReason: cached.report.dispatchReason } : {}),
    ...(cached.report.chiefComplaint !== undefined ? { chiefComplaint: cached.report.chiefComplaint } : {}),
    ...(cached.report.unitCallSign ? { unitCallSign: cached.report.unitCallSign } : {}),
    ...(cached.report.agencyTimeZone ? { agencyTimeZone: cached.report.agencyTimeZone } : {}),
  }));
}

export function cachedReopenResponse(storage: StoragePort, ownerUserId: string, reportId: string): ReopenOpenCallResponse | null {
  const cached = cachedOpenReports(storage, ownerUserId).find((candidate) => candidate.report.id === reportId);
  if (!cached?.report.document) return null;
  return { callNumber: cached.callNumber, report: { ...cached.report, document: cached.report.document, status: "draft" } };
}

export function queueDraftChange(storage: StoragePort, reportId: string, command: SaveDraftReportCommand): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) throw new Error(`Report ${reportId} is not cached for offline use`);
  const queued = [...cached.queuedChanges];
  const last = queued.at(-1);
  if (last && !last.attempted) queued[queued.length - 1] = { command, attempted: false };
  else queued.push({ command, attempted: false });
  replace(storage, { ...cached, syncStatus: "pending", queuedChanges: queued });
}

export function nextDraftChange(storage: StoragePort, reportId: string): QueuedDraftChange | null {
  return read(storage).find((candidate) => candidate.report.id === reportId)?.queuedChanges[0] ?? null;
}

export function markDraftChangeAttempted(storage: StoragePort, reportId: string, commandId: string): void {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  if (!cached) return;
  replace(storage, { ...cached, queuedChanges: cached.queuedChanges.map((queued) => queued.command.commandId === commandId ? { ...queued, attempted: true } : queued) });
}

export function acceptDraftChange(storage: StoragePort, reportId: string, commandId: string, saved: SavedDraftReport, now = new Date()): void {
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

export function expectedRevisionForNextChange(storage: StoragePort, reportId: string, fallbackRevision: number): number {
  const cached = read(storage).find((candidate) => candidate.report.id === reportId);
  const last = cached?.queuedChanges.at(-1);
  if (last && !last.attempted) return last.command.expectedRevision;
  return (cached?.report.revision ?? fallbackRevision) + (cached?.queuedChanges.length ?? 0);
}
