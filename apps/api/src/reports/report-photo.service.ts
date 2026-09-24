import { createHash } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DeleteReportPhotoNoteResponse, ReportPhotoNote, ReportPhotoNoteMutationResponse } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { commandSha256 } from "./draft-report.validation.js";
import { reportTextNotes } from "./report-note.persistence.js";
import {
  inspectCanonicalJpeg,
  ReportPhotoValidationError,
  validateCreateReportPhotoNoteCommand,
  validateDeleteReportPhotoNoteCommand,
  validateUpdateReportPhotoCaptionCommand,
} from "./report-photo.validation.js";

type ReportRow = {
  id: string;
  organization_id: string;
  status: "draft" | "signed";
  revision: string | number;
  report_media_allowance_bytes: string | number;
};
type ReceiptRow = { report_id: string | null; command_type: string; request_sha256: string; response_body: unknown };

@Injectable()
export class ReportPhotoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService,
  ) {}

  async create(accessToken: string, reportId: string, input: unknown, csrfToken?: string): Promise<ReportPhotoNoteMutationResponse> {
    const command = this.validated(() => validateCreateReportPhotoNoteCommand(input));
    const bytes = Buffer.from(command.canonicalBase64, "base64");
    const dimensions = this.validated(() => inspectCanonicalJpeg(bytes));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== command.sha256) throw new UnprocessableEntityException("Canonical photo hash verification failed");
    if (dimensions.width !== command.width || dimensions.height !== command.height) {
      throw new UnprocessableEntityException("Canonical photo dimensions do not match the JPEG bytes");
    }
    return this.mutate(accessToken, csrfToken, reportId, command.commandId, "create-report-photo-note", command,
      async (manager, report, nextRevision, actorId) => {
        const usage = await manager.query<Array<{ used_bytes: string | number }>>(
          "select coalesce(sum(byte_size), 0) as used_bytes from clinical.report_photo_note where report_id = $1", [report.id]);
        const usedBytes = Number(usage[0]?.used_bytes ?? 0);
        const allowance = Number(report.report_media_allowance_bytes);
        if (usedBytes + bytes.byteLength > allowance) {
          throw new ConflictException({
            message: "The photo exceeds the report's remaining media allowance",
            allowanceBytes: allowance,
            usedBytes,
            remainingBytes: Math.max(0, allowance - usedBytes),
          });
        }
        await manager.query(`insert into clinical.report_photo_note
          (id, organization_id, report_id, captured_at, captured_utc_offset_minutes,
           caption, content_type, byte_size, sha256, width, height, created_by, updated_by)
          values ($1, $2, $3, $4, $5, $6, 'image/jpeg', $7, $8, $9, $10, $11, $11)`,
        [command.noteId, report.organization_id, report.id, command.capturedAt,
          command.capturedUtcOffsetMinutes, command.caption ?? null, bytes.byteLength, digest,
          dimensions.width, dimensions.height, actorId]);
        await manager.query(`insert into clinical.report_photo_blob
          (organization_id, report_id, note_id, canonical_bytes) values ($1, $2, $3, $4::bytea)`,
        [report.organization_id, report.id, command.noteId, bytes]);
        await this.recordRevision(manager, report.id, nextRevision, command.commandId, actorId,
          command.capturedAt, "create", command.noteId);
        const note = (await reportTextNotes(manager, report.id)).find(
          (candidate): candidate is ReportPhotoNote => candidate.type === "photo" && candidate.id === command.noteId)!;
        return { reportId: report.id, revision: nextRevision, note };
      });
  }

  async updateCaption(accessToken: string, reportId: string, noteId: string, input: unknown, csrfToken?: string): Promise<ReportPhotoNoteMutationResponse> {
    const command = this.validated(() => validateUpdateReportPhotoCaptionCommand(input));
    return this.mutate(accessToken, csrfToken, reportId, command.commandId, "update-report-photo-caption", { ...command, noteId },
      async (manager, report, nextRevision, actorId) => {
        const changed = mutationRows<{ id: string }>(await manager.query(`update clinical.report_photo_note
          set caption = $4, updated_by = $3, updated_at = clock_timestamp()
          where report_id = $1 and id = $2 returning id`, [report.id, noteId, actorId, command.caption ?? null]));
        if (!changed[0]) throw new NotFoundException(`Photo note ${noteId} was not found`);
        await this.recordRevision(manager, report.id, nextRevision, command.commandId, actorId, null, "update", noteId);
        const note = (await reportTextNotes(manager, report.id)).find(
          (candidate): candidate is ReportPhotoNote => candidate.type === "photo" && candidate.id === noteId)!;
        return { reportId: report.id, revision: nextRevision, note };
      });
  }

  async delete(accessToken: string, reportId: string, noteId: string, input: unknown, csrfToken?: string): Promise<DeleteReportPhotoNoteResponse> {
    const command = this.validated(() => validateDeleteReportPhotoNoteCommand(input));
    return this.mutate(accessToken, csrfToken, reportId, command.commandId, "delete-report-photo-note", { ...command, noteId },
      async (manager, report, nextRevision, actorId) => {
        const deleted = mutationRows<{ id: string }>(await manager.query(
          "delete from clinical.report_photo_note where report_id = $1 and id = $2 returning id", [report.id, noteId]));
        if (!deleted[0]) throw new NotFoundException(`Photo note ${noteId} was not found`);
        await this.recordRevision(manager, report.id, nextRevision, command.commandId, actorId, null, "delete", noteId);
        return { reportId: report.id, noteId, revision: nextRevision, deleted: true };
      });
  }

  async image(accessToken: string, reportId: string, noteId: string): Promise<{ bytes: Buffer; contentType: "image/jpeg"; sha256: string }> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.sessions.requireCapability(accessToken, "clinical:document", manager);
      const rows = await manager.query<Array<{ canonical_bytes: Buffer; content_type: "image/jpeg"; sha256: string }>>(`
        select blob.canonical_bytes, note.content_type, note.sha256
        from clinical.report_photo_note note
        join clinical.report_photo_blob blob
          on blob.report_id = note.report_id and blob.note_id = note.id
        join clinical.report report
          on report.organization_id = note.organization_id and report.id = note.report_id
        where note.report_id = $1 and note.id = $2 and note.organization_id = $3
          and report.documenting_user_id = $4`,
      [reportId, noteId, session.organization.id, session.user.id]);
      if (!rows[0]) throw new NotFoundException(`Photo note ${noteId} was not found`);
      return { bytes: rows[0].canonical_bytes, contentType: rows[0].content_type, sha256: rows[0].sha256 };
    });
  }

  private async mutate<T, Command extends { expectedRevision: number }>(
    accessToken: string,
    csrfToken: string | undefined,
    reportId: string,
    commandId: string,
    commandType: string,
    command: Command,
    apply: (manager: EntityManager, report: ReportRow, nextRevision: number, actorId: string) => Promise<T>,
  ): Promise<T> {
    const requestDigest = commandSha256(command);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await this.sessions.assertCsrf(accessToken, csrfToken, manager);
        const session = await this.sessions.requireCapability(accessToken, "clinical:document", manager);
        await manager.query("select pg_advisory_xact_lock(hashtext($1))", [commandId]);
        const reports = await manager.query<ReportRow[]>(`select id, organization_id, status, revision, report_media_allowance_bytes
          from clinical.report where id = $1 and organization_id = $2 and documenting_user_id = $3 for update`,
        [reportId, session.organization.id, session.user.id]);
        const report = reports[0];
        if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
        const replay = await this.replay<T>(manager, commandId, commandType, requestDigest, reportId);
        if (replay) return replay;
        if (report.status !== "draft") throw new ConflictException("Report photos are immutable after signing");
        const revision = Number(report.revision);
        if (command.expectedRevision !== revision) {
          throw new ConflictException({ message: "Draft revision does not match the server", expectedRevision: command.expectedRevision, currentRevision: revision });
        }
        const response = await apply(manager, report, revision + 1, session.user.id);
        await manager.query(`insert into clinical.command_receipt
          (idempotency_key, report_id, command_type, request_sha256, response_status, response_body)
          values ($1, $2, $3, $4, 200, $5::jsonb)`,
        [commandId, reportId, commandType, requestDigest, JSON.stringify(response)]);
        return response;
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
      if (typeof error === "object" && error !== null && "code" in error &&
          ["23503", "23505", "23514", "40001", "40P01"].includes(String(error.code))) {
        throw new ConflictException("The photo command conflicts with existing clinical data");
      }
      throw error;
    }
  }

  private async recordRevision(manager: EntityManager, reportId: string, revision: number, commandId: string,
    actorId: string, clientTime: string | null, action: "create" | "update" | "delete", noteId: string): Promise<void> {
    await manager.query(`with updated as (
        update clinical.report set revision = $2, updated_at = now() where id = $1 returning id
      ) insert into clinical.report_change
        (report_id, revision, idempotency_key, author_id, client_time, changes)
      select updated.id, $2, $3, $4, $5, $6::jsonb from updated`,
    [reportId, revision, commandId, actorId, clientTime, JSON.stringify({ photos: [{ action, noteId }] })]);
  }

  private validated<T>(validate: () => T): T {
    try { return validate(); }
    catch (error) {
      if (error instanceof ReportPhotoValidationError) {
        throw new UnprocessableEntityException({ message: error.message, findings: error.findings });
      }
      throw error;
    }
  }

  private async replay<T>(manager: EntityManager, commandId: string, type: string, digest: string, reportId: string): Promise<T | null> {
    const rows = await manager.query<ReceiptRow[]>("select * from clinical.command_receipt where idempotency_key = $1", [commandId]);
    const receipt = rows[0];
    if (!receipt) return null;
    if (receipt.command_type !== type || receipt.request_sha256 !== digest || receipt.report_id !== reportId) {
      throw new ConflictException("The command identity was already used with different content");
    }
    return receipt.response_body as T;
  }
}
