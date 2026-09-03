import assert from "node:assert/strict";
import test from "node:test";
import type { AssignedCall } from "@open-triage/contracts";
import { ASSIGNED_CALL_POLL_INTERVAL_MS, canceledAssignedCalls } from "../app/assigned-calls";
import { purgeCompletedReportCaches, reportStorageKey, reportSyncStorageKey } from "../app/local-persistence";

const call = (id: string, callNumber: string): AssignedCall => ({
  id,
  callNumber,
  unit: { id: "unit-id", callSign: "Medic 32" },
  dispatchedAt: "2026-09-03T12:00:00.000Z",
  dispatchReason: "Medical assistance requested",
  chiefComplaint: null,
  status: "assigned"
});

test("assignment polling uses the agreed ten-second cadence", () => {
  assert.equal(ASSIGNED_CALL_POLL_INTERVAL_MS, 10_000);
});

test("refresh identifies only canceled unopened assignments that disappeared", () => {
  assert.deepEqual(canceledAssignedCalls([call("a", "CALL-A"), call("b", "CALL-B")], [], ["a"]), [call("a", "CALL-A")]);
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
