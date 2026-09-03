import assert from "node:assert/strict";
import test from "node:test";
import type { AssignedCall } from "@open-triage/contracts";
import { ASSIGNED_CALL_POLL_INTERVAL_MS, canceledAssignedCalls } from "../app/assigned-calls";

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
