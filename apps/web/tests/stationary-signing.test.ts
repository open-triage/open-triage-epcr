import assert from "node:assert/strict";
import test from "node:test";
import { stationarySigningBlockers } from "../app/stationary-signing";

const clear = {
  presentationMode: "stationary" as const, restored: true, online: true, syncStatus: "Saved" as const,
  errorCount: 0, warnings: [{ acknowledged: true }], unresolvedDispatchConflictCount: 0,
};

test("stationary signing opens only after every independent gate passes", () => {
  assert.deepEqual(stationarySigningBlockers(clear), []);
  assert.deepEqual(stationarySigningBlockers({ ...clear, presentationMode: "mobile" }), ["mobile"]);
  assert.deepEqual(stationarySigningBlockers({ ...clear, online: false }), ["offline"]);
  assert.deepEqual(stationarySigningBlockers({ ...clear, syncStatus: "Pending sync" }), ["synchronization"]);
  assert.deepEqual(stationarySigningBlockers({ ...clear, errorCount: 1 }), ["error"]);
  assert.deepEqual(stationarySigningBlockers({ ...clear, warnings: [{ acknowledged: false }] }), ["warning"]);
  assert.deepEqual(stationarySigningBlockers({ ...clear, unresolvedDispatchConflictCount: 1 }), ["dispatch-conflict"]);
});

test("signing reports every simultaneous blocker instead of masking later safety gates", () => {
  assert.deepEqual(stationarySigningBlockers({
    presentationMode: "mobile", restored: false, online: false, syncStatus: "Conflict",
    errorCount: 2, warnings: [{ acknowledged: false }], unresolvedDispatchConflictCount: 2,
  }), ["mobile", "loading", "offline", "synchronization", "error", "warning", "dispatch-conflict"]);
});
