import { ConflictException } from "@nestjs/common";
import type { EntityManager } from "typeorm";

export type ReportNoteKind = "text" | "photo" | "audio";
export type ReportNoteAction = "create" | "update" | "delete";
export type NoteMutationResult = "applied" | "reconciled" | "idempotent";

type TargetState = {
  revision: string | number;
  action: ReportNoteAction;
};

export type NoteMutationContext = {
  result: NoteMutationResult;
  repeatedDelete: boolean;
};

/**
 * Applies the report reconciliation boundary to a stable note identity.
 * A stale command is safe when another target changed. For the same target,
 * the serialized later receipt wins, matching ordinary report reconciliation.
 * A deletion tombstone is the exception: it prevents a delayed upload from
 * reviving bytes that the clinician already deleted.
 */
export async function inspectNoteMutation(
  manager: Pick<EntityManager, "query">,
  reportId: string,
  noteType: ReportNoteKind,
  noteId: string,
  action: ReportNoteAction,
  expectedRevision: number,
  currentRevision: number,
): Promise<NoteMutationContext> {
  if (expectedRevision > currentRevision) {
    throw new ConflictException({
      message: "Draft revision is ahead of the server",
      expectedRevision,
      currentRevision,
    });
  }
  const rows = await manager.query<TargetState[]>(`
    select revision, action
    from clinical.report_note_target_state
    where report_id = $1 and note_type = $2 and note_id = $3
    for update
  `, [reportId, noteType, noteId]);
  const state = rows[0];
  if (action === "create" && state?.action === "delete") {
    throw new ConflictException("A deleted note identity cannot be recreated");
  }
  const repeatedDelete = action === "delete" && state?.action === "delete";
  return {
    repeatedDelete,
    result: repeatedDelete ? "idempotent"
      : state && Number(state.revision) > expectedRevision ? "reconciled" : "applied",
  };
}

export async function recordNoteMutation(
  manager: Pick<EntityManager, "query">,
  input: {
    organizationId: string;
    reportId: string;
    noteType: ReportNoteKind;
    noteId: string;
    action: ReportNoteAction;
    result: NoteMutationResult;
    commandId: string;
    actorId: string;
    reportRevision: number;
  },
): Promise<void> {
  if (input.result !== "idempotent") {
    await manager.query(`
      insert into clinical.report_note_target_state
        (report_id, note_type, note_id, revision, command_id, actor_id, action)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (report_id, note_type, note_id) do update set
        revision = excluded.revision, command_id = excluded.command_id,
        actor_id = excluded.actor_id, action = excluded.action,
        server_received_at = clock_timestamp()
    `, [input.reportId, input.noteType, input.noteId, input.reportRevision,
      input.commandId, input.actorId, input.action]);
  }
  await manager.query(`
    insert into clinical_audit.report_note_mutation_event
      (organization_id, report_id, note_id, note_type, command_id, actor_id,
       action, result, report_revision)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [input.organizationId, input.reportId, input.noteId, input.noteType,
    input.commandId, input.actorId, input.action, input.result, input.reportRevision]);
}

export async function recordMediaAccess(
  manager: Pick<EntityManager, "query">,
  input: {
    organizationId: string;
    reportId: string;
    noteId: string;
    mediaType: "photo" | "audio";
    actorId: string;
  },
): Promise<void> {
  await manager.query(`
    insert into clinical_audit.report_media_access_event
      (organization_id, report_id, note_id, media_type, actor_id, action, result)
    values ($1, $2, $3, $4, $5, $6, 'allowed')
  `, [input.organizationId, input.reportId, input.noteId, input.mediaType,
    input.actorId, input.mediaType === "photo" ? "open" : "retrieve"]);
}
