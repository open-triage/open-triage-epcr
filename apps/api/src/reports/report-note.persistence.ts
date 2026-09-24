import type { ReportAudioNote, ReportNote, ReportPhotoNote, ReportTextNote } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

type Queryable = Pick<EntityManager, "query">;

type ReportNoteRow = {
  id: string;
  report_id: string;
  content: string;
  captured_at: Date | string;
  captured_utc_offset_minutes: string | number;
  created_by: string;
  author_display_name: string;
  server_received_at: Date | string;
  updated_at: Date | string;
};

type ReportPhotoRow = {
  id: string;
  report_id: string;
  caption: string | null;
  captured_at: Date | string;
  captured_utc_offset_minutes: string | number;
  created_by: string;
  author_display_name: string;
  server_received_at: Date | string;
  updated_at: Date | string;
  content_type: "image/jpeg";
  byte_size: string | number;
  sha256: string;
  width: string | number;
  height: string | number;
};

type ReportAudioRow = {
  id: string;
  report_id: string;
  caption: string | null;
  captured_at: Date | string;
  captured_utc_offset_minutes: string | number;
  created_by: string;
  author_display_name: string;
  server_received_at: Date | string;
  updated_at: Date | string;
  content_type: "audio/mp4";
  byte_size: string | number;
  sha256: string;
  duration_milliseconds: string | number;
};

export function reportTextNote(row: ReportNoteRow): ReportTextNote {
  return {
    id: row.id,
    reportId: row.report_id,
    type: "text",
    content: row.content,
    capturedAt: new Date(row.captured_at).toISOString(),
    capturedUtcOffsetMinutes: Number(row.captured_utc_offset_minutes),
    author: { id: row.created_by, displayName: row.author_display_name },
    serverReceivedAt: new Date(row.server_received_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    persistenceState: "ready",
  };
}

export function reportPhotoNote(row: ReportPhotoRow): ReportPhotoNote {
  return {
    id: row.id,
    reportId: row.report_id,
    type: "photo",
    caption: row.caption,
    capturedAt: new Date(row.captured_at).toISOString(),
    capturedUtcOffsetMinutes: Number(row.captured_utc_offset_minutes),
    author: { id: row.created_by, displayName: row.author_display_name },
    serverReceivedAt: new Date(row.server_received_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    persistenceState: "ready",
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    width: Number(row.width),
    height: Number(row.height),
  };
}

export function reportAudioNote(row: ReportAudioRow): ReportAudioNote {
  return {
    id: row.id,
    reportId: row.report_id,
    type: "audio",
    caption: row.caption,
    capturedAt: new Date(row.captured_at).toISOString(),
    capturedUtcOffsetMinutes: Number(row.captured_utc_offset_minutes),
    author: { id: row.created_by, displayName: row.author_display_name },
    serverReceivedAt: new Date(row.server_received_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    persistenceState: "ready",
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    durationMilliseconds: Number(row.duration_milliseconds),
  };
}

export async function reportTextNotes(manager: Queryable, reportId: string): Promise<ReadonlyArray<ReportNote>> {
  const textRows = await manager.query<ReportNoteRow[]>(`
    select note.id, note.report_id, note.content, note.captured_at,
           note.captured_utc_offset_minutes, note.created_by,
           author.display_name as author_display_name,
           note.server_received_at, note.updated_at
    from clinical.report_note note
    join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
  `, [reportId]);
  const photoRows = await manager.query<ReportPhotoRow[]>(`
    select note.id, note.report_id, note.caption, note.captured_at,
           note.captured_utc_offset_minutes, note.created_by,
           author.display_name as author_display_name,
           note.server_received_at, note.updated_at, note.content_type,
           note.byte_size, note.sha256, note.width, note.height
    from clinical.report_photo_note note
    join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
  `, [reportId]);
  const audioRows = await manager.query<ReportAudioRow[]>(`
    select note.id, note.report_id, note.caption, note.captured_at,
           note.captured_utc_offset_minutes, note.created_by,
           author.display_name as author_display_name,
           note.server_received_at, note.updated_at, note.content_type,
           note.byte_size, note.sha256, note.duration_milliseconds
    from clinical.report_audio_note note
    join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
  `, [reportId]);
  return [...textRows.map(reportTextNote), ...photoRows.map(reportPhotoNote), ...audioRows.map(reportAudioNote)]
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id));
}
