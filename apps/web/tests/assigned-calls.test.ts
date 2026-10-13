import { expectedApiUrl } from "./helpers/api-url";
import assert from "node:assert/strict";
import test from "node:test";
import type { AssignedCall, ClinicianSession, NewJobConfirmation } from "@open-triage/contracts";
import {
  ASSIGNED_CALL_POLL_INTERVAL_MS,
  canceledAssignedCalls,
  createNewPatientReport,
  fetchAssignedCalls,
  fetchOpenCalls,
  fetchSyntheticCallGenerationContext,
  generateSyntheticCall,
  openAssignedCall,
  reopenOpenCall,
  resolveDispatchConflict,
} from "../app/assigned-calls";
import { purgeCompletedReportCaches, reportStorageKey, reportSyncStorageKey } from "../app/local-persistence";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import { PlatformRequestError } from "../app/platform-errors";
import { InstallationContextChangedError } from "../app/installation-transition-generation";
import { NewJobCanceledError } from "../components/new-job-confirmation";

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

test("synthetic generation context and selected unit use only the live authenticated API", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (init?.method === "POST") return Response.json({ assignment: call("generated", "DEMO-1"), reused: false });
    return Response.json({ eligibleUnits: [{ id: "unit-id", callSign: "Medic 32", name: "Medic 32" }], hasUnopenedCall: false });
  };
  try {
    const context = await fetchSyntheticCallGenerationContext();
    const generated = await generateSyntheticCall("csrf-token", context.eligibleUnits[0]!.id);
    assert.equal(generated.assignment.id, "generated");
    assert.deepEqual(requests.map(({ url }) => url), [
      expectedApiUrl("/api/calls/synthetic-generation"),
      expectedApiUrl("/api/calls/synthetic-generation"),
    ]);
    assert.equal(requests[1]?.init?.method, "POST");
    assert.equal(new Headers(requests[1]?.init?.headers).get("x-csrf-token"), "csrf-token");
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { unitId: "unit-id" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});

test("synthetic call generation is unavailable to static and disconnected clients", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
  try {
    await assert.rejects(fetchSyntheticCallGenerationContext(), /live connection/i);
    await assert.rejects(generateSyntheticCall("csrf-token", "unit-id"), /live connection/i);
    delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(generateSyntheticCall("csrf-token", "unit-id"), /live connection/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});

test("a generation race reports an assignment conflict rather than blaming an open report", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = async () => Response.json({ code: "calls.http409", params: {}, message: "conflict" }, { status: 409 });
  try {
    await assert.rejects(
      generateSyntheticCall("csrf-token", "unit-id"),
      /information changed/i
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
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

test("assigned and standalone new jobs normalize network failures at creation, preparation and Continue retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  const session: ClinicianSession = { csrfToken: "csrf", user: { id: "user", displayName: "Clinician" },
    organization: { id: "agency", name: "Agency" }, startedAt: "2026-10-13T06:44:00Z", expiresAt: "2026-10-13T18:44:00Z" };
  const reminder: NewJobConfirmation = { token: "attempt", clinicianName: "Clinician",
    unit: { id: "unit", callSign: "Unit", name: "Unit", organizationId: "agency" } };
  const challenge = () => Response.json({ code: "calls.identityConfirmationRequired" }, { status: 403 });
  try {
    for (const create of [() => openAssignedCall("csrf", "assignment", async value => value.token),
      () => createNewPatientReport(session, async value => value.token)]) {
      for (const failureAt of [1, 2, 3]) {
        let requests = 0;
        globalThis.fetch = async () => {
          requests++;
          if (requests === failureAt) throw new TypeError("private network detail");
          return requests === 1 ? challenge() : Response.json(reminder);
        };
        await assert.rejects(create(), error => error instanceof PlatformRequestError
          && error.code === "calls.newJobConnectionRequired" && /connection/i.test(error.message)
          && !error.message.includes("private network detail"));
        assert.equal(requests, failureAt);
      }
      for (const error of [new InstallationContextChangedError("changed"), new PlatformRequestError("auth.http401", 401, "expired")]) {
        globalThis.fetch = async () => { throw error; };
        await assert.rejects(create(), actual => actual === error);
      }
    }
    for (const create of [
      (confirm: (value: NewJobConfirmation) => Promise<string>) => openAssignedCall("csrf", "assignment", confirm),
      (confirm: (value: NewJobConfirmation) => Promise<string>) => createNewPatientReport(session, confirm),
    ]) {
      let requests = 0;
      const canceled = new NewJobCanceledError();
      globalThis.fetch = async (_url, init) => {
        requests++;
        if (init?.method === "DELETE") throw new TypeError("cancellation offline");
        return requests === 1 ? challenge() : Response.json(reminder);
      };
      await assert.rejects(create(async () => { throw canceled; }), error => error === canceled);
      assert.equal(requests, 3, "best-effort cancellation cannot replace the clinician's cancellation");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalDemo === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemo;
  }
});

test("the static export opens the generated sample fixture with a cacheable GET", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemo = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  let request: { url: string; method?: string } | undefined;
  process.env.NEXT_PUBLIC_BASE_PATH = "/demo";
  process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = "true";
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
    assert.equal(request?.url, expectedApiUrl("/api/reports/report/dispatch-conflicts/conflict"));
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
    await assert.rejects(fetchAssignedCalls(), /legacy.http401/i);
    await assert.rejects(fetchOpenCalls(), /legacy.http401/i);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(fetchAssignedCalls(), /legacy.http503/i);
    await assert.rejects(fetchOpenCalls(), /legacy.http503/i);
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
    await assert.rejects(openAssignedCall("token", "assignment"), /legacy.http409/i);
    await assert.rejects(reopenOpenCall("token", "report"), /legacy.http409|legacy.http404/i);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(reopenOpenCall("token", "report"), /legacy.http409|legacy.http404/i);
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
