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
  clearProtectedRuntimeReports,
  discardQueuedDraftChanges,
  expectedRevisionForNextChange,
  markDraftChangeAttempted,
  nextDraftChange,
  OFFLINE_REPORTS_STORAGE_KEY,
  purgeCompletedOfflineReports,
  purgeExpiredOfflineReports,
  queueDraftChange,
  queuedDraftChanges,
  rebaseQueuedDraftChanges,
  reconcileCachedActiveReport,
  reconcileServerOpenReports,
  restoreRecoveredReport,
  saveCachedValidationErrorCount,
} from "../app/offline-reports";
import type { SaveDraftReportCommand } from "../app/draft-report";
import { compiledValidationBundleSha256, type CompiledValidationBundle } from "@open-triage/contracts";

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

test("unchanged summaries, documents and validation counts do not rewrite persisted reports", () => {
  const values = memoryStorage();
  let writes = 0;
  const storage = { ...values, setItem(key: string, value: string) { writes += 1; values.setItem(key, value); } };
  cacheOpenedReport(storage, session, opened, "CALL-51");
  cacheOpenedReport(storage, session, { ...opened, report: { ...opened.report, id: "report-2" } }, "CALL-52");
  // The first summary fills optional server-summary metadata.
  const summary = cachedOpenCalls(storage, session.user.id).find(({ reportId }) => reportId === opened.report.id)!;
  cacheOpenCallSummary(storage, session, summary);
  saveCachedValidationErrorCount(storage, opened.report.id, 3);
  const before = writes;
  for (let poll = 0; poll < 5; poll += 1) {
    cacheOpenCallSummary(storage, session, summary);
    cacheLocalReportDocument(storage, opened.report.id, structuredClone(opened.report.document));
    saveCachedValidationErrorCount(storage, opened.report.id, 3);
  }
  assert.equal(writes, before);
  assert.equal(cachedOpenReports(storage, session.user.id).length, 2);
  const edited = structuredClone(opened.report.document);
  const changed = { ...edited, encounter: { ...edited.encounter, updatedAt: "2026-09-04T12:00:00.000Z" } };
  cacheLocalReportDocument(storage, opened.report.id, changed);
  assert.equal(writes, before + 1);
  assert.equal(cachedReopenResponse(storage, session.user.id, opened.report.id)?.report.document.encounter.updatedAt, changed.encounter.updatedAt);
});

test("browser cache snapshots and queued commands cannot mutate the private synchronization baseline", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  clearProtectedRuntimeReports();
  try {
    const storage = memoryStorage();
    const initial = cacheOpenedReport(storage, session, opened, "CALL-51");
    const unchanged = cacheOpenedReport(storage, session, opened, "CALL-51");
    Object.assign(initial.report.document!.encounter, { updatedAt: "mutated-first-return" });
    Object.assign(unchanged.report.document!.encounter, { updatedAt: "mutated-unchanged-return" });
    const listing = cachedOpenReports(storage, session.user.id);
    Object.assign(listing[0]!.report.document!.encounter, { updatedAt: "mutated-listing" });
    const reopened = cachedReopenResponse(storage, session.user.id, opened.report.id)!;
    Object.assign(reopened.report.document.encounter, { updatedAt: "mutated-reopen" });
    assert.equal(cachedReopenResponse(storage, session.user.id, opened.report.id)!.report.document.encounter.updatedAt,
      opened.report.document.encounter.updatedAt);

    queueDraftChange(storage, opened.report.id, command("private-command", 4));
    Object.assign(nextDraftChange(storage, opened.report.id)!.command, { expectedRevision: 99 });
    Object.assign(queuedDraftChanges(storage, opened.report.id)[0]!.command, { commandId: "mutated-command" });
    assert.equal(nextDraftChange(storage, opened.report.id)!.command.expectedRevision, 4);
    assert.equal(nextDraftChange(storage, opened.report.id)!.command.commandId, "private-command");
    assert.equal(storage.getItem(OFFLINE_REPORTS_STORAGE_KEY), null, "clinical data must not fall back to browser localStorage");
  } finally {
    clearProtectedRuntimeReports();
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("an opened report caches its pinned live rules, messages, targets, and integrity metadata for offline use", () => {
  const storage = memoryStorage();
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "validation-1", catalogReleaseId: "catalog-1", rules: [{
      schemaVersion: 1, languageVersion: "1.0.0", ruleId: "rule-1", validationVersionId: "validation-1",
      name: "Patient required", enabled: true, severity: "error", executionTargets: ["live"],
      primaryTarget: { elementId: "ePatient.02" }, message: "Document the patient name",
      assertion: { operator: "present", elementId: "ePatient.02" }, references: { elementIds: ["ePatient.02"], codes: [] },
    }] };
  const configured = { ...opened, report: { ...opened.report, validationVersionId: "validation-1",
    clinicalForm: { definition: { schemaVersion: 1 as const, sections: [] }, catalogFields: {}, validation: {
      versionId: "validation-1", compiledSha256: compiledValidationBundleSha256(bundle), bundle,
    } } } };
  cacheOpenedReport(storage, session, configured, "CALL-51");
  const offline = cachedReopenResponse(storage, session.user.id, opened.report.id)!.report.clinicalForm!.validation!;
  assert.equal(offline.compiledSha256, compiledValidationBundleSha256(bundle));
  assert.deepEqual(offline.bundle.rules[0]!.primaryTarget, { elementId: "ePatient.02" });
  assert.equal(offline.bundle.rules[0]!.message, "Document the patient name");
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

test("coalescing unsent deltas retains earlier fields and explicit removals", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  const first = { id: "first", elementId: "ePatient.03", groupInstanceId: "patient", ordinal: 0, value: { kind: "text" as const, value: "First" } };
  const second = { id: "second", elementId: "ePatient.02", groupInstanceId: "patient", ordinal: 0, value: { kind: "text" as const, value: "Last" } };
  queueDraftChange(storage, opened.report.id, { ...command("first-command", 4), occurrences: [first] });
  queueDraftChange(storage, opened.report.id, { ...command("second-command", 4), occurrences: [second] });
  assert.deepEqual(nextDraftChange(storage, opened.report.id)?.command.occurrences, [first, second]);
  const removed = { id: first.id, elementId: first.elementId, groupInstanceId: first.groupInstanceId, ordinal: 0, tombstone: true };
  queueDraftChange(storage, opened.report.id, { ...command("third-command", 4), occurrences: [removed] });
  assert.deepEqual(nextDraftChange(storage, opened.report.id)?.command.occurrences, [removed, second]);
  assert.equal(queuedDraftChanges(storage, opened.report.id).length, 1);
});

test("Populate cannot replace unsaved clinician work or absorb later ordinary edits", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("manual", 4));
  assert.equal(expectedRevisionForNextChange(storage, opened.report.id, 4, "populate"), 5);
  queueDraftChange(storage, opened.report.id, { ...command("populate", 5), demoAction: "populate" });
  assert.equal(expectedRevisionForNextChange(storage, opened.report.id, 4), 6);
  queueDraftChange(storage, opened.report.id, command("later-manual", 6));
  assert.deepEqual(queuedDraftChanges(storage, opened.report.id).map(({ command: item }) =>
    [item.commandId, item.demoAction, item.expectedRevision]),
  [["manual", undefined, 4], ["populate", "populate", 5], ["later-manual", undefined, 6]]);
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

test("queued draft snapshots expose every optimistic mutation in order", () => {
  const storage = memoryStorage();
  cacheOpenedReport(storage, session, opened, "CALL-51");
  queueDraftChange(storage, opened.report.id, command("command-1", 4));
  markDraftChangeAttempted(storage, opened.report.id, "command-1");
  queueDraftChange(storage, opened.report.id, command("command-2", 5));

  assert.deepEqual(queuedDraftChanges(storage, opened.report.id).map(({ command: queued }) => queued.commandId), [
    "command-1",
    "command-2",
  ]);
});

test("dispatch reconciliation retains every delta and rebases only unattempted commands", () => {
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

  const changes = queuedDraftChanges(storage, opened.report.id);
  assert.deepEqual(changes.map(({ command, attempted }) => [command.commandId, command.expectedRevision, attempted]),
    [["command-1", 4, true], ["command-2", 8, false]]);
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
