import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession, EncounterDocument } from "@open-triage/contracts";
import syntheticEncounter from "../app/data/synthetic-encounter-document.json";
import {
  acceptDraftChange,
  cacheOpenCallSummary,
  cacheLocalReportDocument,
  cacheOpenedReport,
  cachedOpenCalls,
  cachedOpenReports,
  cachedReopenResponse,
  discardQueuedDraftChanges,
  expectedRevisionForNextChange,
  markDraftChangeAttempted,
  nextDraftChange,
  OFFLINE_REPORTS_STORAGE_KEY,
  purgeCompletedOfflineReports,
  purgeExpiredOfflineReports,
  queueDraftChange,
  rebaseQueuedDraftChanges,
  reconcileCachedActiveReport,
  reconcileServerOpenReports,
  restoreRecoveredReport,
  saveCachedValidationErrorCount,
} from "../app/offline-reports";
import type { SaveDraftReportCommand } from "../app/draft-report";

function memoryStorage(seed = new Map<string, string>()) {
  return {
    getItem(key: string) { return seed.get(key) ?? null; },
    setItem(key: string, value: string) { seed.set(key, value); },
  };
}

const session: ClinicianSession = {
  accessToken: "token",
  user: { id: "clinician-1", displayName: "Demo Clinician" },
  organization: { id: "org-1", name: "Demo EMS" },
  startedAt: "2026-09-03T12:00:00.000Z",
  expiresAt: "2026-09-03T20:00:00.000Z",
};

const opened = {
  assignmentId: "assignment-1",
  report: {
    id: "report-1",
    documentingUserId: session.user.id,
    formVersionId: "pinned-form-version-7",
    catalogReleaseId: "catalog-1",
    revision: 4,
    status: "draft" as const,
    document: syntheticEncounter as EncounterDocument,
  },
  replacementAssignment: null,
};

function command(commandId: string, expectedRevision: number): SaveDraftReportCommand {
  return {
    commandId,
    expectedRevision,
    authorId: session.user.id,
    deviceId: "web:report-1",
    clientTime: "2026-09-03T12:05:00.000Z",
    groups: [],
    occurrences: [],
  };
}

test("opened report identity, ownership, pinned form, revision, workflow and pending changes survive storage reload", () => {
  const bytes = new Map<string, string>();
  const storage = memoryStorage(bytes);
  cacheOpenedReport(storage, session, opened, {
    callNumber: "CALL-51",
    dispatchedAt: "2026-09-03T12:00:00.000Z",
    dispatchReason: "Breathing problem",
    dispatchPriority: { code: "2305003", display: "Emergent" },
    chiefComplaint: "Shortness of breath",
    unit: { callSign: "Medic 32" },
  }, new Date("2026-09-03T12:01:00.000Z"));
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  markDraftChangeAttempted(storage, opened.report.id, "command-1");

  const reloaded = memoryStorage(bytes);
  const cached = cachedOpenReports(reloaded, session.user.id)[0]!;
  assert.equal(cached.report.documentingUserId, session.user.id);
  assert.equal(cached.report.formVersionId, "pinned-form-version-7");
  assert.equal(cached.report.revision, 4);
  assert.equal(cached.report.dispatchedAt, "2026-09-03T12:00:00.000Z");
  assert.equal(cached.report.dispatchReason, "Breathing problem");
  assert.deepEqual(cached.report.dispatchPriority, { code: "2305003", display: "Emergent" });
  assert.equal(cached.report.unitCallSign, "Medic 32");
  assert.equal(cached.report.document?.groups.length, syntheticEncounter.groups.length);
  assert.equal(cached.workflowState, "open");
  assert.equal(cached.syncStatus, "pending");
  assert.equal(nextDraftChange(reloaded, opened.report.id)?.command.commandId, "command-1");
  assert.equal(cachedOpenCalls(reloaded, session.user.id)[0]?.syncStatus, "pending");
  assert.equal(cachedReopenResponse(reloaded, session.user.id, opened.report.id)?.callNumber, "CALL-51");
  assert.equal(cachedReopenResponse(reloaded, "different-clinician", opened.report.id), null);
  assert.ok(bytes.has(OFFLINE_REPORTS_STORAGE_KEY));
});

test("recovered ciphertext is admitted only for the selected report and authenticated owner", () => {
  const source = memoryStorage();
  const protectedReport = cacheOpenedReport(source, session, opened, "CALL-51");
  const target = memoryStorage();
  assert.equal(restoreRecoveredReport(target, session.user.id, opened.report.id, {
    schemaVersion: 1, report: protectedReport,
  }), true);
  assert.equal(cachedOpenReports(target, session.user.id)[0]?.report.id, opened.report.id);

  const otherTarget = memoryStorage();
  assert.equal(restoreRecoveredReport(otherTarget, "other-clinician", opened.report.id, {
    schemaVersion: 1, report: protectedReport,
  }), false);
  assert.deepEqual(cachedOpenReports(otherTarget, session.user.id), []);
  assert.equal(restoreRecoveredReport(otherTarget, session.user.id, "different-report", {
    schemaVersion: 1, report: protectedReport,
  }), false);
});

test("a locally edited canonical document makes an opened report self-contained for offline reopen", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  const edited = { ...opened.report.document, encounter: { ...opened.report.document.encounter, updatedAt: "2026-09-04T12:00:00.000Z" } };

  cacheLocalReportDocument(storage, opened.report.id, edited);

  assert.equal(cachedReopenResponse(storage, session.user.id, opened.report.id)?.report.document.encounter.updatedAt, "2026-09-04T12:00:00.000Z");
});

test("cached work is listable and reopenable only when both ownership fields match the clinician", () => {
  const bytes = new Map<string, string>();
  const storage = memoryStorage(bytes);
  cacheOpenedReport(storage, session, opened, "CALL-51");

  assert.equal(cachedOpenReports(storage, "clinician-2").length, 0);
  assert.equal(cachedReopenResponse(storage, "clinician-2", opened.report.id), null);

  const tampered = JSON.parse(bytes.get(OFFLINE_REPORTS_STORAGE_KEY)!) as Array<Record<string, unknown>>;
  tampered[0] = { ...tampered[0], ownerUserId: "clinician-2" };
  bytes.set(OFFLINE_REPORTS_STORAGE_KEY, JSON.stringify(tampered));

  assert.equal(cachedOpenReports(storage, "clinician-2").length, 0);
  assert.equal(cachedReopenResponse(storage, "clinician-2", opened.report.id), null);
});

test("reconnect replay keeps attempted command identities and advances queued revisions in order", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  markDraftChangeAttempted(storage, opened.report.id, "command-1");

  assert.equal(expectedRevisionForNextChange(storage, opened.report.id, 4), 5);
  queueDraftChange(storage, opened.report.id, command("command-2", 5));
  assert.equal(nextDraftChange(storage, opened.report.id)?.command.commandId, "command-1");

  acceptDraftChange(storage, opened.report.id, "command-1", { id: opened.report.id, revision: 5, status: "draft" });
  assert.equal(nextDraftChange(storage, opened.report.id)?.command.commandId, "command-2");
  acceptDraftChange(storage, opened.report.id, "command-2", { id: opened.report.id, revision: 6, status: "draft" });

  const cached = cachedOpenReports(storage, session.user.id)[0]!;
  assert.equal(cached.report.revision, 6);
  assert.equal(cached.syncStatus, "saved");
  assert.equal(nextDraftChange(storage, opened.report.id), null);
});

test("dispatch reconciliation rebases pending work and updates the offline report snapshot", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  markDraftChangeAttempted(storage, opened.report.id, "command-1");
  queueDraftChange(storage, opened.report.id, command("command-2", 5));
  rebaseQueuedDraftChanges(storage, opened.report.id, 7);
  reconcileCachedActiveReport(storage, opened.report.id, {
    reportId: opened.report.id, reportRevision: 7, dispatchRevision: 3,
    document: opened.report.document, dispatchConflicts: [], dispatchCancellation: null,
  }, opened.report.document);

  assert.equal(nextDraftChange(storage, opened.report.id)?.command.expectedRevision, 7);
  assert.equal(nextDraftChange(storage, opened.report.id)?.command.commandId, "command-2");
  assert.equal(nextDraftChange(storage, opened.report.id)?.attempted, false);
  assert.equal(cachedReopenResponse(storage, session.user.id, opened.report.id)?.report.revision, 7);
});

test("reconciliation retains an attempted command byte-for-byte for an exact retry", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  markDraftChangeAttempted(storage, opened.report.id, "command-1");

  const before = nextDraftChange(storage, opened.report.id);
  rebaseQueuedDraftChanges(storage, opened.report.id, 7);
  assert.deepEqual(nextDraftChange(storage, opened.report.id), before);
});

test("an explicitly discarded stale queue resets only that report to the server snapshot", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-1", 4));

  discardQueuedDraftChanges(storage, opened.report.id, 9, "2026-09-03T16:00:00.000Z");

  const cached = cachedOpenReports(storage, session.user.id)[0]!;
  assert.equal(cached.syncStatus, "saved");
  assert.equal(cached.report.revision, 9);
  assert.equal(cached.lastSavedAt, "2026-09-03T16:00:00.000Z");
  assert.equal(nextDraftChange(storage, opened.report.id), null);
});

test("completion purges accepted offline metadata but preserves pending commands for recovery", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  purgeCompletedOfflineReports(storage, [opened.report.id]);
  assert.equal(cachedOpenReports(storage, session.user.id).length, 0);

  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  purgeCompletedOfflineReports(storage, [opened.report.id]);
  assert.equal(nextDraftChange(storage, opened.report.id)?.command.commandId, "command-1");
});

test("generated report expiry removes its local document and queued work exactly at the boundary", () => {
  const storage = memoryStorage();
  const expiring = {
    ...opened,
    report: { ...opened.report, expiresAt: "2026-09-04T12:00:00.000Z" },
  };
  cacheOpenedReport(storage, session, expiring, "DEMO-51");
  queueDraftChange(storage, expiring.report.id, command("command-1", 4));

  assert.deepEqual(purgeExpiredOfflineReports(storage, new Date("2026-09-04T11:59:59.999Z")), []);
  assert.equal(nextDraftChange(storage, expiring.report.id)?.command.commandId, "command-1");
  assert.deepEqual(purgeExpiredOfflineReports(storage, new Date("2026-09-04T12:00:00.000Z")), [expiring.report.id]);
  assert.equal(nextDraftChange(storage, expiring.report.id), null);
  assert.equal(cachedReopenResponse(storage, session.user.id, expiring.report.id), null);
});

test("expiry cleanup leaves ordinary reports and their offline queues untouched", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-ordinary", 4));

  assert.deepEqual(purgeExpiredOfflineReports(storage, new Date("2099-01-01T00:00:00.000Z")), []);
  assert.equal(nextDraftChange(storage, opened.report.id)?.command.commandId, "command-ordinary");
});

test("an authoritative open-call refresh removes stale saved summaries but preserves pending work", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  const pending = {
    ...opened,
    report: { ...opened.report, id: "report-2" },
  };
  cacheOpenedReport(storage, session, pending, "CALL-52");
  queueDraftChange(storage, pending.report.id, command("command-pending", 4));

  assert.deepEqual(reconcileServerOpenReports(storage, session.user.id, []), [opened.report.id]);
  assert.deepEqual(cachedOpenCalls(storage, session.user.id).map(({ reportId }) => reportId), [pending.report.id]);
  assert.equal(nextDraftChange(storage, pending.report.id)?.command.commandId, "command-pending");
});

test("the current draft validation count survives open-call server refreshes", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  saveCachedValidationErrorCount(storage, opened.report.id, 3);

  cacheOpenCallSummary(storage, session, {
    reportId: opened.report.id,
    callNumber: "CALL-51",
    lastSavedAt: "2026-09-03T12:10:00.000Z",
    syncStatus: "saved",
    validationErrorCount: 0,
    revision: 5,
    formVersionId: opened.report.formVersionId,
    catalogReleaseId: opened.report.catalogReleaseId,
  });

  assert.equal(cachedOpenCalls(storage, session.user.id)[0]?.validationErrorCount, 3);
});

test("a server validation count is used until the form computes a local count", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");

  cacheOpenCallSummary(storage, session, {
    reportId: opened.report.id,
    callNumber: "CALL-51",
    lastSavedAt: "2026-09-03T12:10:00.000Z",
    syncStatus: "saved",
    validationErrorCount: 2,
    revision: 5,
    formVersionId: opened.report.formVersionId,
    catalogReleaseId: opened.report.catalogReleaseId,
  });

  assert.equal(cachedOpenCalls(storage, session.user.id)[0]?.validationErrorCount, 2);
});
