import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  DeleteReportTextNoteResponse,
  ReportTextNoteMutationResponse,
  ReportTextNote,
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { commandSha256 } from "./draft-report.validation.js";
import { reportTextNotes } from "./report-note.persistence.js";
import {
  ReportNoteValidationError,
  validateCreateReportTextNoteCommand,
  validateDeleteReportTextNoteCommand,
  validateUpdateReportTextNoteCommand,
} from "./report-note.validation.js";

type ReportRow = { id: string; organization_id: string; status: "draft" | "signed"; revision: string | number };
type ReceiptRow = { report_id: string | null; command_type: string; request_sha256: string; response_body: unknown };

@Injectable()
export class ReportNoteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService,
  ) {}

  async create(accessToken: string, reportId: string, input: unknown, csrfToken?: string): Promise<ReportTextNoteMutationResponse> {
    const command = this.validated(() => validateCreateReportTextNoteCommand(input));
    return this.mutate(accessToken, csrfToken, reportId, command.commandId, "create-report-text-note", command,
      async (manager, report, nextRevision, actorId) => {
        await manager.query(`insert into clinical.report_note
          (id, organization_id, report_id, captured_at, captured_utc_offset_minutes,
           content, created_by, updated_by)
          values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [command.noteId, report.organization_id, report.id, command.capturedAt,
          command.capturedUtcOffsetMinutes, command.content, actorId]);
        await this.recordRevision(manager, report.id, nextRevision, command.commandId, actorId,
          command.capturedAt, "create", command.noteId);
        const note = (await reportTextNotes(manager, report.id)).find((candidate): candidate is ReportTextNote => candidate.type === "text" && candidate.id === command.noteId)!;
        return { reportId: report.id, revision: nextRevision, note };
      });
  }

  async update(accessToken: string, reportId: string, noteId: string, input: unknown, csrfToken?: string): Promise<ReportTextNoteMutationResponse> {
    const command = this.validated(() => validateUpdateReportTextNoteCommand(input));
    return this.mutate(accessToken, csrfToken, reportId, command.commandId, "update-report-text-note", { ...command, noteId },
      async (manager, report, nextRevision, actorId) => {
        const changed = mutationRows<{ id: string }>(await manager.query(`update clinical.report_note
          set content = $4, updated_by = $3, updated_at = clock_timestamp()
          where report_id = $1 and id = $2 returning id`,
        [report.id, noteId, actorId, command.content]));
        if (!changed[0]) throw new NotFoundException(`Text note ${noteId} was not found`);
        await this.recordRevision(manager, report.id, nextRevision, command.commandId, actorId,
          null, "update", noteId);
        const note = (await reportTextNotes(manager, report.id)).find((candidate): candidate is ReportTextNote => candidate.type === "text" && candidate.id === noteId)!;
        return { reportId: report.id, revision: nextRevision, note };
      });
  }

  async delete(accessToken: string, reportId: string, noteId: string, input: unknown, csrfToken?: string): Promise<DeleteReportTextNoteResponse> {
    const command = this.validated(() => validateDeleteReportTextNoteCommand(input));
    return this.mutate(accessToken, csrfToken, reportId, command.commandId, "delete-report-text-note", { ...command, noteId },
      async (manager, report, nextRevision, actorId) => {
        const deleted = mutationRows<{ id: string }>(await manager.query(
          "delete from clinical.report_note where report_id = $1 and id = $2 returning id", [report.id, noteId]));
        if (!deleted[0]) throw new NotFoundException(`Text note ${noteId} was not found`);
        await this.recordRevision(manager, report.id, nextRevision, command.commandId, actorId,
          null, "delete", noteId);
        return { reportId: report.id, noteId, revision: nextRevision, deleted: true };
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
    const digest = commandSha256(command);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await this.sessions.assertCsrf(accessToken, csrfToken, manager);
        const session = await this.sessions.requireCapability(accessToken, "clinical:document", manager);
        await manager.query("select pg_advisory_xact_lock(hashtext($1))", [commandId]);
        const reports = await manager.query<ReportRow[]>(`select id, organization_id, status, revision
          from clinical.report where id = $1 and organization_id = $2 and documenting_user_id = $3 for update`,
        [reportId, session.organization.id, session.user.id]);
        const report = reports[0];
        if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
        const replay = await this.replay<T>(manager, commandId, commandType, digest, reportId);
        if (replay) return replay;
        if (report.status !== "draft") throw new ConflictException("Report notes are immutable after signing");
        const revision = Number(report.revision);
        if (command.expectedRevision !== revision) {
          throw new ConflictException({ message: "Draft revision does not match the server", expectedRevision: command.expectedRevision, currentRevision: revision });
        }
        const response = await apply(manager, report, revision + 1, session.user.id);
        await this.storeReceipt(manager, commandId, reportId, commandType, digest, response);
        return response;
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
      if (typeof error === "object" && error !== null && "code" in error &&
          ["23503", "23505", "23514", "40001", "40P01"].includes(String(error.code))) {
        throw new ConflictException("The note command conflicts with existing clinical data");
      }
      throw error;
    }
  }

  private async recordRevision(manager: EntityManager, reportId: string, revision: number, commandId: string,
    actorId: string, clientTime: string | null, action: "create" | "update" | "delete", noteId: string): Promise<void> {
    await manager.query(`with updated as (
        update clinical.report set revision = $2, updated_at = now() where id = $1 returning id
      )
      insert into clinical.report_change
        (report_id, revision, idempotency_key, author_id, client_time, changes)
      select updated.id, $2, $3, $4, $5, $6::jsonb from updated`,
    [reportId, revision, commandId, actorId, clientTime, JSON.stringify({ notes: [{ action, noteId }] })]);
  }

  private validated<T>(validate: () => T): T {
    try { return validate(); }
    catch (error) {
      if (error instanceof ReportNoteValidationError) {
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

  private async storeReceipt(manager: EntityManager, commandId: string, reportId: string, type: string,
    digest: string, response: unknown): Promise<void> {
    await manager.query(`insert into clinical.command_receipt
      (idempotency_key, report_id, command_type, request_sha256, response_status, response_body)
      values ($1, $2, $3, $4, 200, $5::jsonb)`,
    [commandId, reportId, type, digest, JSON.stringify(response)]);
  }
}
