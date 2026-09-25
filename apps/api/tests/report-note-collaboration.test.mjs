import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import {
  inspectNoteMutation,
  recordMediaAccess,
  recordNoteMutation,
} from "../dist/reports/report-note-collaboration.js";

test("stale disjoint note edits are preserved and same-target receipts reconcile deterministically", async () => {
  const manager = { query: async () => [] };
  assert.deepEqual(await inspectNoteMutation(manager, randomUUID(), "text", randomUUID(), "update", 4, 7), {
    repeatedDelete: false,
    result: "applied",
  });

  const concurrent = { query: async () => [{ revision: 6, action: "update" }] };
  assert.deepEqual(await inspectNoteMutation(concurrent, randomUUID(), "photo", randomUUID(), "update", 4, 7), {
    repeatedDelete: false,
    result: "reconciled",
  });
});

test("deletion tombstones are idempotent and prevent delayed uploads from reviving bytes", async () => {
  const deleted = { query: async () => [{ revision: 8, action: "delete" }] };
  assert.deepEqual(await inspectNoteMutation(deleted, randomUUID(), "audio", randomUUID(), "delete", 7, 8), {
    repeatedDelete: true,
    result: "idempotent",
  });
  await assert.rejects(
    inspectNoteMutation(deleted, randomUUID(), "audio", randomUUID(), "create", 7, 8),
    ConflictException,
  );
});

test("note and media audits are bounded metadata and never receive clinical content", async () => {
  const statements = [];
  const manager = { query: async (sql, parameters) => { statements.push({ sql, parameters }); return []; } };
  const identity = {
    organizationId: randomUUID(), reportId: randomUUID(), noteId: randomUUID(),
    commandId: randomUUID(), actorId: randomUUID(),
  };
  await recordNoteMutation(manager, { ...identity, noteType: "text", action: "update",
    result: "reconciled", reportRevision: 9 });
  await recordMediaAccess(manager, { ...identity, mediaType: "photo" });

  const serialized = JSON.stringify(statements);
  assert.doesNotMatch(serialized, /content|caption|canonical_bytes|sha256/i);
  assert.match(serialized, /report_note_mutation_event/);
  assert.match(serialized, /report_media_access_event/);
});
