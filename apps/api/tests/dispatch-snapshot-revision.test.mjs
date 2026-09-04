import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyDispatchSnapshotRevision,
  dispatchCanonicalDigest,
  emptyDispatchRevisionState
} from "../dist/dispatch/dispatch-snapshot-revision.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = JSON.parse(await readFile(resolve(root, "packages/contracts/examples/dispatch/synthetic-assignment.json"), "utf8"));

function copy(value = source) {
  return structuredClone(value);
}

function element(message, id) {
  return message.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements)
    .find((candidate) => candidate.id === id);
}

function delivery(canonical, status = "applied") {
  return { canonical, status };
}

function later(message, revision, messageId) {
  message.revision = revision;
  message.messageId = messageId;
  message.sentAt = `2026-09-03T12:0${revision}:00-04:00`;
  return message;
}

test("exact retries return the original result and do not mutate the ledger", () => {
  const first = applyDispatchSnapshotRevision(emptyDispatchRevisionState(), delivery(copy()));
  const retry = applyDispatchSnapshotRevision(first.state, delivery(copy()));

  assert.strictEqual(retry.state, first.state);
  assert.strictEqual(retry.result, first.result);
  assert.equal(Object.keys(retry.state.revisions).length, 1);
});

test("canonical equality ignores JSON property and stable collection ordering", () => {
  const first = applyDispatchSnapshotRevision(emptyDispatchRevisionState(), delivery(copy()));
  const reordered = copy();
  reordered.groups.reverse();
  for (const group of reordered.groups) {
    group.instances.reverse();
    for (const instance of group.instances) {
      instance.elements.reverse();
      for (const candidate of instance.elements) candidate.values.reverse();
    }
  }
  const withReorderedProperties = Object.fromEntries(Object.entries(reordered).reverse());

  assert.equal(dispatchCanonicalDigest(withReorderedProperties), dispatchCanonicalDigest(source));
  const retry = applyDispatchSnapshotRevision(first.state, delivery(withReorderedProperties));
  assert.strictEqual(retry.result, first.result);
  assert.strictEqual(retry.state, first.state);
});

test("message identity reuse and same-revision content disagreement conflict", () => {
  const first = applyDispatchSnapshotRevision(emptyDispatchRevisionState(), delivery(copy()));
  const reusedMessage = copy();
  element(reusedMessage, "eResponse.13").values[0].value = "SYNTHETIC-VEHICLE-CHANGED";
  const messageConflict = applyDispatchSnapshotRevision(first.state, delivery(reusedMessage));
  assert.deepEqual({ status: messageConflict.result.status, conflict: messageConflict.result.conflict },
    { status: "conflicting", conflict: "message_id" });
  assert.strictEqual(messageConflict.state, first.state);

  const sameRevision = later(copy(), 1, "10000000-0000-4000-8000-000000000099");
  element(sameRevision, "eResponse.13").values[0].value = "SYNTHETIC-VEHICLE-CHANGED";
  const revisionConflict = applyDispatchSnapshotRevision(first.state, delivery(sameRevision));
  assert.deepEqual({ status: revisionConflict.result.status, conflict: revisionConflict.result.conflict },
    { status: "conflicting", conflict: "source_revision" });
  assert.strictEqual(revisionConflict.state, first.state);
});

test("a new message carrying the same canonical source revision returns its original result", () => {
  const first = applyDispatchSnapshotRevision(emptyDispatchRevisionState(), delivery(copy()));
  const equivalent = later(copy(), 1, "10000000-0000-4000-8000-000000000098");
  const retry = applyDispatchSnapshotRevision(first.state, delivery(equivalent));

  assert.strictEqual(retry.result, first.result);
  assert.equal(retry.state.messageRevisions[equivalent.messageId], 1);
  assert.equal(Object.keys(retry.state.revisions).length, 1);
});

test("stale revisions reject while a newer revision applies and records its gap", () => {
  const first = applyDispatchSnapshotRevision(emptyDispatchRevisionState(), delivery(copy()));
  const revisionFour = later(copy(), 4, "10000000-0000-4000-8000-000000000004");
  const fourth = applyDispatchSnapshotRevision(first.state, delivery(revisionFour));
  assert.deepEqual(fourth.result.revisionGap, { firstMissing: 2, lastMissing: 3 });
  assert.equal(fourth.result.previousRevision, 1);

  const revisionTwo = later(copy(), 2, "10000000-0000-4000-8000-000000000002");
  const stale = applyDispatchSnapshotRevision(fourth.state, delivery(revisionTwo));
  assert.deepEqual(stale.result, {
    status: "stale", sourceRecordId: source.sourceRecordId, revision: 2, currentRevision: 4
  });
  assert.strictEqual(stale.state, fourth.state);
});

test("complete snapshots replace and retract vendor values by stable occurrence identity", () => {
  const first = applyDispatchSnapshotRevision(emptyDispatchRevisionState(), delivery(copy()));
  const revisionTwo = later(copy(), 2, "10000000-0000-4000-8000-000000000002");
  const vehicle = element(revisionTwo, "eResponse.13");
  const vehicleOccurrenceId = vehicle.values[0].occurrenceId;
  vehicle.values[0].value = "SYNTHETIC-VEHICLE-UPDATED";
  const phones = element(revisionTwo, "ePatient.18");
  const retractedPhoneId = phones.values[1].occurrenceId;
  phones.values.splice(1, 1);
  phones.values.push({
    kind: "scalar", occurrenceId: "synthetic-phone-office", value: "+15550101999",
    attributes: { PhoneNumberType: "9913007" }
  });

  const second = applyDispatchSnapshotRevision(first.state, delivery(revisionTwo, "applied_with_findings"));
  assert.equal(second.result.status, "applied_with_findings");
  assert.ok(second.result.replaced.some(({ occurrenceId, previousValue, value }) =>
    occurrenceId === vehicleOccurrenceId && previousValue.value !== value.value));
  assert.ok(second.result.retracted.some(({ occurrenceId }) => occurrenceId === retractedPhoneId));
  assert.ok(second.result.added.some(({ occurrenceId }) => occurrenceId === "synthetic-phone-office"));
});
