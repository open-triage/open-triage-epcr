import type { EntityManager } from "typeorm";
import type { SigningFinding } from "./sign-report.types.js";

type Queryable = Pick<EntityManager, "query">;

type TextRow = {
  id: string; content: string; captured_at: Date | string; captured_utc_offset_minutes: string | number;
  created_by: string; author_display_name: string | null; author_active: boolean | null;
};

type MediaRow = {
  id: string; caption: string | null; captured_at: Date | string; captured_utc_offset_minutes: string | number;
  created_by: string; author_display_name: string | null; author_active: boolean | null;
  content_type: string; byte_size: string | number; sha256: string; processing_state: string;
  blob_size: string | number | null; blob_sha256: string | null;
};

export type SignedNoteManifestEntry = {
  id: string;
  type: "text" | "photo" | "audio";
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  author: { id: string; displayName: string };
  normalizedText?: string;
  normalizedCaption?: string | null;
  media?: { mimeType: "image/jpeg" | "audio/mp4"; byteSize: number; sha256: string };
};

export type SignedNoteIntegrity = {
  notes: SignedNoteManifestEntry[];
  findings: SigningFinding[];
};

const RULE_VERSION = "note-readiness-1.0.0";

function finding(code: string, type: string, id: string, message: string): SigningFinding {
  return { severity: "error", code, path: `$.notes.${type}.${id}`, message, ruleVersion: RULE_VERSION };
}

/** Locks every persisted note and media blob, then validates the exact rows used in the signed manifest. */
export async function lockAndValidateReportNotes(manager: Queryable, report: {
  id: string; report_media_allowance_bytes: string | number; image_media_limit_bytes: string | number;
}): Promise<SignedNoteIntegrity> {
  const text = await manager.query<TextRow[]>(`
    select note.id, note.content, note.captured_at, note.captured_utc_offset_minutes,
           note.created_by, author.display_name as author_display_name, author.active as author_active
    from clinical.report_note note
    left join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
    order by note.captured_at, note.id
    for update of note
  `, [report.id]);
  const photos = await manager.query<MediaRow[]>(`
    select note.id, note.caption, note.captured_at, note.captured_utc_offset_minutes,
           note.created_by, author.display_name as author_display_name, author.active as author_active,
           note.content_type, note.byte_size, note.sha256, note.processing_state,
           octet_length(blob.canonical_bytes) as blob_size,
           encode(digest(blob.canonical_bytes, 'sha256'), 'hex') as blob_sha256
    from clinical.report_photo_note note
    left join clinical.report_photo_blob blob
      on blob.organization_id = note.organization_id and blob.report_id = note.report_id and blob.note_id = note.id
    left join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
    order by note.captured_at, note.id
    for update of note
  `, [report.id]);
  const audio = await manager.query<MediaRow[]>(`
    select note.id, note.caption, note.captured_at, note.captured_utc_offset_minutes,
           note.created_by, author.display_name as author_display_name, author.active as author_active,
           note.content_type, note.byte_size, note.sha256, note.processing_state,
           octet_length(blob.canonical_bytes) as blob_size,
           encode(digest(blob.canonical_bytes, 'sha256'), 'hex') as blob_sha256
    from clinical.report_audio_note note
    left join clinical.report_audio_blob blob
      on blob.organization_id = note.organization_id and blob.report_id = note.report_id and blob.note_id = note.id
    left join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
    order by note.captured_at, note.id
    for update of note
  `, [report.id]);
  // Lock blobs separately because PostgreSQL cannot lock the nullable side of
  // the outer joins used above to identify missing media.
  await manager.query("select note_id from clinical.report_photo_blob where report_id = $1 for update", [report.id]);
  await manager.query("select note_id from clinical.report_audio_blob where report_id = $1 for update", [report.id]);

  const targetRows = await manager.query<Array<{ note_type: string; note_id: string }>>(`
    select note_type, note_id from clinical.report_note_target_state
    where report_id = $1 and action <> 'delete'
    order by note_type, note_id
    for update
  `, [report.id]);
  const persisted = new Set([
    ...text.map(({ id }) => `text:${id}`), ...photos.map(({ id }) => `photo:${id}`), ...audio.map(({ id }) => `audio:${id}`),
  ]);
  const findings = targetRows.filter(({ note_type, note_id }) => !persisted.has(`${note_type}:${note_id}`))
    .map(({ note_type, note_id }) => finding("note.missing", note_type, note_id,
      "The note is missing from canonical storage. Retry its upload or delete it before signing."));

  const notes: SignedNoteManifestEntry[] = [];
  for (const row of text) {
    if (!row.author_active || !row.author_display_name) {
      findings.push(finding("note.unauthorized", "text", row.id,
        "The text note author is no longer authorized. Delete the note or restore authorization before signing."));
      continue;
    }
    notes.push({ id: row.id, type: "text", capturedAt: new Date(row.captured_at).toISOString(),
      capturedUtcOffsetMinutes: Number(row.captured_utc_offset_minutes),
      author: { id: row.created_by, displayName: row.author_display_name }, normalizedText: row.content });
  }

  let usedBytes = 0;
  const addMedia = (row: MediaRow, type: "photo" | "audio", mimeType: "image/jpeg" | "audio/mp4") => {
    if (row.processing_state !== "ready") {
      findings.push(finding("note.not-ready", type, row.id,
        `The ${type} note is ${row.processing_state}. Retry its upload or delete it before signing.`));
    }
    if (!row.author_active || !row.author_display_name) {
      findings.push(finding("note.unauthorized", type, row.id,
        `The ${type} note author is no longer authorized. Delete the note or restore authorization before signing.`));
    }
    const byteSize = Number(row.byte_size);
    usedBytes += byteSize;
    if (row.content_type !== mimeType || row.blob_size === null || row.blob_sha256 === null) {
      findings.push(finding("note.missing", type, row.id,
        `The ${type} note cannot be read from canonical storage. Retry its upload or delete it before signing.`));
    } else if (Number(row.blob_size) !== byteSize || row.blob_sha256 !== row.sha256) {
      findings.push(finding("note.integrity", type, row.id,
        `The ${type} note failed its byte-size or SHA-256 integrity check. Delete it and capture it again before signing.`));
    }
    if (row.author_active && row.author_display_name) {
      notes.push({ id: row.id, type, capturedAt: new Date(row.captured_at).toISOString(),
        capturedUtcOffsetMinutes: Number(row.captured_utc_offset_minutes),
        author: { id: row.created_by, displayName: row.author_display_name }, normalizedCaption: row.caption,
        media: { mimeType, byteSize, sha256: row.sha256 } });
    }
  };
  const imageLimit = Number(report.image_media_limit_bytes);
  for (const row of photos) {
    addMedia(row, "photo", "image/jpeg");
    if (!Number.isSafeInteger(imageLimit) || Number(row.byte_size) > imageLimit) {
      findings.push(finding("note.image-quota", "photo", row.id,
        `The photo uses ${Number(row.byte_size)} bytes, exceeding its valid ${imageLimit} byte per-image limit. Delete it before signing.`));
    }
  }
  audio.forEach((row) => addMedia(row, "audio", "audio/mp4"));
  const allowance = Number(report.report_media_allowance_bytes);
  if (!Number.isSafeInteger(allowance) || usedBytes > allowance) {
    findings.push(finding("note.quota", "media", report.id,
      `Report media uses ${usedBytes} bytes, exceeding its valid ${allowance} byte allowance. Delete media before signing.`));
  }
  notes.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)
    || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
  return { notes, findings };
}
