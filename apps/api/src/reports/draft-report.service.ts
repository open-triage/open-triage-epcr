import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type { DispatchConflict, EncounterValue, OpenCallsResponse, ReopenOpenCallResponse, ResolveDispatchConflictCommand } from "@open-triage/contracts";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import type {
  CreateDraftReportCommand,
  DraftGroupMutation,
  DraftOccurrenceMutation,
  DraftReportResult,
  DraftValue,
  PostSignatureDraftResult,
  SaveDraftReportResult,
  SaveDraftReportCommand
} from "./draft-report.types.js";
import {
  commandSha256,
  DraftReportValidationError,
  validateCreateDraftReportCommand,
  validateSaveDraftReportCommand
} from "./draft-report.validation.js";
import { dispatchConflicts, encounterDocument } from "./encounter-document.persistence.js";

type ReceiptRow = {
  report_id: string | null;
  command_type: string;
  request_sha256: string;
  response_status: number;
  response_body: unknown;
};

type ReportRow = {
  id: string;
  status: "draft" | "signed";
  revision: string | number;
  organization_id: string;
  incident_id: string;
  patient_id: string;
  agency_demographic_version_id: string;
  form_version_id: string;
  catalog_release_id: string;
  documenting_user_id: string;
};

type ElementMetadata = {
  element_identity_id: string;
  base_datatype: string;
  analytical_repeatable: boolean;
  identifying: boolean;
  allowed_absence_states: string[];
};

type OpenCallRow = {
  report_id: string;
  status: "draft" | "signed";
  call_number: string;
  dispatched_at: Date | string;
  dispatch_reason: string | null;
  chief_complaint: string | null;
  unit_call_sign: string;
  last_saved_at: Date | string;
  revision: string | number;
  form_version_id: string;
  catalog_release_id: string;
  validation_error_count: string | number;
};

type DraftTargetType = "group" | "occurrence";

type DraftTargetStateRow = {
  target_type: DraftTargetType;
  target_id: string;
  revision: string | number;
  idempotency_key: string;
  author_id: string;
  device_id: string | null;
  client_time: Date | string | null;
  server_received_time: Date | string;
  base_revision: string | number;
  target_value: DraftGroupMutation | DraftOccurrenceMutation;
};

type IncomingTarget = {
  targetType: DraftTargetType;
  targetId: string;
  value: DraftGroupMutation | DraftOccurrenceMutation;
  revision: number;
  commandId: string;
  authorId: string;
  deviceId: string | null;
  clientTime: string | null;
  serverReceivedTime: Date | string;
  baseRevision: number;
};

type ReconciliationAudit = {
  targetType: DraftTargetType;
  targetId: string;
  losing: IncomingTarget;
  winning: IncomingTarget;
  resolution: "client-time" | "server-receipt-order";
};

const TRUSTWORTHY_CLIENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function conflictDraftValue(value: EncounterValue, baseDatatype: string): DraftValue {
  if (value.kind === "coded") return { kind: "coded", code: value.code, codeSystem: value.system, display: value.display };
  if (value.kind === "pertinent-negative") return { kind: "pertinent-negative", absenceCode: value.code, display: value.display };
  if (value.kind === "null") return value.notValue
    ? { kind: "null", absenceCode: value.notValue.code, display: value.notValue.display }
    : { kind: "absent" };
  if (value.kind === "absent") return { kind: "absent" };
  if (typeof value.value === "boolean") return { kind: "boolean", value: value.value };
  if (typeof value.value === "number") return Number.isInteger(value.value)
    ? { kind: "integer", value: value.value } : { kind: "numeric", value: value.value };
  const scalarKind: Record<string, DraftValue["kind"]> = {
    string: "text", anyURI: "uri", integer: "integer", decimal: "numeric", boolean: "boolean",
    date: "date", dateTime: "datetime", time: "time", duration: "duration", binary: "binary"
  };
  return { kind: scalarKind[baseDatatype] ?? "text", value: value.value } as DraftValue;
}

@Injectable()
export class DraftReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async create(accessToken: string, input: unknown): Promise<DraftReportResult> {
    const session = this.sessions.get(accessToken);
    let command: CreateDraftReportCommand;
    try {
      command = validateCreateDraftReportCommand(input);
    } catch (error) {
      this.rethrowValidation(error);
    }
    if (command.documentingUserId !== session.user.id || command.organizationId !== session.organization.id) {
      throw new NotFoundException("The draft is not available to this clinician");
    }
    const patientKeyConfig = patientKeyConfigFromEnvironment(process.env);
    const patientPseudonymousKey = derivePatientKey(
      patientKeyConfig, command.organizationId, command.patientId
    );
    const digest = commandSha256(command);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await this.lockCommand(manager, command.commandId);
        const replay = await this.replay<DraftReportResult>(manager, command.commandId, "create-draft", digest, command.reportId);
        if (replay) return replay;

        const users = await manager.query<Array<{ id: string }>>(`
          select id from app_identity.app_user
          where id = $1 and organization_id = $2 and active
        `, [command.documentingUserId, command.organizationId]);
        if (!users[0]) throw new UnprocessableEntityException("documentingUserId must be an active user in the organization");

        const active = await manager.query<Array<{
          form_version_id: string;
          catalog_release_id: string;
          agency_demographic_version_id: string;
        }>>(`
          select fv.id as form_version_id, fv.catalog_release_id,
                 (select adv.id from app_identity.agency_demographic_version adv
                  where adv.organization_id = f.organization_id
                    and adv.catalog_release_id = fv.catalog_release_id
                    and adv.effective_from <= now()
                  order by adv.effective_from desc, adv.version desc limit 1) as agency_demographic_version_id
          from forms.form f
          join lateral (
            select candidate.id, candidate.catalog_release_id
            from forms.form_version candidate
            where candidate.form_id = f.id and candidate.status = 'published'
            order by candidate.version desc limit 1
          ) fv on true
          where f.id = $1 and f.organization_id = $2
        `, [command.formId, command.organizationId]);
        if (!active[0]) throw new NotFoundException("No active published form version was found for the organization");
        if (!active[0].agency_demographic_version_id) {
          throw new UnprocessableEntityException("No effective agency demographic version matches the active form catalog");
        }

        await manager.query(`
          insert into clinical.incident (id, organization_id)
          values ($1, $2) on conflict (id) do nothing
        `, [command.incidentId, command.organizationId]);
        await manager.query(`
          insert into clinical.patient
            (id, organization_id, identity_state, pseudonymous_key, pseudonymous_key_version)
          values ($1, $2, $3, $4, $5) on conflict (id) do nothing
        `, [command.patientId, command.organizationId, command.patientIdentityState,
          patientPseudonymousKey, patientKeyConfig.keyVersion]);

        const related = await manager.query<Array<{ incident_ok: boolean; patient_ok: boolean }>>(`
          select
            exists(select 1 from clinical.incident where id = $1 and organization_id = $3) as incident_ok,
            exists(select 1 from clinical.patient where id = $2 and organization_id = $3
                   and identity_state = $4 and pseudonymous_key = $5
                   and pseudonymous_key_version = $6) as patient_ok
        `, [command.incidentId, command.patientId, command.organizationId,
          command.patientIdentityState, patientPseudonymousKey, patientKeyConfig.keyVersion]);
        if (!related[0]?.incident_ok || !related[0]?.patient_ok) {
          throw new ConflictException("A stable incident or patient identity already belongs to different data");
        }

        await manager.query(`
          insert into clinical.report
            (id, organization_id, incident_id, patient_id, agency_demographic_version_id,
             form_version_id, catalog_release_id, documenting_user_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict (id) do nothing
        `, [command.reportId, command.organizationId, command.incidentId, command.patientId,
          active[0].agency_demographic_version_id, active[0].form_version_id,
          active[0].catalog_release_id, command.documentingUserId]);
        const result = await this.reportResult(manager, command.reportId);
        if (result.organizationId !== command.organizationId || result.incidentId !== command.incidentId ||
            result.patientId !== command.patientId || result.formVersionId !== active[0].form_version_id ||
            result.agencyDemographicVersionId !== active[0].agency_demographic_version_id ||
            result.documentingUserId !== command.documentingUserId) {
          throw new ConflictException("The stable report identity already belongs to a different draft");
        }
        await this.storeReceipt(manager, command.commandId, command.reportId, "create-draft", digest, result);
        return result;
      });
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  async save(accessToken: string, reportId: string, input: unknown): Promise<SaveDraftReportResult> {
    const session = this.sessions.get(accessToken);
    let command: SaveDraftReportCommand;
    try {
      command = validateSaveDraftReportCommand(input);
    } catch (error) {
      this.rethrowValidation(error);
    }
    const digest = commandSha256(command);
    try {
      // The report row lock provides the serialization point while READ COMMITTED lets a
      // waiter observe the winner that committed before it acquired that lock.
      return await this.dataSource.transaction("READ COMMITTED", async (manager) => {
        await this.lockCommand(manager, command.commandId);
        const rows = await manager.query<ReportRow[]>(`
          select * from clinical.report
          where id = $1 and organization_id = $2 and documenting_user_id = $3
          for update
        `, [reportId, session.organization.id, session.user.id]);
        const report = rows[0];
        if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
        if (command.authorId !== session.user.id) {
          throw new NotFoundException("The draft is not available to this clinician");
        }
        const replay = await this.replay<SaveDraftReportResult>(manager, command.commandId, "save-draft", digest, reportId);
        if (replay) return replay;
        const authors = await manager.query<Array<{ id: string }>>(`
          select id from app_identity.app_user where id = $1 and organization_id = $2 and active
        `, [command.authorId, report.organization_id]);
        if (!authors[0]) throw new UnprocessableEntityException("authorId must be an active user in the report organization");

        if (report.status === "signed") {
          return this.retainPostSignatureAttempt(manager, report, command, digest);
        }
        const revision = Number(report.revision);
        if (command.expectedRevision > revision) {
          throw new ConflictException({ message: "Draft revision is ahead of the server", expectedRevision: command.expectedRevision, currentRevision: revision });
        }

        const nextRevision = revision + 1;
        const received = await manager.query<Array<{ received_at: Date | string }>>("select clock_timestamp() as received_at");
        const serverReceivedTime = received[0]!.received_at;
        const winningGroups: DraftGroupMutation[] = [];
        const winningOccurrences: DraftOccurrenceMutation[] = [];
        const winningTargets: IncomingTarget[] = [];
        const audits: ReconciliationAudit[] = [];
        const targets: Array<{ type: DraftTargetType; value: DraftGroupMutation | DraftOccurrenceMutation }> = [
          ...(command.groups ?? []).map((value) => ({ type: "group" as const, value })),
          ...(command.occurrences ?? []).map((value) => ({ type: "occurrence" as const, value }))
        ];
        for (const target of targets) {
          const incoming: IncomingTarget = {
            targetType: target.type,
            targetId: target.value.id,
            value: target.value,
            revision: nextRevision,
            commandId: command.commandId,
            authorId: command.authorId,
            deviceId: command.deviceId ?? null,
            clientTime: command.clientTime ?? null,
            serverReceivedTime,
            baseRevision: command.expectedRevision
          };
          const current = await this.targetState(manager, report.id, target.type, target.value.id);
          if (current) this.assertStableTarget(current.target_value, target.value, target.type);
          if (target.type === "occurrence" && !(target.value as DraftOccurrenceMutation).tombstone) {
            const occurrence = target.value as DraftOccurrenceMutation;
            const metadata = await this.elementMetadata(manager, report, occurrence);
            this.validateDatatype(occurrence.value!, metadata, occurrence.elementId);
          }
          let incomingWins = true;
          if (current && Number(current.revision) > command.expectedRevision) {
            const prior = this.targetFromState(current);
            const decision = this.selectConcurrentWinner(prior, incoming);
            incomingWins = decision.winner === incoming;
            audits.push({
              targetType: target.type,
              targetId: target.value.id,
              losing: decision.winner === incoming ? prior : incoming,
              winning: decision.winner,
              resolution: decision.resolution
            });
          }
          if (incomingWins) {
            winningTargets.push(incoming);
            if (target.type === "group") winningGroups.push(target.value as DraftGroupMutation);
            else winningOccurrences.push(target.value as DraftOccurrenceMutation);
          }
        }

        await this.applyGroups(manager, report, { ...command, groups: winningGroups });
        for (const occurrence of winningOccurrences) await this.applyOccurrence(manager, report, command, occurrence);

        await manager.query(`
          update clinical.report set revision = $2, updated_at = now() where id = $1
        `, [reportId, nextRevision]);
        await manager.query(`
          insert into clinical.report_change
            (report_id, revision, idempotency_key, author_id, device_id, client_time, changes)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `, [reportId, nextRevision, command.commandId, command.authorId,
          command.deviceId ?? null, command.clientTime ?? null, JSON.stringify({
            baseRevision: command.expectedRevision,
            groups: command.groups ?? [], occurrences: command.occurrences ?? []
          })]);
        for (const target of winningTargets) await this.storeTargetState(manager, report.id, target);
        for (const audit of audits) await this.storeReconciliationAudit(manager, report.id, audit);
        const result = await this.reportResult(manager, reportId);
        await this.storeReceipt(manager, command.commandId, reportId, "save-draft", digest, result);
        return result;
      });
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  private async retainPostSignatureAttempt(
    manager: EntityManager,
    report: ReportRow,
    command: SaveDraftReportCommand,
    digest: string
  ): Promise<PostSignatureDraftResult> {
    const snapshots = await manager.query<Array<{
      id: string;
      signed_revision: string | number;
      canonical_sha256: string;
    }>>(`
      select id, signed_revision, canonical_sha256
      from clinical.signed_snapshot where report_id = $1
    `, [report.id]);
    const snapshot = snapshots[0];
    if (!snapshot) throw new ConflictException("The signed report snapshot is unavailable");

    const received = await manager.query<Array<{ received_at: Date | string }>>(
      "select clock_timestamp() as received_at"
    );
    const serverReceivedTime = received[0]!.received_at;
    const targets: Array<{ type: DraftTargetType; value: DraftGroupMutation | DraftOccurrenceMutation }> = [
      ...(command.groups ?? []).map((value) => ({ type: "group" as const, value })),
      ...(command.occurrences ?? []).map((value) => ({ type: "occurrence" as const, value }))
    ];
    for (const target of targets) {
      await manager.query(`
        insert into clinical_audit.post_signature_audit_note
          (report_id, idempotency_key, target_type, target_id, attempted_change,
           author_id, device_id, client_edit_time, server_received_time,
           expected_revision, signed_revision, signed_snapshot_id, signed_canonical_sha256)
        values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [report.id, command.commandId, target.type, target.value.id,
        JSON.stringify(target.value), command.authorId, command.deviceId ?? null,
        command.clientTime ?? null, serverReceivedTime, command.expectedRevision,
        snapshot.signed_revision, snapshot.id, snapshot.canonical_sha256]);
    }
    const result: PostSignatureDraftResult = {
      id: report.id,
      status: "signed",
      revision: Number(report.revision),
      signedRevision: Number(snapshot.signed_revision),
      signedSnapshotId: snapshot.id,
      canonicalSha256: snapshot.canonical_sha256,
      retainedAuditNoteCount: targets.length
    };
    await this.storeReceipt(manager, command.commandId, report.id, "save-draft", digest, result);
    return result;
  }

  private async targetState(
    manager: EntityManager,
    reportId: string,
    targetType: DraftTargetType,
    targetId: string
  ): Promise<DraftTargetStateRow | null> {
    const rows = await manager.query<DraftTargetStateRow[]>(`
      select target_type, target_id, revision, idempotency_key, author_id, device_id,
             client_time, server_received_time, base_revision, target_value
      from clinical.draft_target_state
      where report_id = $1 and target_type = $2 and target_id = $3
      for update
    `, [reportId, targetType, targetId]);
    return rows[0] ?? null;
  }

  private targetFromState(state: DraftTargetStateRow): IncomingTarget {
    return {
      targetType: state.target_type,
      targetId: state.target_id,
      value: state.target_value,
      revision: Number(state.revision),
      commandId: state.idempotency_key,
      authorId: state.author_id,
      deviceId: state.device_id,
      clientTime: state.client_time ? new Date(state.client_time).toISOString() : null,
      serverReceivedTime: state.server_received_time,
      baseRevision: Number(state.base_revision)
    };
  }

  private assertStableTarget(
    current: DraftGroupMutation | DraftOccurrenceMutation,
    incoming: DraftGroupMutation | DraftOccurrenceMutation,
    targetType: DraftTargetType
  ): void {
    const same = targetType === "group"
      ? (current as DraftGroupMutation).groupId === (incoming as DraftGroupMutation).groupId &&
        (current as DraftGroupMutation).customGroupDefinitionId === (incoming as DraftGroupMutation).customGroupDefinitionId
      : (current as DraftOccurrenceMutation).elementId === (incoming as DraftOccurrenceMutation).elementId;
    if (!same) throw new ConflictException(`Stable ${targetType} identity ${incoming.id} belongs to different data`);
  }

  private trustworthyClientTime(target: IncomingTarget): number | null {
    if (!target.clientTime) return null;
    const clientTime = new Date(target.clientTime).getTime();
    const receivedTime = new Date(target.serverReceivedTime).getTime();
    return clientTime <= receivedTime + TRUSTWORTHY_CLIENT_FUTURE_SKEW_MS ? clientTime : null;
  }

  private selectConcurrentWinner(
    current: IncomingTarget,
    incoming: IncomingTarget
  ): { winner: IncomingTarget; resolution: ReconciliationAudit["resolution"] } {
    const currentClientTime = this.trustworthyClientTime(current);
    const incomingClientTime = this.trustworthyClientTime(incoming);
    if (currentClientTime !== null && incomingClientTime !== null && currentClientTime !== incomingClientTime) {
      return {
        winner: incomingClientTime > currentClientTime ? incoming : current,
        resolution: "client-time"
      };
    }
    // The report row lock serializes receipts. The incoming revision is therefore the
    // deterministic later receipt even when PostgreSQL timestamps have equal precision.
    return { winner: incoming, resolution: "server-receipt-order" };
  }

  private async storeTargetState(manager: EntityManager, reportId: string, target: IncomingTarget): Promise<void> {
    await manager.query(`
      insert into clinical.draft_target_state
        (report_id, target_type, target_id, revision, idempotency_key, author_id, device_id,
         client_time, server_received_time, base_revision, target_value)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      on conflict (report_id, target_type, target_id) do update set
        revision = excluded.revision, idempotency_key = excluded.idempotency_key,
        author_id = excluded.author_id, device_id = excluded.device_id,
        client_time = excluded.client_time, server_received_time = excluded.server_received_time,
        base_revision = excluded.base_revision, target_value = excluded.target_value
    `, [reportId, target.targetType, target.targetId, target.revision, target.commandId,
      target.authorId, target.deviceId, target.clientTime, target.serverReceivedTime,
      target.baseRevision, JSON.stringify(target.value)]);
  }

  private async storeReconciliationAudit(
    manager: EntityManager,
    reportId: string,
    audit: ReconciliationAudit
  ): Promise<void> {
    await manager.query(`
      insert into clinical_audit.draft_reconciliation
        (report_id, target_type, target_id, losing_value, losing_author_id, losing_device_id,
         losing_client_time, losing_server_received_time, losing_base_revision,
         winning_revision, winning_idempotency_key, winning_author_id, winning_device_id,
         winning_client_time, winning_server_received_time, winning_base_revision, resolution)
      values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [reportId, audit.targetType, audit.targetId, JSON.stringify(audit.losing.value),
      audit.losing.authorId, audit.losing.deviceId, audit.losing.clientTime,
      audit.losing.serverReceivedTime, audit.losing.baseRevision, audit.winning.revision,
      audit.winning.commandId, audit.winning.authorId, audit.winning.deviceId,
      audit.winning.clientTime, audit.winning.serverReceivedTime,
      audit.winning.baseRevision, audit.resolution]);
  }

  async get(accessToken: string, reportId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(accessToken);
    return this.dataSource.transaction(async (manager) => {
      const report = await this.reportResult(manager, reportId, session.organization.id, session.user.id);
      const groups = await manager.query<Array<Record<string, unknown>>>(`
        select id, parent_group_instance_id as "parentGroupInstanceId", group_id as "groupId",
               source_kind as "sourceKind", custom_group_definition_id as "customGroupDefinitionId",
               ordinal, correlation_id as "correlationId", documented_time as "documentedTime",
               documented_utc_offset_minutes as "documentedUtcOffsetMinutes",
               server_received_time as "serverReceivedTime", tombstoned_at as "tombstonedAt"
        from clinical.group_instance where report_id = $1 order by group_id, ordinal, id
      `, [reportId]);
      const occurrences = await manager.query<Array<Record<string, unknown>>>(`
        select id, group_instance_id as "groupInstanceId", element_identity_id as "elementIdentityId",
               element_id as "elementId", form_field_id as "formFieldId", ordinal,
               analytical_repeatable as "analyticalRepeatable", identifying, value_kind as "valueKind",
               value_text as "valueText", value_integer as "valueInteger", value_numeric as "valueNumeric",
               value_boolean as "valueBoolean", value_date as "valueDate", value_datetime as "valueDatetime",
               value_time as "valueTime", value_duration as "valueDuration", encode(value_binary, 'base64') as "valueBinary",
               value_lexical as "valueLexical", value_utc_offset_minutes as "valueUtcOffsetMinutes",
               value_precision as "valuePrecision", code, code_system as "codeSystem", code_display as "codeDisplay",
               terminology_version as "terminologyVersion", absence_code as "absenceCode",
               absence_display as "absenceDisplay", source_attributes as "sourceAttributes",
               correlation_id as "correlationId", provenance_kind as "provenanceKind",
               provenance_detail as "provenanceDetail", documented_time as "documentedTime",
               documented_utc_offset_minutes as "documentedUtcOffsetMinutes",
               documented_precision as "documentedPrecision", server_received_time as "serverReceivedTime",
               author_id as "authorId", tombstoned_at as "tombstonedAt"
        from clinical.element_occurrence where report_id = $1 order by element_id, ordinal, id
      `, [reportId]);
      return { ...report, groups, occurrences };
    });
  }

  async listOpen(accessToken: string, now = new Date()): Promise<OpenCallsResponse> {
    const session = this.sessions.get(accessToken, now);
    const rows = await this.dataSource.query<OpenCallRow[]>(`
      select r.id as report_id, r.status, ca.call_number, ca.dispatched_at,
             ca.dispatch_reason, ca.chief_complaint, ou.call_sign as unit_call_sign,
             r.updated_at as last_saved_at,
             r.revision, r.form_version_id, r.catalog_release_id,
             count(vf.id) filter (where vf.severity = 'error' and vf.revision = r.revision)::integer
               as validation_error_count
      from clinical.report r
      join clinical.call_assignment ca
        on ca.organization_id = r.organization_id and ca.report_id = r.id
      join app_identity.operational_unit ou on ou.id = ca.unit_id
      left join clinical.validation_finding vf on vf.report_id = r.id
      where r.organization_id = $1 and r.documenting_user_id = $2 and r.status in ('draft', 'signed')
      group by r.id, ca.id, ou.call_sign
      order by r.updated_at desc, r.id
    `, [session.organization.id, session.user.id]);
    return {
      openCalls: rows.filter((row) => row.status === "draft").map((row) => ({
        reportId: row.report_id,
        callNumber: row.call_number,
        dispatchedAt: new Date(row.dispatched_at).toISOString(),
        dispatchReason: row.dispatch_reason,
        chiefComplaint: row.chief_complaint,
        unitCallSign: row.unit_call_sign,
        lastSavedAt: new Date(row.last_saved_at).toISOString(),
        syncStatus: "saved",
        validationErrorCount: Number(row.validation_error_count),
        revision: Number(row.revision),
        formVersionId: row.form_version_id,
        catalogReleaseId: row.catalog_release_id
      })),
      completedReportIds: rows.filter((row) => row.status === "signed").map((row) => row.report_id),
      refreshedAt: now.toISOString()
    };
  }

  async reopen(accessToken: string, reportId: string): Promise<ReopenOpenCallResponse> {
    const session = this.sessions.get(accessToken);
    const details = await this.get(accessToken, reportId);
    const document = await this.dataSource.transaction((manager) => encounterDocument(manager, reportId));
    const conflicts = await this.dataSource.transaction((manager) => dispatchConflicts(manager, reportId));
    const calls = await this.dataSource.query<Array<{
      call_number: string;
      dispatched_at: Date | string;
      dispatch_reason: string | null;
      chief_complaint: string | null;
      unit_call_sign: string;
    }>>(`
      select ca.call_number, ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint,
             ou.call_sign as unit_call_sign
      from clinical.call_assignment ca
      join clinical.report r on r.id = ca.report_id and r.organization_id = ca.organization_id
      join app_identity.operational_unit ou on ou.id = ca.unit_id
      where r.id = $1 and r.organization_id = $2 and r.documenting_user_id = $3
        and r.status = 'draft'
    `, [reportId, session.organization.id, session.user.id]);
    if (!calls[0]) throw new NotFoundException(`Report ${reportId} was not found`);
    return {
      callNumber: calls[0].call_number,
      dispatchedAt: new Date(calls[0].dispatched_at).toISOString(),
      dispatchReason: calls[0].dispatch_reason,
      chiefComplaint: calls[0].chief_complaint,
      unitCallSign: calls[0].unit_call_sign,
      report: {
        id: String(details.id),
        documentingUserId: String(details.documentingUserId),
        formVersionId: String(details.formVersionId),
        catalogReleaseId: String(details.catalogReleaseId),
        revision: Number(details.revision),
        status: "draft",
        document,
        dispatchConflicts: conflicts
      }
    };
  }

  async resolveDispatchConflict(
    accessToken: string,
    reportId: string,
    conflictId: string,
    input: unknown
  ): Promise<DispatchConflict> {
    const session = this.sessions.get(accessToken);
    if (!input || typeof input !== "object" || !uuidV4.test(String((input as ResolveDispatchConflictCommand).commandId)) ||
        !["keep", "accept", "acknowledge"].includes(String((input as ResolveDispatchConflictCommand).disposition))) {
      throw new UnprocessableEntityException("A UUIDv4 commandId and keep, accept, or acknowledge disposition are required");
    }
    const command = input as ResolveDispatchConflictCommand;
    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const reports = await manager.query<ReportRow[]>(`select * from clinical.report
        where id = $1 and organization_id = $2 and documenting_user_id = $3 for update`,
      [reportId, session.organization.id, session.user.id]);
      const report = reports[0];
      if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
      if (report.status !== "draft") throw new ConflictException("Signed dispatch conflicts require an amendment");
      const rows = await manager.query<Array<{
        id: string; occurrence_id: string; element_id: string; dispatch_value: EncounterValue | null;
        disposition: string | null; group_instance_id: string | null; ordinal: string | number; base_datatype: string;
      }>>(`select dc.id, dc.occurrence_id, dc.element_id, dc.dispatch_value, dc.disposition,
                 eo.group_instance_id, eo.ordinal, ed.base_datatype
          from clinical.dispatch_conflict dc join clinical.element_occurrence eo
            on eo.report_id = dc.report_id and eo.id = dc.occurrence_id
          join catalog.element_definition ed
            on ed.release_id = eo.catalog_release_id and ed.element_identity_id = eo.element_identity_id
          where dc.id = $1 and dc.report_id = $2 for update of dc`, [conflictId, reportId]);
      const conflict = rows[0];
      if (!conflict) throw new NotFoundException(`Dispatch conflict ${conflictId} was not found`);
      if (conflict.disposition) throw new ConflictException("Dispatch conflict is already resolved");
      const nextRevision = Number(report.revision) + 1;
      if (command.disposition === "accept") {
        await this.applyOccurrence(manager, report, {
          commandId: command.commandId, expectedRevision: Number(report.revision), authorId: session.user.id,
          occurrences: []
        }, {
          id: conflict.occurrence_id, elementId: conflict.element_id,
          groupInstanceId: conflict.group_instance_id, ordinal: Number(conflict.ordinal),
          ...(conflict.dispatch_value ? { value: conflictDraftValue(conflict.dispatch_value, conflict.base_datatype) } : { tombstone: true })
        });
      }
      await manager.query(`update clinical.dispatch_conflict
        set disposition = $2, resolved_by = $3, resolved_at = now() where id = $1`,
      [conflict.id, command.disposition, session.user.id]);
      await manager.query("update clinical.report set revision = $2, updated_at = now() where id = $1", [reportId, nextRevision]);
      await manager.query(`insert into clinical.report_change
        (report_id, revision, idempotency_key, author_id, changes)
        values ($1,$2,$3,$4,$5::jsonb)`, [reportId, nextRevision, command.commandId, session.user.id,
        JSON.stringify({ dispatchConflictId: conflict.id, disposition: command.disposition })]);
      return (await dispatchConflicts(manager, reportId)).find(({ id }) => id === conflict.id)!;
    });
  }

  private async applyGroups(manager: EntityManager, report: ReportRow, command: SaveDraftReportCommand): Promise<void> {
    const mutations = command.groups ?? [];
    const upserts = mutations.filter((group) => !group.tombstone);
    const inputIds = new Set(upserts.map((group) => group.id));
    const ordered: typeof upserts = [];
    const pending = [...upserts];
    while (pending.length) {
      const ready = pending.findIndex((group) => !group.parentGroupInstanceId ||
        !inputIds.has(group.parentGroupInstanceId) || ordered.some((done) => done.id === group.parentGroupInstanceId));
      if (ready < 0) throw new UnprocessableEntityException("Group parent identities contain a cycle");
      ordered.push(pending.splice(ready, 1)[0]!);
    }
    for (const group of ordered) {
      const sourceKind = group.customGroupDefinitionId ? "custom" : "nemsis";
      const saved = await manager.query<Array<{ id: string }>>(`
        insert into clinical.group_instance
          (id, report_id, catalog_release_id, parent_group_instance_id, group_id, source_kind,
           custom_group_definition_id, ordinal, correlation_id, documented_time,
           documented_utc_offset_minutes, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update set
          parent_group_instance_id = excluded.parent_group_instance_id,
          ordinal = excluded.ordinal, correlation_id = excluded.correlation_id,
          documented_time = excluded.documented_time,
          documented_utc_offset_minutes = excluded.documented_utc_offset_minutes,
          server_received_time = now(), tombstoned_at = null
        where clinical.group_instance.report_id = excluded.report_id
          and clinical.group_instance.group_id = excluded.group_id
          and clinical.group_instance.source_kind = excluded.source_kind
          and clinical.group_instance.custom_group_definition_id is not distinct from excluded.custom_group_definition_id
        returning id
      `, [group.id, report.id, report.catalog_release_id, group.parentGroupInstanceId ?? null,
        group.groupId, sourceKind, group.customGroupDefinitionId ?? null, group.ordinal,
        group.correlationId ?? null, group.documentedTime ?? null,
        group.documentedUtcOffsetMinutes ?? null, command.authorId]);
      if (!saved[0]) throw new ConflictException(`Group identity ${group.id} already belongs to different data`);
    }
    for (const group of mutations.filter((candidate) => candidate.tombstone)) {
      const removed = await manager.query<Array<{ id: string }>>(`
        update clinical.group_instance set tombstoned_at = now()
        where id = $1 and report_id = $2 and group_id = $3 returning id
      `, [group.id, report.id, group.groupId]);
      if (!removed[0]) throw new ConflictException(`Group identity ${group.id} does not belong to this report and group`);
    }
  }

  private async applyOccurrence(
    manager: EntityManager,
    report: ReportRow,
    command: SaveDraftReportCommand,
    occurrence: DraftOccurrenceMutation
  ): Promise<void> {
    if (occurrence.tombstone) {
      const removed = await manager.query<Array<{ id: string }>>(`
        update clinical.element_occurrence set tombstoned_at = now(), updated_at = now(), author_id = $4,
          provenance_kind = 'clinician',
          provenance_detail = coalesce(provenance_detail, '{}'::jsonb) || $5::jsonb
        where id = $1 and report_id = $2 and element_id = $3 returning id
      `, [occurrence.id, report.id, occurrence.elementId, command.authorId,
        JSON.stringify({ ownershipAction: "clear", clinicianValue: null })]);
      if (!removed[0]) throw new ConflictException(`Occurrence identity ${occurrence.id} does not belong to this report and element`);
      return;
    }
    const metadata = await this.elementMetadata(manager, report, occurrence);
    const value = occurrence.value!;
    this.validateDatatype(value, metadata, occurrence.elementId);
    const columns = this.valueColumns(value);
    const saved = await manager.query<Array<{ id: string }>>(`
      insert into clinical.element_occurrence
        (id, report_id, catalog_release_id, group_instance_id, element_identity_id, element_id,
         form_field_id, ordinal, analytical_repeatable, identifying, value_kind,
         value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime,
         value_time, value_duration, value_binary, value_lexical, value_utc_offset_minutes,
         value_precision, code, code_system, code_display, terminology_version, absence_code,
         absence_display, source_attributes, correlation_id, provenance_kind, provenance_detail,
         documented_time, documented_utc_offset_minutes, documented_precision, author_id)
      values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
         $25, $26, $27, $28, $29, $30::jsonb, $31, $32, $33::jsonb, $34, $35, $36, $37)
      on conflict (id) do update set
        group_instance_id = excluded.group_instance_id, form_field_id = excluded.form_field_id,
        ordinal = excluded.ordinal, value_kind = excluded.value_kind,
        value_text = excluded.value_text, value_integer = excluded.value_integer,
        value_numeric = excluded.value_numeric, value_boolean = excluded.value_boolean,
        value_date = excluded.value_date, value_datetime = excluded.value_datetime,
        value_time = excluded.value_time, value_duration = excluded.value_duration,
        value_binary = excluded.value_binary, value_lexical = excluded.value_lexical,
        value_utc_offset_minutes = excluded.value_utc_offset_minutes,
        value_precision = excluded.value_precision, code = excluded.code,
        code_system = excluded.code_system, code_display = excluded.code_display,
        terminology_version = excluded.terminology_version, absence_code = excluded.absence_code,
        absence_display = excluded.absence_display, source_attributes = excluded.source_attributes,
        correlation_id = excluded.correlation_id, provenance_kind = excluded.provenance_kind,
        provenance_detail = coalesce(clinical.element_occurrence.provenance_detail, '{}'::jsonb) || excluded.provenance_detail,
        documented_time = excluded.documented_time,
        documented_utc_offset_minutes = excluded.documented_utc_offset_minutes,
        documented_precision = excluded.documented_precision, author_id = excluded.author_id,
        server_received_time = now(), tombstoned_at = null, updated_at = now()
      where clinical.element_occurrence.report_id = excluded.report_id
        and clinical.element_occurrence.element_identity_id = excluded.element_identity_id
        and clinical.element_occurrence.element_id = excluded.element_id
      returning id
    `, [occurrence.id, report.id, report.catalog_release_id, occurrence.groupInstanceId ?? null,
      metadata.element_identity_id, occurrence.elementId, occurrence.formFieldId ?? null,
      occurrence.ordinal ?? 0, metadata.analytical_repeatable, metadata.identifying, value.kind,
      columns.valueText, columns.valueInteger, columns.valueNumeric, columns.valueBoolean,
      columns.valueDate, columns.valueDatetime, columns.valueTime, columns.valueDuration,
      columns.valueBinary, columns.valueLexical, columns.valueUtcOffsetMinutes,
      columns.valuePrecision, columns.code, columns.codeSystem, columns.codeDisplay,
      columns.terminologyVersion, columns.absenceCode, columns.absenceDisplay,
      occurrence.sourceAttributes ? JSON.stringify(occurrence.sourceAttributes) : null,
      occurrence.correlationId ?? null, "clinician",
      JSON.stringify({ ownershipAction: "create-edit-or-affirm", clinicianValue: occurrence.value }),
      occurrence.documentedTime ?? null, occurrence.documentedUtcOffsetMinutes ?? null,
      occurrence.documentedPrecision ?? null, command.authorId]);
    if (!saved[0]) throw new ConflictException(`Occurrence identity ${occurrence.id} already belongs to different data`);
  }

  private async elementMetadata(
    manager: EntityManager,
    report: ReportRow,
    occurrence: DraftOccurrenceMutation
  ): Promise<ElementMetadata> {
    const standard = await manager.query<ElementMetadata[]>(`
      select e.element_identity_id, e.base_datatype,
             (m.analytical_location = 'repeatable') as analytical_repeatable,
             m.identifying,
             array(select o.source_kind || ':' || o.code from catalog.element_option o
                   where o.release_id = e.release_id and o.element_id = e.element_id) as allowed_absence_states
      from catalog.element_definition e
      join catalog.analytics_element_mapping m on m.release_id = e.release_id and m.element_id = e.element_id
      where e.release_id = $1 and e.element_id = $2
    `, [report.catalog_release_id, occurrence.elementId]);
    let metadata = standard[0];
    if (!metadata && occurrence.formFieldId) {
      const custom = await manager.query<ElementMetadata[]>(`
        select ced.id as element_identity_id, ced.base_datatype,
               ff.analytical_repeatable, ced.identifying,
               array(select 'form:' || state from unnest(ff.allowed_absence_states) state) as allowed_absence_states
        from forms.form_field ff
        join forms.custom_element_definition ced on ced.id = ff.custom_element_definition_id
        where ff.id = $1 and ff.form_version_id = $2
          and ced.namespace || '.' || ced.slug = $3
      `, [occurrence.formFieldId, report.form_version_id, occurrence.elementId]);
      metadata = custom[0];
    }
    if (!metadata) throw new UnprocessableEntityException(`Element ${occurrence.elementId} is not in the pinned catalog or form`);
    if (occurrence.formFieldId) {
      const field = await manager.query<Array<{ identity_id: string }>>(`
        select coalesce(catalog_element_identity_id, custom_element_definition_id) as identity_id
        from forms.form_field where id = $1 and form_version_id = $2
      `, [occurrence.formFieldId, report.form_version_id]);
      if (!field[0] || field[0].identity_id !== metadata.element_identity_id) {
        throw new UnprocessableEntityException(`formFieldId does not map to ${occurrence.elementId}`);
      }
    }
    return metadata;
  }

  private validateDatatype(value: DraftValue, metadata: ElementMetadata, elementId: string): void {
    const expected: Record<string, DraftValue["kind"]> = {
      string: "text", integer: "integer", decimal: "numeric", boolean: "boolean",
      date: "date", dateTime: "datetime", time: "time", duration: "duration",
      binary: "binary", anyURI: "uri"
    };
    if (!["coded", "null", "pertinent-negative", "absent"].includes(value.kind) && expected[metadata.base_datatype] !== value.kind) {
      throw new UnprocessableEntityException(`${elementId} requires ${metadata.base_datatype}, not ${value.kind}`);
    }
    if (value.kind === "null" || value.kind === "pertinent-negative") {
      const prefix = value.kind === "null" ? "not-value:" : "pertinent-negative:";
      if (!metadata.allowed_absence_states.includes(`${prefix}${value.absenceCode}`) &&
          !metadata.allowed_absence_states.includes(`form:${value.absenceCode}`)) {
        throw new UnprocessableEntityException(`${value.absenceCode} is not a supported ${value.kind} for ${elementId}`);
      }
    }
  }

  private valueColumns(value: DraftValue): Record<string, unknown> {
    const result: Record<string, unknown> = {
      valueText: null, valueInteger: null, valueNumeric: null, valueBoolean: null,
      valueDate: null, valueDatetime: null, valueTime: null, valueDuration: null,
      valueBinary: null, valueLexical: null, valueUtcOffsetMinutes: null,
      valuePrecision: null, code: null, codeSystem: null, codeDisplay: null,
      terminologyVersion: null, absenceCode: null, absenceDisplay: null
    };
    switch (value.kind) {
      case "text": case "uri": result.valueText = value.value; break;
      case "integer": result.valueInteger = value.value; result.valueLexical = value.lexical ?? String(value.value); break;
      case "numeric": result.valueNumeric = value.value; result.valueLexical = value.lexical ?? String(value.value); break;
      case "boolean": result.valueBoolean = value.value; break;
      case "date": result.valueDate = value.value; result.valuePrecision = value.precision ?? null; break;
      case "datetime":
        result.valueDatetime = value.value;
        result.valueUtcOffsetMinutes = value.utcOffsetMinutes ?? null; result.valuePrecision = value.precision ?? null; break;
      case "time":
        result.valueTime = value.value;
        result.valueUtcOffsetMinutes = value.utcOffsetMinutes ?? null; result.valuePrecision = value.precision ?? null; break;
      case "duration": result.valueDuration = value.value; result.valueLexical = value.lexical ?? value.value; break;
      case "binary": result.valueBinary = Buffer.from(value.value, "base64"); break;
      case "coded":
        result.code = value.code; result.codeSystem = value.codeSystem ?? null;
        result.codeDisplay = value.display ?? null; result.terminologyVersion = value.terminologyVersion ?? null; break;
      case "null": case "pertinent-negative": case "absent":
        result.absenceCode = value.absenceCode ?? null; result.absenceDisplay = value.display ?? null; break;
    }
    return result;
  }

  private async reportResult(
    manager: EntityManager,
    reportId: string,
    organizationId?: string,
    documentingUserId?: string
  ): Promise<DraftReportResult> {
    const rows = await manager.query<ReportRow[]>(`select id, status, revision, organization_id, incident_id,
      patient_id, agency_demographic_version_id, form_version_id, catalog_release_id, documenting_user_id
      from clinical.report where id = $1
        and ($2::uuid is null or organization_id = $2)
        and ($3::uuid is null or documenting_user_id = $3)`,
    [reportId, organizationId ?? null, documentingUserId ?? null]);
    const row = rows[0];
    if (!row) throw new NotFoundException(`Report ${reportId} was not found`);
    if (row.status !== "draft") throw new ConflictException("Report is no longer a draft");
    return {
      id: row.id, status: row.status, revision: Number(row.revision), organizationId: row.organization_id,
      incidentId: row.incident_id, patientId: row.patient_id,
      agencyDemographicVersionId: row.agency_demographic_version_id,
      formVersionId: row.form_version_id, catalogReleaseId: row.catalog_release_id,
      documentingUserId: row.documenting_user_id
    };
  }

  private async lockCommand(manager: EntityManager, commandId: string): Promise<void> {
    await manager.query("select pg_advisory_xact_lock(hashtext($1))", [commandId]);
  }

  private async replay<T>(
    manager: EntityManager,
    commandId: string,
    type: string,
    digest: string,
    reportId: string
  ): Promise<T | null> {
    const rows = await manager.query<ReceiptRow[]>("select * from clinical.command_receipt where idempotency_key = $1", [commandId]);
    const receipt = rows[0];
    if (!receipt) return null;
    if (receipt.command_type !== type || receipt.request_sha256 !== digest || receipt.report_id !== reportId) {
      throw new ConflictException("The command identity was already used with different content");
    }
    return receipt.response_body as T;
  }

  private async storeReceipt(
    manager: EntityManager,
    commandId: string,
    reportId: string,
    type: string,
    digest: string,
    response: SaveDraftReportResult
  ): Promise<void> {
    await manager.query(`insert into clinical.command_receipt
      (idempotency_key, report_id, command_type, request_sha256, response_status, response_body)
      values ($1, $2, $3, $4, 201, $5::jsonb)`,
    [commandId, reportId, type, digest, JSON.stringify(response)]);
  }

  private rethrowValidation(error: unknown): never {
    if (error instanceof DraftReportValidationError) {
      throw new UnprocessableEntityException({ message: error.message, findings: error.findings });
    }
    throw error;
  }

  private rethrowDatabaseConflict(error: unknown): never {
    if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
    if (typeof error === "object" && error !== null && "code" in error && ["23503", "23505", "23514", "23P01", "40001", "40P01"].includes(String(error.code))) {
      throw new ConflictException("The command conflicts with existing clinical data");
    }
    throw error;
  }
}
