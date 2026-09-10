import assert from "node:assert/strict";
import test from "node:test";
import type { AssignedCall } from "@open-triage/contracts";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  canceledAssignedCalls,
  fetchAssignedCalls,
  fetchOpenCalls,
  openAssignedCall,
  reopenOpenCall,
  resolveDispatchConflict,
} from "../app/assigned-calls";
import { purgeCompletedReportCaches, reportStorageKey, reportSyncStorageKey } from "../app/local-persistence";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const call = (id: string, callNumber: string): AssignedCall => ({
  id,
  callNumber,
  unit: { id: "unit-id", callSign: "Medic 32" },
  dispatchedAt: "2026-09-03T12:00:00.000Z",
  dispatchReason: "Medical assistance requested",
  dispatchPriority: { code: "2305003", display: "Emergent" },
  chiefComplaint: null,
  status: "assigned"
});

test("assignment polling uses the agreed ten-second cadence", () => {
  assert.equal(ASSIGNED_CALL_POLL_INTERVAL_MS, 10_000);
});

test("first-open has no offline fallback and requires the server to create authoritative identities", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  try {
    await assert.rejects(openAssignedCall("token", "assignment"), /connection/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the static export opens the generated sample fixture with a cacheable GET", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const originalBaseline = process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE;
  let request: { url: string; method?: string } | undefined;
  process.env.NEXT_PUBLIC_BASE_PATH = "/demo";
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
  process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method };
    return new Response(JSON.stringify(demoOpenAssignment), { status: 200 });
  };
  try {
    const opened = await openAssignedCall("token", demoOpenAssignment.assignmentId);
    assert.equal(opened.report.document.encounter.id, demoOpenAssignment.report.document.encounter.id);
    assert.deepEqual(request, { url: "/demo/demo-open-assignment.json", method: "GET" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
    if (originalBaseline === undefined) delete process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE;
    else process.env.NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE = originalBaseline;
  }
});

test("refresh identifies only canceled unopened assignments that disappeared", () => {
  assert.deepEqual(canceledAssignedCalls([call("a", "CALL-A"), call("b", "CALL-B")], [], ["a"]), [call("a", "CALL-A")]);
});

test("dispatch conflict dispositions are posted to the report server", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ id: "conflict", disposition: "acknowledge" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await resolveDispatchConflict("token", "report", "conflict", "acknowledge");
    assert.equal(result.disposition, "acknowledge");
    assert.equal(request?.url, "http://localhost:3001/api/reports/report/dispatch-conflicts/conflict");
    assert.equal(request?.init?.method, "POST");
    assert.equal(JSON.parse(String(request?.init?.body)).disposition, "acknowledge");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
  }
});

test("call-list adapters distinguish expired sessions from server failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  try {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(fetchAssignedCalls("token"), /session has ended/i);
    await assert.rejects(fetchOpenCalls("token"), /session has ended/i);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(fetchAssignedCalls("token"), /could not be refreshed/i);
    await assert.rejects(fetchOpenCalls("token"), /could not be refreshed/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});

test("opening and reopening map stale, missing, mismatched, and network responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  try {
    globalThis.fetch = async () => new Response(null, { status: 409 });
    await assert.rejects(openAssignedCall("token", "assignment"), /can no longer be opened/i);
    await assert.rejects(reopenOpenCall("token", "report"), /no longer available/i);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(reopenOpenCall("token", "report"), /no longer available/i);
    globalThis.fetch = async () => Response.json({ ...demoOpenAssignment, assignmentId: "different" });
    await assert.rejects(openAssignedCall("token", "assignment"), /does not match/i);
    globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
    await assert.rejects(reopenOpenCall("token", "report"), /connection/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});

test("completion cleanup removes only the server-confirmed report caches", () => {
  const values = new Map<string, string>([
    [reportStorageKey("completed"), "completed cache"],
    [reportSyncStorageKey("completed"), "Saved"],
    [reportStorageKey("completed-unsynced"), "recoverable cache"],
    [reportSyncStorageKey("completed-unsynced"), "Offline"],
    [reportStorageKey("open"), "open cache"],
    ["unrelated-unsynced-command", "retain me"]
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };

  purgeCompletedReportCaches(storage, ["completed", "completed-unsynced"]);

  assert.equal(values.has(reportStorageKey("completed")), false);
  assert.equal(values.get(reportStorageKey("completed-unsynced")), "recoverable cache");
  assert.equal(values.get(reportSyncStorageKey("completed-unsynced")), "Offline");
  assert.equal(values.get(reportStorageKey("open")), "open cache");
  assert.equal(values.get("unrelated-unsynced-command"), "retain me");
});
