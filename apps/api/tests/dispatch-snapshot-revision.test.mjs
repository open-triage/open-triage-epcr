import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { dispatchCanonicalDigest, dispatchSnapshotDigest } from "../dist/dispatch/dispatch-snapshot-revision.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = JSON.parse(await readFile(resolve(root, "packages/contracts/examples/dispatch/synthetic-assignment-01.json"), "utf8"));

function copy(value = source) {
  return structuredClone(value);
}

function element(message, id) {
  return message.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements)
    .find((candidate) => candidate.id === id);
}

test("dispatchCanonicalDigest ignores JSON property and stable collection ordering", () => {
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
});

test("dispatchCanonicalDigest changes when a value actually changes", () => {
  const changed = copy();
  element(changed, "eResponse.13").values[0].value = "SYNTHETIC-VEHICLE-CHANGED";

  assert.notEqual(dispatchCanonicalDigest(changed), dispatchCanonicalDigest(source));
});

test("dispatchSnapshotDigest ignores messageId, sentAt, and revision but not content", () => {
  const sameContentNewEnvelope = copy();
  sameContentNewEnvelope.messageId = "10000000-0000-4000-8000-000000000099";
  sameContentNewEnvelope.sentAt = "2026-09-03T12:09:00-04:00";
  sameContentNewEnvelope.revision = source.revision + 1;

  assert.equal(dispatchSnapshotDigest(sameContentNewEnvelope), dispatchSnapshotDigest(source));

  const changedContent = copy();
  element(changedContent, "eResponse.13").values[0].value = "SYNTHETIC-VEHICLE-CHANGED";
  assert.notEqual(dispatchSnapshotDigest(changedContent), dispatchSnapshotDigest(source));
});
