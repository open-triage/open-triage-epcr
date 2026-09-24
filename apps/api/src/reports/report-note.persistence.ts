import type { ReportTextNote } from "@open-triage/contracts";
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

export async function reportTextNotes(manager: Queryable, reportId: string): Promise<ReadonlyArray<ReportTextNote>> {
  const rows = await manager.query<ReportNoteRow[]>(`
    select note.id, note.report_id, note.content, note.captured_at,
           note.captured_utc_offset_minutes, note.created_by,
           author.display_name as author_display_name,
           note.server_received_at, note.updated_at
    from clinical.report_note note
    join app_identity.app_user author
      on author.organization_id = note.organization_id and author.id = note.created_by
    where note.report_id = $1
    order by note.captured_at desc, note.id desc
  `, [reportId]);
  return rows.map(reportTextNote);
}
