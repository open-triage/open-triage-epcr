import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { lockAndValidateReportNotes } from "../dist/reports/sign-report-notes.js";

const reportId = randomUUID();
const authorId = randomUUID();

function managerWith({ text = [], photos = [], audio = [], targets = [] } = {}) {
  const statements = [];
  return { statements, query: async (sql) => {
    statements.push(sql.replace(/\s+/g, " "));
    if (sql.includes("from clinical.report_note note")) return text;
    if (sql.includes("from clinical.report_photo_note note")) return photos;
    if (sql.includes("from clinical.report_audio_note note")) return audio;
    if (sql.includes("from clinical.report_note_target_state")) return targets;
    if (sql.includes("from clinical.report_photo_blob") || sql.includes("from clinical.report_audio_blob")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}

test("ready notes are locked and normalized into the signed integrity manifest", async () => {
  const textId = randomUUID();
  const photoId = randomUUID();
  const manager = managerWith({
    text: [{ id: textId, content: "Normalized narrative", captured_at: "2026-09-24T10:00:00Z",
      captured_utc_offset_minutes: 120, created_by: authorId, author_display_name: "Morgan Medic", author_active: true }],
    photos: [{ id: photoId, caption: "Front door", captured_at: "2026-09-24T10:01:00Z",
      captured_utc_offset_minutes: 120, created_by: authorId, author_display_name: "Morgan Medic", author_active: true,
      content_type: "image/jpeg", byte_size: 4, sha256: "a".repeat(64), processing_state: "ready",
      blob_size: 4, blob_sha256: "a".repeat(64) }],
  });
  const result = await lockAndValidateReportNotes(manager, { id: reportId, report_media_allowance_bytes: 10, image_media_limit_bytes: 10 });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.notes.map(({ id, type }) => ({ id, type })), [
    { id: textId, type: "text" }, { id: photoId, type: "photo" },
  ]);
  assert.equal(result.notes[0].normalizedText, "Normalized narrative");
  assert.deepEqual(result.notes[1].media, { mimeType: "image/jpeg", byteSize: 4, sha256: "a".repeat(64) });
  assert.equal(manager.statements.filter((sql) => /for update/.test(sql)).length, 6);
});

test("signing blockers cover races, missing and corrupt bytes, quota, and revoked authors", async () => {
  const photoId = randomUUID();
  const missingId = randomUUID();
  const audioId = randomUUID();
  const manager = managerWith({
    photos: [{ id: photoId, caption: null, captured_at: "2026-09-24T10:00:00Z", captured_utc_offset_minutes: 0,
      created_by: authorId, author_display_name: "Former Medic", author_active: false, content_type: "image/jpeg",
      byte_size: 8, sha256: "a".repeat(64), processing_state: "processing", blob_size: 7, blob_sha256: "b".repeat(64) }],
    audio: [{ id: audioId, caption: null, captured_at: "2026-09-24T10:00:01Z", captured_utc_offset_minutes: 0,
      created_by: authorId, author_display_name: "Morgan Medic", author_active: true, duration_milliseconds: 1500, content_type: "audio/mp4",
      byte_size: 8, sha256: "c".repeat(64), processing_state: "failed", blob_size: null, blob_sha256: null }],
    targets: [{ note_type: "text", note_id: missingId }],
  });
  const result = await lockAndValidateReportNotes(manager, { id: reportId, report_media_allowance_bytes: 10, image_media_limit_bytes: 10 });
  const codes = new Set(result.findings.map(({ code }) => code));
  assert.deepEqual(codes, new Set(["note.missing", "note.not-ready", "note.unauthorized", "note.integrity", "note.quota"]));
  assert.ok(result.findings.every(({ path }) => path.startsWith("$.notes.")));
});


test("signing pins immutable audio duration and blocks unavailable duration", async () => {
  const row={id:randomUUID(),caption:null,captured_at:'2026-10-19T10:00:00Z',captured_utc_offset_minutes:0,
    created_by:authorId,author_display_name:'Alex Example',author_active:true,content_type:'audio/mp4',
    byte_size:4,sha256:'a'.repeat(64),processing_state:'ready',blob_size:4,blob_sha256:'a'.repeat(64),duration_milliseconds:12345};
  const run = () => lockAndValidateReportNotes(managerWith({audio:[row]}),{id:reportId,report_media_allowance_bytes:10,image_media_limit_bytes:10});
  const ready=await run(); assert.deepEqual(ready.findings,[]); assert.equal(ready.notes[0].media.durationMilliseconds,12345);
  delete row.duration_milliseconds;
  assert.ok((await run()).findings.some(f=>f.code==='note.duration'));
});


test("audio duration finding follows the report agency language", async () => {
  for (const language of ['en','sv']) {
    const base=managerWith({audio:[{id:randomUUID(),caption:null,captured_at:'2026-10-19T10:00:00Z',captured_utc_offset_minutes:0,
      created_by:authorId,author_display_name:'Alex',author_active:true,content_type:'audio/mp4',byte_size:4,
      sha256:'a'.repeat(64),processing_state:'ready',blob_size:4,blob_sha256:'a'.repeat(64)}]});
    const manager={query:async(sql,params)=>{
      if(sql.includes('select language from app_identity.agency_settings')) {
        assert.deepEqual(params,['report-agency']); return [{language}];
      }
      return base.query(sql,params);
    }};
    const result=await lockAndValidateReportNotes(manager,{id:reportId,organization_id:'report-agency',report_media_allowance_bytes:10,image_media_limit_bytes:10});
    assert.match(result.findings.find(f=>f.code==='note.duration').message,language==='sv'?/Ljudlängden saknas/:/Audio duration is unavailable/);
  }
});
