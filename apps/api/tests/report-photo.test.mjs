import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { DraftReportController } from "../dist/reports/draft-report.controller.js";
import { ReportPhotoService } from "../dist/reports/report-photo.service.js";
import {
  inspectCanonicalJpeg,
  normalizePhotoCaption,
  ReportPhotoValidationError,
  validateCreateReportPhotoNoteCommand,
} from "../dist/reports/report-photo.validation.js";

function jpeg(width = 2, height = 3) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff, 0xff, 0xd9]);
}

test("canonical JPEG validation verifies dimensions and rejects metadata segments", () => {
  assert.deepEqual(inspectCanonicalJpeg(jpeg(2560, 1200)), { width: 2560, height: 1200 });
  assert.throws(() => inspectCanonicalJpeg(jpeg(2561, 1200)), /2560/);
  const exif = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0, 0, ...jpeg()]);
  assert.throws(() => inspectCanonicalJpeg(exif), ReportPhotoValidationError);
  const postFrameExif = Buffer.concat([jpeg().subarray(0, -2), Buffer.from([0xff, 0xe1, 0x00, 0x04, 0, 0, 0xff, 0xd9])]);
  assert.throws(() => inspectCanonicalJpeg(postFrameExif), ReportPhotoValidationError);
  assert.equal(normalizePhotoCaption("  Patient’s medication bag  "), "Patient’s medication bag");
  assert.equal(normalizePhotoCaption("   "), null);
});

test("photo command validation requires a hash-identified bounded JPEG payload", () => {
  const bytes = jpeg();
  const command = {
    commandId: randomUUID(), expectedRevision: 4, noteId: randomUUID(), capturedAt: "2026-09-24T12:00:00Z",
    capturedUtcOffsetMinutes: 120, caption: null, contentType: "image/jpeg",
    canonicalBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), width: 2, height: 3,
  };
  assert.equal(validateCreateReportPhotoNoteCommand(command).sha256, command.sha256);
  assert.throws(() => validateCreateReportPhotoNoteCommand({ ...command, contentType: "image/png" }), /image\/jpeg/);
  assert.throws(() => validateCreateReportPhotoNoteCommand({ ...command, width: 2561 }), /between 1 and 2560/);
});

test("photo creation reserves aggregate quota while the report row is locked and stores bytes separately", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const noteId = randomUUID();
  const bytes = jpeg(2, 3);
  const statements = [];
  const manager = { query: async (sql, parameters = []) => {
    statements.push({ sql, parameters });
    if (/from clinical\.report where/.test(sql)) return [{ id: reportId, organization_id: organizationId, status: "draft", revision: 4, report_media_allowance_bytes: 10_000 }];
    if (/select \* from clinical\.command_receipt/.test(sql)) return [];
    if (/as used_bytes/.test(sql)) return [{ used_bytes: 100 }];
    if (/from clinical\.report_note note/.test(sql)) return [];
    if (/from clinical\.report_photo_note note/.test(sql)) return [{
      id: noteId, report_id: reportId, caption: "Scene", captured_at: "2026-09-24T12:00:00Z",
      captured_utc_offset_minutes: 120, created_by: userId, author_display_name: "Alex Clinician",
      server_received_at: "2026-09-24T12:00:01Z", updated_at: "2026-09-24T12:00:01Z",
      content_type: "image/jpeg", byte_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: 2, height: 3,
    }];
    return [];
  } };
  const service = new ReportPhotoService({ transaction: async (_isolation, work) => typeof _isolation === "function" ? _isolation(manager) : work(manager) }, {
    assertCsrf: async () => undefined,
    requireCapability: async () => ({ user: { id: userId }, organization: { id: organizationId } }),
  });
  const result = await service.create("session", reportId, {
    commandId: randomUUID(), expectedRevision: 4, noteId, capturedAt: "2026-09-24T12:00:00Z",
    capturedUtcOffsetMinutes: 120, caption: " Scene ", contentType: "image/jpeg",
    canonicalBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), width: 2, height: 3,
  }, "csrf");
  assert.equal(result.note.type, "photo");
  assert.equal(result.revision, 5);
  assert.ok(statements.some(({ sql }) => /for update/.test(sql)));
  assert.ok(statements.some(({ sql }) => /insert into clinical\.report_photo_blob/.test(sql)));
  assert.equal(statements.find(({ sql }) => /insert into clinical\.report_photo_blob/.test(sql)).parameters[3] instanceof Buffer, true);
  assert.equal(statements.some(({ sql }) => /canonical_bytes/.test(sql) && /from clinical\.report_photo_note note/.test(sql)), false);
});

test("aggregate quota rejection occurs before either metadata or bytes are inserted", async () => {
  const reportId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const bytes = jpeg();
  const statements = [];
  const manager = { query: async (sql, parameters = []) => {
    statements.push({ sql, parameters });
    if (/from clinical\.report where/.test(sql)) return [{ id: reportId, organization_id: organizationId, status: "draft", revision: 1, report_media_allowance_bytes: bytes.length }];
    if (/select \* from clinical\.command_receipt/.test(sql)) return [];
    if (/as used_bytes/.test(sql)) return [{ used_bytes: 1 }];
    return [];
  } };
  const service = new ReportPhotoService({ transaction: async (_isolation, work) => work(manager) }, {
    assertCsrf: async () => undefined,
    requireCapability: async () => ({ user: { id: userId }, organization: { id: organizationId } }),
  });
  await assert.rejects(service.create("session", reportId, {
    commandId: randomUUID(), expectedRevision: 1, noteId: randomUUID(), capturedAt: "2026-09-24T12:00:00Z",
    capturedUtcOffsetMinutes: 0, contentType: "image/jpeg", canonicalBase64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"), width: 2, height: 3,
  }, "csrf"), ConflictException);
  assert.equal(statements.some(({ sql }) => /insert into clinical\.report_photo_(?:note|blob)/.test(sql)), false);
});

test("authorized image retrieval scopes private bytes to the organization and documenting clinician", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const reportId = randomUUID();
  const noteId = randomUUID();
  const bytes = jpeg();
  let query;
  const service = new ReportPhotoService({ transaction: async (work) => work({ query: async (sql, parameters) => {
    if (/select blob\.canonical_bytes/.test(sql)) query = { sql, parameters };
    return [{ canonical_bytes: bytes, content_type: "image/jpeg", sha256: "b".repeat(64) }];
  } }) }, {
    requireCapability: async () => ({ user: { id: userId }, organization: { id: organizationId } }),
  });

  const image = await service.image("session", reportId, noteId);
  assert.equal(image.bytes, bytes);
  assert.match(query.sql, /note\.organization_id = \$3/);
  assert.match(query.sql, /report\.documenting_user_id = \$4/);
  assert.deepEqual(query.parameters, [reportId, noteId, organizationId, userId]);
});

test("the viewer responds inline with no-store headers and no download attachment", async () => {
  const noteId = randomUUID();
  const bytes = jpeg();
  const headers = new Map();
  let body;
  const controller = new DraftReportController(undefined, undefined, undefined, undefined, undefined, {
    image: async () => ({ bytes, contentType: "image/jpeg", sha256: "c".repeat(64) }),
  });
  await controller.photoImage(randomUUID(), noteId, "Bearer session", undefined, {
    setHeader: (name, value) => headers.set(name, value),
    send: (value) => { body = value; },
  });
  assert.equal(body, bytes);
  assert.equal(headers.get("Cache-Control"), "no-store, private");
  assert.equal(headers.get("Content-Disposition"), `inline; filename="photo-${noteId}.jpg"`);
  assert.equal(headers.get("Content-Type"), "image/jpeg");
});
