import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchCancellationNotice,
  createReportTextNote,
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SYNC_RETRY_MS,
  ACTIVE_REPORT_POLL_INTERVAL_MS,
  applyDraftMutationDelta,
  draftMutationDelta,
  draftChangesUrl,
  deleteDraftReport,
  deleteReportTextNote,
  demoActionMutationDelta,
  recoveryMutationBatches,
  reconciledDraftSyncStatus,
  DRAFT_CONFLICT_RECOVERY_LIMIT,
  DraftSaveRejectedError,
  encounterDocumentToDraftMutations,
  fetchActiveReport,
  saveDraftReport,
  shouldQueueInitialDraftSnapshot,
  signDraftReport,
  shellStateToDraftMutations,
  stableDraftId,
  updateReportTextNote,
} from "../app/draft-report";
import { INITIAL_SHELL_STATE, transitionShell } from "../app/standard-encounter";
import { removeRepeatingGroupOccurrence } from "../app/stationary-repeating-group";
import { populateStationaryDemoData } from "../app/stationary-demo-data";

const reportId = "42000000-0000-4000-8000-000000000013";

test("removing a populated vital set yields authorized clear mutations, including after recovery", () => {
  const populated = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
  const vital = populated.groups.find(({ id }) => id === "eVitals.VitalGroup")?.instances[0];
  assert.ok(vital);
  const removed = removeRepeatingGroupOccurrence(populated, "eVitals.VitalGroup", vital.instanceId);
  assert.equal(removed.ok, true);
  const baseline = encounterDocumentToDraftMutations(reportId, populated);
  const projected = encounterDocumentToDraftMutations(reportId, removed.document, baseline);
  const delta = draftMutationDelta(projected, baseline);
  const batches = recoveryMutationBatches(delta, baseline);
  const clear = batches.find(({ demoAction }) => demoAction === "clear");
  assert.ok(clear);
  assert.ok(clear.groups.some(({ groupId }) => groupId === "eVitals.VitalGroup"));
  assert.ok(clear.occurrences.some(({ elementId }) => elementId === "eVitals.01"));
  assert.ok(clear.groups.every(({ tombstone }) => tombstone));
  assert.ok(clear.occurrences.every(({ tombstone }) => tombstone));
  assert.ok(batches.filter(({ demoAction }) => !demoAction).every(({ groups }) =>
    groups.every(({ correlationId }) => !correlationId?.startsWith("demo:"))));
  const saved = batches.reduce(applyDraftMutationDelta, baseline);
  assert.ok(!saved.groups.some(({ id }) => clear.groups.some((group) => group.id === id)));
  assert.deepEqual(draftMutationDelta(encounterDocumentToDraftMutations(reportId, removed.document, saved), saved),
    { groups: [], occurrences: [] });
});

test("recovery sends missing manual parent groups before their populated demo values", () => {
  const manual = { id: "manual-parent", groupId: "eVitals.VitalGroup", ordinal: 0 };
  const vital = { id: "manual-pressure", groupInstanceId: manual.id, elementId: "eVitals.06", ordinal: 0,
    value: { kind: "integer" as const, value: 100 } };
  const populated = { id: "demo-pulse", groupInstanceId: manual.id, elementId: "eVitals.10", ordinal: 0,
    value: { kind: "integer" as const, value: 70 }, provenanceKind: "demo" as const,
    provenanceDetail: { generator: "stationary-populate-v1" }, sourceAttributes: { "x-open-triage-demo": "stationary-populate-v1" } };
  assert.deepEqual(recoveryMutationBatches({ groups: [manual], occurrences: [vital, populated] }, { groups: [], occurrences: [] }), [
    { groups: [manual], occurrences: [vital] },
    { demoAction: "populate", groups: [], occurrences: [populated] },
  ]);
});

test("only a brand-new server report queues an initial persistence snapshot", () => {
  assert.equal(shouldQueueInitialDraftSnapshot("empty", 0, true, false), true);
  assert.equal(shouldQueueInitialDraftSnapshot("empty", 11, true, false), false,
    "reopening an existing report must not create a no-op synchronization write");
  assert.equal(shouldQueueInitialDraftSnapshot("restored", 0, true, false), false);
  assert.equal(shouldQueueInitialDraftSnapshot("empty", 0, true, true), false);
});

test("authoritative reconciliation clears a stale sync blocker when no local changes remain", () => {
  assert.equal(reconciledDraftSyncStatus("Pending sync", false), "Saved");
  assert.equal(reconciledDraftSyncStatus("Conflict", false), "Saved");
  assert.equal(reconciledDraftSyncStatus("Pending sync", true), "Pending sync");
  assert.equal(reconciledDraftSyncStatus("Saving", true), "Saving");
});

test("a dispatch cancellation notice tells clinicians that opened documentation is preserved", () => {
  const notice = dispatchCancellationNotice({
    canceledAt: "2026-08-15T13:18:31.000Z", dispatchRevision: 3, receiptId: "receipt"
  });
  assert.match(notice, /report is preserved/i);
  assert.match(notice, /continue documentation/i);
});

test("the draft adapter retains stable report, group, and occurrence identities", () => {
  const first = shellStateToDraftMutations(reportId, INITIAL_SHELL_STATE);
  const second = shellStateToDraftMutations(reportId, structuredClone(INITIAL_SHELL_STATE));
  assert.deepEqual(second, first);
  assert.match(stableDraftId(reportId, "group:patient-1"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(first.groups.map(({ id }) => id)).size, first.groups.length);
  assert.equal(new Set(first.occurrences.map(({ id }) => id)).size, first.occurrences.length);
  assert.equal(DRAFT_SAVE_DEBOUNCE_MS, 1_000);
  assert.equal(DRAFT_SYNC_RETRY_MS, 2_000);
  assert.equal(ACTIVE_REPORT_POLL_INTERVAL_MS, 10_000);
  assert.equal(DRAFT_CONFLICT_RECOVERY_LIMIT, 1);
});

test("the draft adapter preserves identities rehydrated from PostgreSQL", () => {
  const shell = structuredClone(INITIAL_SHELL_STATE);
  const instance = shell.encounter.document.groups[0]!.instances[0]!;
  const serverGroupId = "52000000-0000-4000-8000-000000000021";
  (instance as { instanceId: string }).instanceId = serverGroupId;
  const value = instance.elements[0]?.values[0];
  const serverOccurrenceId = "52000000-0000-4000-9000-000000000022";
  if (value) (value as { occurrenceId: string }).occurrenceId = serverOccurrenceId;

  const mutations = shellStateToDraftMutations(reportId, shell);
  assert.ok(mutations.groups.some(({ id }) => id === serverGroupId));
  if (value) assert.ok(mutations.occurrences.some(({ id }) => id === serverOccurrenceId));
});

test("server-owned PCR number stays out of draft mutations, including stale tombstones", () => {
  const baseline = structuredClone(INITIAL_SHELL_STATE.encounter.document);
  const record = {
    id: "eRecordSection", instances: [{ instanceId: "42000000-0000-4000-8000-000000000090",
      elements: [{ id: "eRecord.01", values: [{ kind: "scalar" as const,
        occurrenceId: "42000000-0000-4000-8000-000000000091", value: "PCR-000000001" }] }] }],
  };
  const document = { ...baseline, groups: [...baseline.groups, record] };
  const mutation = encounterDocumentToDraftMutations(reportId, document, {
    groups: [],
    occurrences: [{ id: "42000000-0000-4000-8000-000000000091", elementId: "eRecord.01",
      groupInstanceId: record.instances[0]!.instanceId, ordinal: 0, tombstone: true }]
  });
  assert.equal(mutation.occurrences.some(({ elementId }) => elementId === "eRecord.01"), false);
  assert.ok(mutation.groups.some(({ groupId }) => groupId === "eRecordSection"));
});

test("the draft adapter normalizes legacy string vital integers before saving", () => {
  const baseline = structuredClone(INITIAL_SHELL_STATE.encounter.document);
  const document = {
    ...baseline,
    groups: [...baseline.groups, {
      id: "eVitals.BloodPressureGroup",
      instances: [{
        instanceId: "legacy-blood-pressure",
        elements: [{
          id: "eVitals.06",
          values: [{ kind: "scalar" as const, occurrenceId: "legacy-systolic", value: "100" }],
        }],
      }],
    }],
  };

  const systolic = encounterDocumentToDraftMutations(reportId, document).occurrences
    .find(({ elementId }) => elementId === "eVitals.06");

  assert.deepEqual(systolic?.value, { kind: "integer", value: 100 });
});

test("Populate excludes incidental changes to an existing clinician vital set", () => {
  const clinicianGroupId = "52000000-0000-4000-8000-000000000031";
  const clinicianOccurrenceId = "52000000-0000-4000-8000-000000000032";
  const demoGroupId = "52000000-0000-4000-8000-000000000033";
  const demoOccurrenceId = "52000000-0000-4000-8000-000000000034";
  const scoped = demoActionMutationDelta("populate", {
    groups: [
      { id: clinicianGroupId, groupId: "eVitals.VitalGroup", ordinal: 0, parentGroupInstanceId: demoGroupId },
      { id: demoGroupId, groupId: "eVitalsSection", ordinal: 0, correlationId: "demo:stationary-populate-v1:vitals" },
    ],
    occurrences: [
      { id: clinicianOccurrenceId, elementId: "eVitals.01", groupInstanceId: clinicianGroupId, ordinal: 0,
        value: { kind: "datetime", value: "2026-09-13T12:34:00-04:00" } },
      { id: demoOccurrenceId, elementId: "eVitals.10", groupInstanceId: clinicianGroupId, ordinal: 0,
        sourceAttributes: { "x-open-triage-demo": "stationary-populate-v1" }, provenanceKind: "demo",
        provenanceDetail: { generator: "stationary-populate-v1" }, value: { kind: "integer", value: 80 } },
    ],
  }, { groups: [], occurrences: [] });

  assert.deepEqual(scoped.groups.map(({ id }) => id), [demoGroupId]);
  assert.deepEqual(scoped.occurrences.map(({ id }) => id), [demoOccurrenceId]);
});

test("active report polling sends an ETag and accepts a bodyless unchanged response", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  let headers: HeadersInit | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers = init?.headers;
    return new Response(null, { status: 304, headers: { etag: '"report-4-dispatch-2"' } });
  }) as typeof fetch;
  try {
    assert.equal(await fetchActiveReport(reportId, '"report-4-dispatch-2"'), null);
    assert.equal((headers as Record<string, string>)["if-none-match"], '"report-4-dispatch-2"');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
  }
});

test("prototype record deletion uses a confirmed server-side DELETE with CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), init };
    return Response.json({ deleted: true, reportId });
  }) as typeof fetch;

  assert.deepEqual(await deleteDraftReport("csrf-proof", reportId), { deleted: true, reportId });
  assert.equal(request?.input, `http://localhost:3001/api/reports/${reportId}`);
  assert.equal(request?.init?.method, "DELETE");
  assert.equal((request?.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
});

test("record deletion reports offline state without implying success", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => { throw new TypeError("network unavailable"); }) as typeof fetch;
  await assert.rejects(deleteDraftReport("csrf-proof", reportId), /offline/);
});

test("active polling and draft saves identify a report completed by another client", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  try {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    await assert.rejects(fetchActiveReport(reportId), /completed/);

    globalThis.fetch = (async () => new Response(JSON.stringify({ id: reportId, revision: 9, status: "signed" }), { status: 200 })) as typeof fetch;
    const result = await saveDraftReport("token", reportId, {
      commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
      authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:stationary:test",
      clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
    });
    assert.equal(result.status, "signed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  }
});

test("an invalid saved browser command is distinguished from a temporary outage", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  });
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = (async () => Response.json({ message: "Invalid stale command" }, { status: 422 })) as typeof fetch;
  await assert.rejects(saveDraftReport("token", reportId, {
    commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
    authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:stationary:test",
    clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
  }), (error) => error instanceof DraftSaveRejectedError && error.category === "validation-rejected");
});

test("draft save conflicts expose only a privacy-safe category", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  });
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = (async () => Response.json({ message: "value-bearing server detail must not escape" }, { status: 409 })) as typeof fetch;
  await assert.rejects(saveDraftReport("token", reportId, {
    commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
    authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:test",
    clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
  }), (error) => error instanceof DraftSaveRejectedError &&
    error.category === "server-conflict" && error.message === "server-conflict");
});

test("a delayed synchronization receives a terminal purged result instead of retrying offline", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  });
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = (async () => Response.json({ message: "permanently purged" }, { status: 410 })) as typeof fetch;
  await assert.rejects(fetchActiveReport(reportId), /purged/);
  await assert.rejects(saveDraftReport("token", reportId, {
    commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
    authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:offline:test",
    clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
  }), /purged/);
});

test("browser-only static builds at a root or subpath consider their durable local write synchronized", async () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const originalRouteDemoMutations = process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
  delete process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
  globalThis.fetch = (async () => { throw new Error("the static build must not call a report API"); }) as typeof fetch;
  try {
    for (const basePath of [undefined, "/open-triage-epcr-demo"]) {
      if (basePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
      else process.env.NEXT_PUBLIC_BASE_PATH = basePath;
      const result = await saveDraftReport("token", reportId, {
        commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
        authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:stationary:test",
        clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
      });
      assert.deepEqual(result, { id: reportId, status: "draft", revision: 8 });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
    if (originalRouteDemoMutations === undefined) delete process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
    else process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API = originalRouteDemoMutations;
  }
});

test("signing sends the current revision, clinician attestation, and warning acknowledgements", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  let request: { input: string; init?: RequestInit } | undefined;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ id: reportId, status: "signed" }), { status: 201 });
  }) as typeof fetch;
  try {
    await signDraftReport("token", reportId, 8, "32000000-0000-4000-8000-000000000003", ["missing-vitals"]);
    const body = JSON.parse(String(request?.init?.body));
    assert.equal(request?.input, `http://localhost:3001/api/reports/${reportId}/sign`);
    assert.equal(request?.init?.method, "POST");
    assert.equal(body.expectedRevision, 8);
    assert.equal(body.signerId, "32000000-0000-4000-8000-000000000003");
    assert.deepEqual(body.warningAcknowledgements, { "missing-vitals": true });
    assert.equal(body.attestation.meaning, "clinician approval");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  }
});

test("local demo sessions routed through the API still submit signatures", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const originalRouteDemoMutations = process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
  let requestUrl: string | undefined;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
  process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API = "true";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestUrl = String(input);
    return Response.json({ id: reportId, status: "signed" }, { status: 201 });
  }) as typeof fetch;
  try {
    await signDraftReport("token", reportId, 9, "32000000-0000-4000-8000-000000000003", []);
    assert.equal(requestUrl, `/api/reports/${reportId}/sign`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
    if (originalRouteDemoMutations === undefined) delete process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
    else process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API = originalRouteDemoMutations;
  }
});

test("browser-only static demos at a root or subpath never submit a signature to a nonexistent API", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const originalRouteDemoMutations = process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
  delete process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
  globalThis.fetch = (async () => { throw new Error("the static build must not call a signing API"); }) as typeof fetch;
  try {
    for (const basePath of [undefined, "/open-triage-epcr-demo"]) {
      if (basePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
      else process.env.NEXT_PUBLIC_BASE_PATH = basePath;
      await signDraftReport("token", reportId, 9, "32000000-0000-4000-8000-000000000003", []);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
    if (originalRouteDemoMutations === undefined) delete process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API;
    else process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API = originalRouteDemoMutations;
  }
});

test("signing surfaces revision, validation, session, server, and network failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const sign = () => signDraftReport(
    "token", reportId, 9, "32000000-0000-4000-8000-000000000003", [],
  );
  try {
    for (const [status, message] of [
      [409, /legacy.http409/i],
      [422, /legacy.http422/i],
      [401, /legacy.http401/i],
      [503, /legacy.http503/i],
    ] as const) {
      globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
      await assert.rejects(sign(), message);
    }
    globalThis.fetch = (async () => { throw new TypeError("network unavailable"); }) as typeof fetch;
    await assert.rejects(sign(), /check your connection/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  }
});

test("app-native note create, edit, and delete use revisioned report-note endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const noteId = "10000000-0000-4000-8000-000000000001";
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    const response = init?.method === "DELETE"
      ? { reportId, noteId, revision: 10, deleted: true }
      : { reportId, revision: calls.length === 1 ? 8 : 9, note: { id: noteId } };
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  try {
    await createReportTextNote("csrf", reportId, {
      commandId: "50000000-0000-4000-8000-000000000001", expectedRevision: 7, noteId,
      capturedAt: "2026-09-24T12:01:00.000Z", capturedUtcOffsetMinutes: 120, content: "Patient reassessed",
    });
    await updateReportTextNote("csrf", reportId, noteId, {
      commandId: "50000000-0000-4000-8000-000000000002", expectedRevision: 8, content: "Pain improved",
    });
    await deleteReportTextNote("csrf", reportId, noteId, {
      commandId: "50000000-0000-4000-8000-000000000003", expectedRevision: 9,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls.map(({ input, init }) => [new URL(input).pathname, init?.method]), [
    [`/api/reports/${reportId}/notes`, "POST"],
    [`/api/reports/${reportId}/notes/${noteId}`, "POST"],
    [`/api/reports/${reportId}/notes/${noteId}`, "DELETE"],
  ]);
  assert.deepEqual(calls.map(({ init }) => (init?.headers as Record<string, string>)["x-csrf-token"]), ["csrf", "csrf", "csrf"]);
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).content, "Patient reassessed");
  assert.equal(JSON.parse(String(calls[1]!.init?.body)).expectedRevision, 8);
  assert.equal(JSON.parse(String(calls[2]!.init?.body)).expectedRevision, 9);
});

test("the web adapter sends cookie credentials and a CSRF proof to the report draft endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ id: reportId, revision: 8, status: "draft" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await saveDraftReport("token", reportId, {
      commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
      authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:test",
      clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
    });
    assert.equal(result.revision, 8);
    assert.equal(request?.input, draftChangesUrl(reportId));
    assert.equal(request?.init?.method, "POST");
    assert.equal(request?.init?.credentials, "include");
    assert.equal((request?.init?.headers as Record<string, string>)["x-csrf-token"], "token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
