import assert from "node:assert/strict";
import test from "node:test";
import { RecoveryReauthenticationGate } from "../app/recovery-reauthentication-gate";

test("automatic recovery stops after 428 until explicit reauthentication succeeds", () => {
  const gate = new RecoveryReauthenticationGate();
  assert.equal(gate.shouldAttempt("completed-report"), true);

  gate.requireReauthentication("completed-report");
  assert.equal(gate.shouldAttempt("completed-report"), false);
  assert.equal(gate.shouldAttempt("another-report"), true);

  gate.reauthenticated();
  assert.equal(gate.shouldAttempt("completed-report"), true);
});
