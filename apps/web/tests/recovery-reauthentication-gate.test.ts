import assert from "node:assert/strict";
import test from "node:test";
import { RecoveryReauthenticationGate } from "../app/recovery-reauthentication-gate";

test("automatic recovery stops after 428 until explicit reauthentication succeeds", () => {
  const gate = new RecoveryReauthenticationGate();
  assert.equal(gate.shouldAttempt("completed-report"), true);

  gate.requireReauthentication();
  assert.equal(gate.shouldAttempt("completed-report"), false);
  assert.equal(gate.shouldAttempt("another-report"), false);

  gate.reauthenticated();
  assert.equal(gate.shouldAttempt("completed-report"), true);
  assert.equal(gate.shouldAttempt("another-report"), true);
});

test("completed-report recovery checks run once until explicit reauthentication", () => {
  const gate = new RecoveryReauthenticationGate();
  gate.checked("completed-report-without-ciphertext");
  assert.equal(gate.shouldAttempt("completed-report-without-ciphertext"), false);
  assert.equal(gate.shouldAttempt("newly-completed-report"), true);
  gate.reauthenticated();
  assert.equal(gate.shouldAttempt("completed-report-without-ciphertext"), true);
});
