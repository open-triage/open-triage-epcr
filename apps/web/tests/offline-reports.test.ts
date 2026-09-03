import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession } from "@open-triage/contracts";
import {
  acceptDraftChange,
  cacheOpenedReport,
  cachedOpenCalls,
  cachedOpenReports,
  cachedReopenResponse,
  expectedRevisionForNextChange,
  markDraftChangeAttempted,
  nextDraftChange,
  OFFLINE_REPORTS_STORAGE_KEY,
  purgeCompletedOfflineReports,
  queueDraftChange,
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
  cacheOpenedReport(storage, session, opened, "CALL-51", new Date("2026-09-03T12:01:00.000Z"));
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  markDraftChangeAttempted(storage, opened.report.id, "command-1");

  const reloaded = memoryStorage(bytes);
  const cached = cachedOpenReports(reloaded, session.user.id)[0]!;
  assert.equal(cached.report.documentingUserId, session.user.id);
  assert.equal(cached.report.formVersionId, "pinned-form-version-7");
  assert.equal(cached.report.revision, 4);
  assert.equal(cached.workflowState, "open");
  assert.equal(cached.syncStatus, "pending");
  assert.equal(nextDraftChange(reloaded, opened.report.id)?.command.commandId, "command-1");
  assert.equal(cachedOpenCalls(reloaded, session.user.id)[0]?.syncStatus, "pending");
  assert.equal(cachedReopenResponse(reloaded, session.user.id, opened.report.id)?.callNumber, "CALL-51");
  assert.equal(cachedReopenResponse(reloaded, "different-clinician", opened.report.id), null);
  assert.ok(bytes.has(OFFLINE_REPORTS_STORAGE_KEY));
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
