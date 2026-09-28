import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ReportAudioNormalizer } from "../dist/reports/report-audio-normalizer.service.js";
import { ReportAudioService } from "../dist/reports/report-audio.service.js";
import { REPORT_AUDIO_MAX_DURATION_MILLISECONDS, ReportAudioValidationError,
  validateCreateReportAudioNoteCommand } from "../dist/reports/report-audio.validation.js";

const validCommand = () => ({ commandId: randomUUID(), expectedRevision: 4, noteId: randomUUID(),
  capturedAt: "2026-09-24T12:00:00.000+02:00", capturedUtcOffsetMinutes: 120, caption: "Airway reassessment",
  sourceContentType: "audio/webm", sourceBase64: Buffer.from("decodable-source").toString("base64"),
  settingsRevision: 4, effectiveAllowanceBytes: 50_000_000 });

test("audio command validation accepts only bounded live-recorder formats", () => {
  assert.equal(validateCreateReportAudioNoteCommand(validCommand()).sourceContentType, "audio/webm");
  assert.throws(() => validateCreateReportAudioNoteCommand({ ...validCommand(), sourceContentType: "audio/wav" }), /audio\/webm, audio\/ogg, or audio\/mp4/);
  assert.throws(() => validateCreateReportAudioNoteCommand({ ...validCommand(), sourceBase64: "not base64" }), /canonical base64/);
  assert.throws(() => validateCreateReportAudioNoteCommand({ ...validCommand(), settingsRevision: 0 }), /positive safe integer/);
  assert.throws(() => validateCreateReportAudioNoteCommand({ ...validCommand(), effectiveAllowanceBytes: 0 }), /positive safe integer/);
});

test("normalization requires mono AAC, a full decode, and removes source and output temp files", async () => {
  class FakeNormalizer extends ReportAudioNormalizer {
    calls = [];
    probes = 0;
    paths = [];
    async probe(path) {
      this.paths.push(path);
      this.probes += 1;
      return this.probes === 1
        ? { format: { duration: "2.4" }, streams: [{ codec_type: "audio", codec_name: "opus", channels: 1 }] }
        : { format: { duration: "2.4" }, streams: [{ codec_type: "audio", codec_name: "aac", channels: 1 }] };
    }
    async ffmpeg(args) {
      this.calls.push(args);
      if (args.includes("-b:a")) await writeFile(args.at(-1), Buffer.from("canonical-m4a"));
    }
  }
  const normalizer = new FakeNormalizer();
  const result = await normalizer.normalize(Buffer.from("source"), "audio/webm");
  assert.equal(result.durationMilliseconds, 2400);
  assert.deepEqual(result.bytes, Buffer.from("canonical-m4a"));
  assert.equal(normalizer.calls.length, 2, "conversion and verification decode both ran");
  assert.ok(normalizer.calls[0].includes("64k"));
  assert.ok(normalizer.calls[0].includes("1"));
  await Promise.all(normalizer.paths.map((path) => assert.rejects(access(path))));
});

test("normalization rejects recordings beyond five minutes before conversion", async () => {
  class LongNormalizer extends ReportAudioNormalizer {
    converted = false;
    async probe() { return { format: { duration: String((REPORT_AUDIO_MAX_DURATION_MILLISECONDS + 1000) / 1000) }, streams: [] }; }
    async ffmpeg() { this.converted = true; }
  }
  const normalizer = new LongNormalizer();
  await assert.rejects(normalizer.normalize(Buffer.from("source"), "audio/ogg"), ReportAudioValidationError);
  assert.equal(normalizer.converted, false);
});

test("audio creation counts aggregate media, verifies authorized stored bytes, and returns Ready only afterward", async () => {
  const command = validCommand();
  const reportId = randomUUID(); const organizationId = randomUUID(); const userId = randomUUID();
  const canonical = Buffer.from("canonical-m4a");
  const sha256 = (await import("node:crypto")).createHash("sha256").update(canonical).digest("hex");
  const statements = [];
  const manager = { async query(sql, parameters = []) {
    statements.push({ sql, parameters });
    if (/from clinical\.report where/.test(sql)) return [{ id: reportId, organization_id: organizationId, status: "draft", revision: 4, report_media_allowance_bytes: 1 }];
    if (/from clinical\.command_receipt/.test(sql)) return [];
    if (/coalesce\(\(select sum\(byte_size\).*report_photo_note/s.test(sql)) return [{ used_bytes: 100 }];
    if (/from app_identity\.agency_settings/.test(sql)) return [{ allowance: command.effectiveAllowanceBytes }];
    if (/select blob\.canonical_bytes/.test(sql)) return [{ canonical_bytes: canonical, content_type: "audio/mp4", sha256 }];
    if (/from clinical\.report_note note/.test(sql) || /from clinical\.report_photo_note note/.test(sql)) return [];
    if (/from clinical\.report_audio_note note/.test(sql)) return [{ id: command.noteId, report_id: reportId, caption: command.caption,
      captured_at: command.capturedAt, captured_utc_offset_minutes: 120, created_by: userId, author_display_name: "Alex Clinician",
      server_received_at: command.capturedAt, updated_at: command.capturedAt, content_type: "audio/mp4", byte_size: canonical.length,
      sha256, duration_milliseconds: 2400 }];
    return [];
  } };
  let transactions = 0;
  const dataSource = { transaction: async (_isolation, work) => {
    transactions += 1;
    if (transactions === 1) return work({ query: async () => { throw Object.assign(new Error("rolled back"), { code: "40001" }); } });
    return work(manager);
  } };
  const sessions = { assertCsrf: async () => undefined, requireCapability: async () => ({ organization: { id: organizationId }, user: { id: userId } }) };
  let conversions = 0;
  const service = new ReportAudioService(dataSource, sessions, { normalize: async () => {
    conversions += 1;
    return { bytes: canonical, durationMilliseconds: 2400 };
  } });
  const result = await service.create("token", reportId, command, "csrf");
  assert.equal(result.note.persistenceState, "ready");
  assert.equal(result.note.durationMilliseconds, 2400);
  assert.equal(transactions, 2);
  assert.equal(conversions, 1, "transaction retries must not repeat audio conversion");
  assert.ok(statements.some(({ sql }) => /insert into clinical\.report_audio_blob/.test(sql)));
  assert.ok(statements.some(({ sql }) => /select blob\.canonical_bytes/.test(sql)));
  assert.ok(statements.some(({ sql }) => /report_photo_note[\s\S]*report_audio_note/.test(sql)));
  assert.ok(statements.some(({ sql }) => /agency_settings_change_event/.test(sql)));
});
