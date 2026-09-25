import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { ReportNoteService } from "../dist/reports/report-note.service.js";
import {
  ReportNoteValidationError,
  normalizeReportNoteContent,
  validateCreateReportTextNoteCommand,
} from "../dist/reports/report-note.validation.js";

test("server text-note validation normalizes NFC and enforces required, control, and 10,000-character boundaries", () => {
  assert.equal(normalizeReportNoteContent("  A\u030Ake observed  "), "Åke observed");
  assert.throws(() => normalizeReportNoteContent("   "), ReportNoteValidationError);
  assert.throws(() => normalizeReportNoteContent("unsafe\u0000value"), /unsafe control/);
  assert.equal(normalizeReportNoteContent("first line\nsecond line"), "first line\nsecond line");
  assert.equal(normalizeReportNoteContent("x".repeat(10_000)).length, 10_000);
  assert.throws(() => normalizeReportNoteContent("x".repeat(10_001)), /10,000/);
  assert.equal([...normalizeReportNoteContent("😀".repeat(10_000))].length, 10_000);

  const command = {
    commandId: randomUUID(), expectedRevision: 4, noteId: randomUUID(),
    capturedAt: "2026-09-24T12:00:00.000Z", capturedUtcOffsetMinutes: 120,
    content: "  normalized  ",
  };
  assert.equal(validateCreateReportTextNoteCommand(command).content, "normalized");
  assert.throws(() => validateCreateReportTextNoteCommand({ ...command, capturedUtcOffsetMinutes: 900 }), /between -840 and 840/);
  assert.throws(() => validateCreateReportTextNoteCommand({ ...command, capturedAt: "1" }), /offset-aware ISO date-time/);
});

test("authorized draft note creation advances the report revision without a NEMSIS mutation", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const noteId = randomUUID();
  const statements = [];
  const manager = { query: async (sql, parameters = []) => {
    statements.push({ sql, parameters });
    if (/from clinical\.report where/.test(sql)) return [{ id: reportId, organization_id: organizationId, status: "draft", revision: 7 }];
    if (/select \* from clinical\.command_receipt/.test(sql)) return [];
    if (/from clinical\.report_note note/.test(sql)) return [{
      id: noteId, report_id: reportId, content: "Normalized observation", captured_at: "2026-09-24T12:00:00Z",
      captured_utc_offset_minutes: 120, created_by: userId, author_display_name: "Alex Clinician",
      server_received_at: "2026-09-24T12:00:01Z", updated_at: "2026-09-24T12:00:01Z",
    }];
    return [];
  } };
  const dataSource = { transaction: async (_isolation, work) => work(manager) };
  const sessions = {
    assertCsrf: async (_token, proof) => assert.equal(proof, "csrf-proof"),
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "clinical:document");
      return { user: { id: userId }, organization: { id: organizationId } };
    },
  };
  const service = new ReportNoteService(dataSource, sessions);
  const result = await service.create("session", reportId, {
    commandId: randomUUID(), expectedRevision: 7, noteId,
    capturedAt: "2026-09-24T12:00:00Z", capturedUtcOffsetMinutes: 120,
    content: " Normalized observation ",
  }, "csrf-proof");

  assert.equal(result.revision, 8);
  assert.equal(result.note.id, noteId);
  assert.equal(result.note.author.displayName, "Alex Clinician");
  assert.equal(result.note.persistenceState, "ready");
  assert.ok(statements.some(({ sql }) => /insert into clinical\.report_note/.test(sql)));
  assert.ok(statements.some(({ sql }) => /insert into clinical\.report_change/.test(sql)));
  assert.equal(statements.some(({ sql }) => /eNarrative\.01/.test(sql)), false);
  const revision = statements.find(({ sql }) => /insert into clinical\.report_change/.test(sql));
  assert.deepEqual(JSON.parse(revision.parameters[5]), { notes: [{ action: "create", noteId }] });
  assert.equal(revision.parameters.join(" ").includes("Normalized observation"), false);
});

test("authorized draft note editing preserves identity and confirmed deletion records no note content", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const noteId = randomUUID();
  let revision = 3;
  let content = "Original observation";
  let deleted = false;
  const statements = [];
  const manager = { query: async (sql, parameters = []) => {
    statements.push({ sql, parameters });
    if (/from clinical\.report where/.test(sql)) return [{ id: reportId, organization_id: organizationId, status: "draft", revision }];
    if (/select \* from clinical\.command_receipt/.test(sql)) return [];
    if (/update clinical\.report_note/.test(sql)) {
      content = parameters[3];
      return [{ id: noteId }];
    }
    if (/delete from clinical\.report_note/.test(sql)) {
      deleted = true;
      return [{ id: noteId }];
    }
    if (/update clinical\.report set revision/.test(sql)) {
      revision = parameters[1];
      return [];
    }
    if (/from clinical\.report_note note/.test(sql)) return deleted ? [] : [{
      id: noteId, report_id: reportId, content, captured_at: "2026-09-24T12:00:00Z",
      captured_utc_offset_minutes: 120, created_by: userId, author_display_name: "Alex Clinician",
      server_received_at: "2026-09-24T12:00:01Z", updated_at: "2026-09-24T12:02:01Z",
    }];
    return [];
  } };
  const service = new ReportNoteService({ transaction: async (_isolation, work) => work(manager) }, {
    assertCsrf: async () => undefined,
    requireCapability: async () => ({ user: { id: userId }, organization: { id: organizationId } }),
  });

  const edited = await service.update("session", reportId, noteId, {
    commandId: randomUUID(), expectedRevision: 3, content: "  Updated observation  ",
  }, "csrf");
  assert.equal(edited.revision, 4);
  assert.equal(edited.note.id, noteId);
  assert.equal(edited.note.content, "Updated observation");

  const removed = await service.delete("session", reportId, noteId, {
    commandId: randomUUID(), expectedRevision: 4,
  }, "csrf");
  assert.deepEqual(removed, { reportId, noteId, revision: 5, deleted: true });
  const changes = statements.filter(({ sql }) => /insert into clinical\.report_change/.test(sql));
  assert.deepEqual(changes.map(({ parameters }) => JSON.parse(parameters[5])), [
    { notes: [{ action: "update", noteId }] },
    { notes: [{ action: "delete", noteId }] },
  ]);
  assert.equal(changes.some(({ parameters }) => parameters.join(" ").includes("Updated observation")), false);
});

test("note mutation rechecks authorization and rejects signed reports server-side", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const command = {
    commandId: randomUUID(), expectedRevision: 2, noteId: randomUUID(),
    capturedAt: "2026-09-24T12:00:00Z", capturedUtcOffsetMinutes: 0, content: "Observation",
  };
  const signedManager = { query: async (sql) => {
    if (/from clinical\.report where/.test(sql)) return [{ id: reportId, organization_id: organizationId, status: "signed", revision: 2 }];
    if (/select \* from clinical\.command_receipt/.test(sql)) return [];
    return [];
  } };
  const service = new ReportNoteService({ transaction: async (_isolation, work) => work(signedManager) }, {
    assertCsrf: async () => undefined,
    requireCapability: async () => ({ user: { id: userId }, organization: { id: organizationId } }),
  });
  await assert.rejects(service.create("session", reportId, command, "csrf"), ConflictException);

  const denied = new ReportNoteService({ transaction: async (_isolation, work) => work({ query: async () => [] }) }, {
    assertCsrf: async () => undefined,
    requireCapability: async () => { throw new UnauthorizedException("role removed"); },
  });
  await assert.rejects(denied.create("session", reportId, command, "csrf"), UnauthorizedException);
});
