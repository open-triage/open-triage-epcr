import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { DEFAULT_IMAGE_MEDIA_LIMIT_BYTES, DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES } from "@open-triage/contracts";
import type { ActiveReportResource, DeleteDraftReportResponse, DispatchConflict, EncounterValue, OpenCallsResponse, ReopenOpenCallResponse, ResolveDispatchConflictCommand } from "@open-triage/contracts";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { clinicalFormConfiguration } from "../forms/clinical-form-configuration.js";
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
import { customCodedValueFindings } from "./custom-coded-validation.js";
import { withReportSnapshot } from "./report-snapshot.js";
import { reportTextNotes } from "./report-note.persistence.js";

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
  validation_version_id?: string | null;
  form_definition_sha256?: string | null;
  catalog_artifact_sha256?: string | null;
  validation_compiled_sha256?: string | null;
  documenting_user_id: string;
  media_settings_revision: string | number;
  report_media_allowance_bytes: string | number;
  image_media_limit_bytes: string | number;
  synthetic?: boolean;
  demo_mutable?: boolean;
  server_received_time?: Date | string;
  expires_at?: Date | string | null;
};

type ElementMetadata = {
  element_id?: string;
  form_field_id?: string;
  element_identity_id: string;
  base_datatype: string;
  analytical_repeatable: boolean;
  identifying: boolean;
  allowed_absence_states: string[];
  supports_not_values: boolean;
  supports_pertinent_negatives: boolean;
  max_occurs: number | null;
  text_constraints?: { minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number } | null;
  custom_definition?: import("@open-triage/contracts").CatalogDraftCustomElement | null;
  form_choice_policy?: import("@open-triage/contracts").FormDraftField["choicePolicy"];
};

type SingletonTargetStateRow = DraftTargetStateRow & {
  incoming_target_id: string;
};

type OpenCallRow = {
  report_id: string;
  status: "draft" | "signed";
  call_number: string | null;
  dispatched_at: Date | string | null;
  dispatch_reason: string | null;
  dispatch_priority_code: string | null;
  dispatch_priority_display: string | null;
  chief_complaint: string | null;
  unit_call_sign: string;
  agency_time_zone: string;
  last_saved_at: Date | string;
  revision: string | number;
  form_version_id: string;
  catalog_release_id: string;
  validation_error_count: string | number;
  demo_mutable: boolean;
  expires_at: Date | string | null;
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
const DEMO_GENERATOR = "stationary-populate-v1";
const DEMO_GROUP_PREFIX = `demo:${DEMO_GENERATOR}:`;

function conflictDraftValue(value: EncounterValue, baseDatatype: string): DraftValue {
  const metadata = {
    ...(value.notValue ? { notValue: value.notValue } : {}),
    ...(value.pertinentNegative ? { pertinentNegative: value.pertinentNegative } : {}),
  };
  if (value.kind === "coded") return { kind: "coded", code: value.code, codeSystem: value.system, display: value.display, ...(typeof value.terminologyVersion === "string" ? { terminologyVersion: value.terminologyVersion } : {}), ...metadata };
  if (value.kind === "pertinent-negative") return { kind: "pertinent-negative", absenceCode: value.code, display: value.display };
  if (value.kind === "null") return value.notValue
    ? { kind: "null", absenceCode: value.notValue.code, display: value.notValue.display }
    : { kind: "absent" };
  if (value.kind === "absent") return { kind: "absent", ...metadata };
  if (typeof value.value === "boolean") return { kind: "boolean", value: value.value };
  if (typeof value.value === "number") return baseDatatype === "integer"
    ? { kind: "integer", value: value.value } : { kind: "numeric", value: value.value };
  const scalarKind: Record<string, DraftValue["kind"]> = {
    string: "text", anyURI: "uri", integer: "integer", decimal: "numeric", boolean: "boolean",
    date: "date", dateTime: "datetime", time: "time", duration: "duration", binary: "binary"
  };
  return { kind: scalarKind[baseDatatype] ?? "text", value: value.value, ...metadata } as DraftValue;
}

@Injectable()
export class DraftReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async create(accessToken: string, input: unknown): Promise<DraftReportResult> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
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
          validation_version_id: string;
          form_definition_sha256: string;
          catalog_artifact_sha256: string;
          validation_compiled_sha256: string;
        }>>(`
          select active.form_version_id, active.catalog_release_id, active.validation_version_id,
                 active.form_definition_sha256,active.catalog_artifact_sha256,
                 active.validation_compiled_sha256,
                 (select adv.id from app_identity.agency_demographic_version adv
                  where adv.organization_id = f.organization_id
                    and adv.catalog_release_id = active.catalog_release_id
                    and adv.effective_from <= now()
                  order by adv.effective_from desc, adv.version desc limit 1) as agency_demographic_version_id
          from app_identity.active_configuration_bundle active
          join forms.form_version fv on fv.id=active.form_version_id and fv.status='published'
          join forms.form f on f.id=fv.form_id and f.organization_id=active.organization_id
          where active.organization_id = $2 and ($1::uuid is null or f.id = $1)
        `, [command.formId ?? null, command.organizationId]);
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
             form_version_id, catalog_release_id, validation_version_id, documenting_user_id,
             form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          on conflict (id) do nothing
        `, [command.reportId, command.organizationId, command.incidentId, command.patientId,
          active[0].agency_demographic_version_id, active[0].form_version_id,
          active[0].catalog_release_id, active[0].validation_version_id, command.documentingUserId,
          active[0].form_definition_sha256,active[0].catalog_artifact_sha256,
          active[0].validation_compiled_sha256]);
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

  async save(accessToken: string, reportId: string, input: unknown, csrfToken?: string): Promise<SaveDraftReportResult> {
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
        const session = await this.sessions.requireCapability(accessToken, "clinical:document", manager);
        if (command.demoAction) await this.sessions.requireCapability(accessToken, "clinical:demo", manager);
        if (command.demoAction) await this.sessions.assertCsrf(accessToken, csrfToken, manager);
        await manager.query("select retention.purge_expired_synthetic_records(clock_timestamp())");
        await this.lockCommand(manager, command.commandId);
        const rows = await manager.query<ReportRow[]>(`
          select clinical.report.*, clock_timestamp() as server_received_time,
                 exists (
                   select 1 from clinical.call_assignment ca
                   where ca.report_id = clinical.report.id
                     and ca.organization_id = clinical.report.organization_id
                     and ca.synthetic and ca.synthetic_generated_by = $3
                 ) as demo_mutable
          from clinical.report
          where id = $1 and organization_id = $2 and documenting_user_id = $3
          for update
        `, [reportId, session.organization.id, session.user.id]);
        const report = rows[0];
        if (!report) {
          await this.throwIfPurged(manager, reportId, session.organization.id);
          throw new NotFoundException(`Report ${reportId} was not found`);
        }
        if (command.authorId !== session.user.id) {
          throw new NotFoundException("The draft is not available to this clinician");
        }
        const replay = await this.replay<SaveDraftReportResult>(manager, command.commandId, "save-draft", digest, reportId);
        if (replay) return replay;
        await this.assertDemoMutationBoundary(manager, report, command);
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
        const serverReceivedTime = report.server_received_time ?? new Date();
        const winningGroups: DraftGroupMutation[] = [];
        const winningOccurrences: DraftOccurrenceMutation[] = [];
        const winningTargets: IncomingTarget[] = [];
        const audits: ReconciliationAudit[] = [];
        let reconciledSingleton = false;
        const targets: Array<{ type: DraftTargetType; value: DraftGroupMutation | DraftOccurrenceMutation }> = [
          ...(command.groups ?? []).map((value) => ({ type: "group" as const, value })),
          ...(command.occurrences ?? []).map((value) => ({ type: "occurrence" as const, value }))
        ];
        const currentStates = await this.targetStates(manager, report.id, targets);
        const occurrenceMetadata = await this.elementMetadataBatch(
          manager,
          report,
          (command.occurrences ?? []).filter((occurrence) => !occurrence.tombstone)
        );
        const singletonStates = await this.singletonTargetStates(
          manager,
          report.id,
          (command.occurrences ?? []).filter((occurrence) => !occurrence.tombstone),
          occurrenceMetadata
        );
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
          const directCurrent = currentStates.get(`${target.type}:${target.value.id}`) ?? null;
          const singletonCurrent = target.type === "occurrence"
            ? singletonStates.get(target.value.id) ?? null
            : null;
          const current = directCurrent ?? (
            singletonCurrent && Number(singletonCurrent.revision) > command.expectedRevision
              ? singletonCurrent
              : null
          );
          if (current) this.assertStableTarget(current.target_value, target.value, target.type);
          if (target.type === "occurrence" && !(target.value as DraftOccurrenceMutation).tombstone) {
            const occurrence = target.value as DraftOccurrenceMutation;
            const metadata = occurrenceMetadata.get(occurrence.id)!;
            this.validateDatatype(occurrence.value!, metadata, occurrence.elementId);
          }
          let incomingWins = true;
          let winningTarget = incoming;
          if (current && Number(current.revision) > command.expectedRevision) {
            if (singletonCurrent && !directCurrent) reconciledSingleton = true;
            const prior = this.targetFromState(current);
            const decision = this.selectConcurrentWinner(prior, incoming);
            incomingWins = decision.winner === incoming;
            audits.push({
              targetType: target.type,
              targetId: current.target_id,
              losing: decision.winner === incoming ? prior : incoming,
              winning: decision.winner,
              resolution: decision.resolution
            });
            if (incomingWins && singletonCurrent && !directCurrent) {
              const incumbent = singletonCurrent.target_value as DraftOccurrenceMutation;
              const value = target.value as DraftOccurrenceMutation;
              const resolvedValue: DraftOccurrenceMutation = {
                ...value,
                id: singletonCurrent.target_id,
                groupInstanceId: incumbent.groupInstanceId,
                ordinal: incumbent.ordinal
              };
              winningTarget = {
                ...incoming,
                targetId: singletonCurrent.target_id,
                value: resolvedValue
              };
              occurrenceMetadata.set(singletonCurrent.target_id, occurrenceMetadata.get(value.id)!);
            }
          }
          if (incomingWins) {
            winningTargets.push(winningTarget);
            if (target.type === "group") winningGroups.push(winningTarget.value as DraftGroupMutation);
            else winningOccurrences.push(winningTarget.value as DraftOccurrenceMutation);
          }
        }

        await this.applyGroups(manager, report, { ...command, groups: winningGroups });
        await this.applyOccurrences(manager, report, command, winningOccurrences, occurrenceMetadata);
        if (reconciledSingleton) await this.assertPinnedCardinality(manager, report);
        if (winningOccurrences.some((occurrence) => occurrenceMetadata.get(occurrence.id)?.base_datatype === "coded"))
          await this.assertCodedChoiceCombinations(manager, report);

        await manager.query(`
          with updated as (
            update clinical.report set revision = $2, updated_at = now()
            where id = $1 returning id
          )
          insert into clinical.report_change
            (report_id, revision, idempotency_key, author_id, device_id, client_time, changes)
          select updated.id, $2, $3, $4, $5, $6, $7::jsonb from updated
        `, [reportId, nextRevision, command.commandId, command.authorId,
          command.deviceId ?? null, command.clientTime ?? null, JSON.stringify({
            baseRevision: command.expectedRevision,
            groups: command.groups ?? [], occurrences: command.occurrences ?? []
          })]);
        await this.storeTargetStates(manager, report.id, winningTargets);
        await this.storeReconciliationAudits(manager, report.id, audits);
        if (command.demoAction) {
          await this.auditDemoMutation(manager, report, command.demoAction, command.commandId,
            command.authorId, winningGroups.length + winningOccurrences.length, nextRevision);
        }
        const result = this.draftResult(report, nextRevision);
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

  private async targetStates(
    manager: EntityManager,
    reportId: string,
    targets: ReadonlyArray<{ type: DraftTargetType; value: DraftGroupMutation | DraftOccurrenceMutation }>
  ): Promise<Map<string, DraftTargetStateRow>> {
    if (!targets.length) return new Map();
    const rows = await manager.query<DraftTargetStateRow[]>(`
      select target_type, target_id, revision, idempotency_key, author_id, device_id,
             client_time, server_received_time, base_revision, target_value
      from clinical.draft_target_state
      where report_id = $1 and target_id = any($2::uuid[])
      for update
    `, [reportId, targets.map(({ value }) => value.id)]);
    return new Map(rows.map((row) => [`${row.target_type}:${row.target_id}`, row]));
  }

  private async singletonTargetStates(
    manager: EntityManager,
    reportId: string,
    occurrences: ReadonlyArray<DraftOccurrenceMutation>,
    metadataByOccurrence: ReadonlyMap<string, ElementMetadata>
  ): Promise<Map<string, DraftTargetStateRow>> {
    const candidates = occurrences.flatMap((occurrence) => {
      const metadata = metadataByOccurrence.get(occurrence.id);
      return metadata?.max_occurs === 1 ? [{
        target_id: occurrence.id,
        group_instance_id: occurrence.groupInstanceId ?? null,
        element_identity_id: metadata.element_identity_id
      }] : [];
    });
    if (!candidates.length) return new Map();
    const rows = await manager.query<SingletonTargetStateRow[]>(`
      select incoming.target_id as incoming_target_id,
             state.target_type, state.target_id, state.revision, state.idempotency_key,
             state.author_id, state.device_id, state.client_time, state.server_received_time,
             state.base_revision, state.target_value
      from jsonb_to_recordset($2::jsonb) as incoming(
        target_id uuid, group_instance_id uuid, element_identity_id uuid)
      join clinical.element_occurrence occurrence
        on occurrence.report_id = $1
       and occurrence.id <> incoming.target_id
       and occurrence.group_instance_id is not distinct from incoming.group_instance_id
       and occurrence.element_identity_id = incoming.element_identity_id
       and occurrence.tombstoned_at is null
      join clinical.draft_target_state state
        on state.report_id = occurrence.report_id
       and state.target_type = 'occurrence'
       and state.target_id = occurrence.id
      order by incoming.target_id, occurrence.id
    `, [reportId, JSON.stringify(candidates)]);
    const result = new Map<string, DraftTargetStateRow>();
    for (const row of rows) {
      if (result.has(row.incoming_target_id)) {
        throw new UnprocessableEntityException("The draft already violates pinned max-one field cardinality");
      }
      result.set(row.incoming_target_id, row);
    }
    return result;
  }

  private async assertPinnedCardinality(manager: EntityManager, report: ReportRow): Promise<void> {
    const violations = await manager.query<Array<{
      element_id: string;
      max_occurs: string | number;
      occurrence_count: string | number;
    }>>(`
      select occurrence.element_id, max(definition.max_occurs) as max_occurs, count(*) as occurrence_count
      from clinical.element_occurrence occurrence
      left join catalog.element_definition definition
        on definition.release_id = occurrence.catalog_release_id
       and definition.element_id = occurrence.element_id
      left join forms.custom_element_definition custom on custom.id = occurrence.element_identity_id
      where occurrence.report_id = $1
        and occurrence.tombstoned_at is null
        and (definition.max_occurs is not null or custom.definition->>'recurrence' = 'single')
      group by occurrence.group_instance_id, occurrence.element_id
      having count(*) > coalesce(max(definition.max_occurs), 1)
      order by occurrence.element_id
      limit 1
    `, [report.id]);
    const violation = violations[0];
    if (violation) {
      throw new UnprocessableEntityException(
        `${violation.element_id} permits at most ${violation.max_occurs} occurrence(s), not ${violation.occurrence_count}`
      );
    }
  }

  private async assertCodedChoiceCombinations(manager: EntityManager, report: ReportRow): Promise<void> {
    const invalid = await manager.query<Array<{ element_id: string }>>(`
      select occurrence.element_id
      from clinical.element_occurrence occurrence
      left join catalog.element_definition standard
        on standard.release_id = occurrence.catalog_release_id
       and standard.element_id = occurrence.element_id
      left join forms.custom_element_definition custom
        on custom.id = occurrence.element_identity_id
      where occurrence.report_id = $1 and occurrence.tombstoned_at is null
        and coalesce(standard.base_datatype, custom.base_datatype) = 'coded'
      group by occurrence.group_instance_id, occurrence.element_id
      having count(*) > 1 and (
        bool_or(occurrence.value_kind <> 'coded')
        or count(*) > count(distinct (coalesce(occurrence.code_system, ''), occurrence.code))
      )
      limit 1
    `, [report.id]);
    if (invalid[0]) throw new UnprocessableEntityException(
      `${invalid[0].element_id} cannot combine exceptional or duplicate choices`
    );
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

  private async storeTargetStates(
    manager: EntityManager,
    reportId: string,
    targets: ReadonlyArray<IncomingTarget>
  ): Promise<void> {
    if (!targets.length) return;
    await manager.query(`
      insert into clinical.draft_target_state
        (report_id, target_type, target_id, revision, idempotency_key, author_id, device_id,
         client_time, server_received_time, base_revision, target_value)
      select $1, incoming.target_type, incoming.target_id, incoming.revision,
             incoming.idempotency_key, incoming.author_id, incoming.device_id,
             incoming.client_time, incoming.server_received_time, incoming.base_revision,
             incoming.target_value
      from jsonb_to_recordset($2::jsonb) as incoming(
        target_type text, target_id uuid, revision bigint, idempotency_key uuid,
        author_id uuid, device_id text, client_time timestamptz,
        server_received_time timestamptz, base_revision bigint, target_value jsonb)
      on conflict (report_id, target_type, target_id) do update set
        revision = excluded.revision, idempotency_key = excluded.idempotency_key,
        author_id = excluded.author_id, device_id = excluded.device_id,
        client_time = excluded.client_time, server_received_time = excluded.server_received_time,
        base_revision = excluded.base_revision, target_value = excluded.target_value
    `, [reportId, JSON.stringify(targets.map((target) => ({
      target_type: target.targetType,
      target_id: target.targetId,
      revision: target.revision,
      idempotency_key: target.commandId,
      author_id: target.authorId,
      device_id: target.deviceId,
      client_time: target.clientTime,
      server_received_time: target.serverReceivedTime,
      base_revision: target.baseRevision,
      target_value: target.value
    })))]);
  }

  private async storeReconciliationAudits(
    manager: EntityManager,
    reportId: string,
    audits: ReadonlyArray<ReconciliationAudit>
  ): Promise<void> {
    if (!audits.length) return;
    await manager.query(`
      insert into clinical_audit.draft_reconciliation
        (report_id, target_type, target_id, losing_value, losing_author_id, losing_device_id,
         losing_client_time, losing_server_received_time, losing_base_revision,
         winning_revision, winning_idempotency_key, winning_author_id, winning_device_id,
         winning_client_time, winning_server_received_time, winning_base_revision, resolution)
      select $1, incoming.target_type, incoming.target_id, incoming.losing_value,
             incoming.losing_author_id, incoming.losing_device_id, incoming.losing_client_time,
             incoming.losing_server_received_time, incoming.losing_base_revision,
             incoming.winning_revision, incoming.winning_idempotency_key,
             incoming.winning_author_id, incoming.winning_device_id, incoming.winning_client_time,
             incoming.winning_server_received_time, incoming.winning_base_revision,
             incoming.resolution
      from jsonb_to_recordset($2::jsonb) as incoming(
        target_type text, target_id uuid, losing_value jsonb, losing_author_id uuid,
        losing_device_id text, losing_client_time timestamptz, losing_server_received_time timestamptz,
        losing_base_revision bigint, winning_revision bigint, winning_idempotency_key uuid,
        winning_author_id uuid, winning_device_id text, winning_client_time timestamptz,
        winning_server_received_time timestamptz, winning_base_revision bigint, resolution text)
    `, [reportId, JSON.stringify(audits.map((audit) => ({
      target_type: audit.targetType,
      target_id: audit.targetId,
      losing_value: audit.losing.value,
      losing_author_id: audit.losing.authorId,
      losing_device_id: audit.losing.deviceId,
      losing_client_time: audit.losing.clientTime,
      losing_server_received_time: audit.losing.serverReceivedTime,
      losing_base_revision: audit.losing.baseRevision,
      winning_revision: audit.winning.revision,
      winning_idempotency_key: audit.winning.commandId,
      winning_author_id: audit.winning.authorId,
      winning_device_id: audit.winning.deviceId,
      winning_client_time: audit.winning.clientTime,
      winning_server_received_time: audit.winning.serverReceivedTime,
      winning_base_revision: audit.winning.baseRevision,
      resolution: audit.resolution
    })))]);
  }

  async get(accessToken: string, reportId: string): Promise<Record<string, unknown>> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
    return withReportSnapshot(this.dataSource, async (manager) => {
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
      const notes = await reportTextNotes(manager, reportId);
      return { ...report, groups, occurrences, notes };
    });
  }

  async listOpen(accessToken: string, now = new Date()): Promise<OpenCallsResponse> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document", undefined, now);
    await this.dataSource.query("select retention.purge_expired_synthetic_records($1)", [now]);
    const rows = await this.dataSource.query<OpenCallRow[]>(`
      select r.id as report_id, r.status, ca.call_number, ca.dispatched_at,
             ca.dispatch_reason, ca.chief_complaint, ou.call_sign as unit_call_sign,
             jsonb_path_query_first(dr.source_payload,
               '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'code'
               as dispatch_priority_code,
             jsonb_path_query_first(dr.source_payload,
               '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'display'
               as dispatch_priority_display,
             organization.deployment_timezone as agency_time_zone,
             r.updated_at as last_saved_at, r.expires_at,
             r.revision, r.form_version_id, r.catalog_release_id,
             (r.synthetic and coalesce(ca.synthetic, false) and ca.synthetic_generated_by = $2) as demo_mutable,
             count(vf.id) filter (where vf.severity = 'error' and vf.revision = r.revision)::integer
               as validation_error_count
      from clinical.report r
      left join clinical.call_assignment ca
        on ca.organization_id = r.organization_id and ca.report_id = r.id
      left join app_identity.operational_unit ou on ou.id = ca.unit_id
      join app_identity.organization organization on organization.id = r.organization_id
      left join clinical.dispatch_receipt dr on dr.id = ca.dispatch_receipt_id
      left join clinical.validation_finding vf on vf.report_id = r.id
      where r.organization_id = $1 and r.documenting_user_id = $2 and r.status in ('draft', 'signed')
      group by r.id, ca.id, ou.call_sign, organization.deployment_timezone, dr.id
      order by r.updated_at desc, r.id
    `, [session.organization.id, session.user.id]);
    return {
      openCalls: rows.filter((row) => row.status === "draft").map((row) => ({
        reportId: row.report_id,
        callNumber: row.call_number ?? `New patient · ${row.report_id.slice(0, 8)}`,
        ...(row.dispatched_at ? { dispatchedAt: new Date(row.dispatched_at).toISOString() } : {}),
        dispatchReason: row.dispatch_reason,
        dispatchPriority: row.dispatch_priority_code ? {
          code: row.dispatch_priority_code,
          display: row.dispatch_priority_display ?? row.dispatch_priority_code,
        } : null,
        chiefComplaint: row.chief_complaint,
        unitCallSign: row.unit_call_sign,
        ...(row.agency_time_zone ? { agencyTimeZone: row.agency_time_zone } : {}),
        lastSavedAt: new Date(row.last_saved_at).toISOString(),
        syncStatus: "saved",
        validationErrorCount: Number(row.validation_error_count),
        revision: Number(row.revision),
        formVersionId: row.form_version_id,
        catalogReleaseId: row.catalog_release_id,
        ...(row.demo_mutable ? { demoMutable: true } : {}),
        ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {})
      })),
      completedReportIds: rows.filter((row) => row.status === "signed").map((row) => row.report_id),
      refreshedAt: now.toISOString()
    };
  }

  async reopen(accessToken: string, reportId: string): Promise<ReopenOpenCallResponse> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
    return withReportSnapshot(this.dataSource, async (manager) => {
      const details = await this.reportResult(manager, reportId, session.organization.id, session.user.id);
      const document = await encounterDocument(manager, reportId);
      const notes = await reportTextNotes(manager, reportId);
      const conflicts = await dispatchConflicts(manager, reportId);
      const clinicalForm = await clinicalFormConfiguration(
        manager, String(details.formVersionId), String(details.catalogReleaseId),
        details.validationVersionId, details.validationCompiledSha256
      );
      const calls = await manager.query<Array<{
        call_number: string | null;
        dispatched_at: Date | string | null;
        dispatch_reason: string | null;
        dispatch_priority_code: string | null;
        dispatch_priority_display: string | null;
        chief_complaint: string | null;
        unit_call_sign: string;
        agency_time_zone: string;
        dispatch_canceled_at: Date | string | null;
        dispatch_cancellation_revision: string | number | null;
        dispatch_cancellation_receipt_id: string | null;
        demo_mutable: boolean;
        expires_at: Date | string | null;
      }>>(`
        select ca.call_number, ca.dispatched_at, ca.dispatch_reason, ca.chief_complaint,
               jsonb_path_query_first(dr.source_payload,
                 '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'code'
                 as dispatch_priority_code,
               jsonb_path_query_first(dr.source_payload,
                 '$.groups[*].instances[*].elements[*] ? (@.id == "eDispatch.05").values[0]')->>'display'
                 as dispatch_priority_display,
               ou.call_sign as unit_call_sign, organization.deployment_timezone as agency_time_zone,
               r.dispatch_canceled_at,
               r.dispatch_cancellation_revision, r.dispatch_cancellation_receipt_id,
               (r.synthetic and ca.synthetic and ca.synthetic_generated_by = $3) as demo_mutable,
               r.expires_at
        from clinical.report r
        left join clinical.call_assignment ca on ca.report_id = r.id and ca.organization_id = r.organization_id
        left join app_identity.operational_unit ou on ou.id = ca.unit_id
        join app_identity.organization organization on organization.id = r.organization_id
        left join clinical.dispatch_receipt dr on dr.id = ca.dispatch_receipt_id
        where r.id = $1 and r.organization_id = $2 and r.documenting_user_id = $3
          and r.status = 'draft'
      `, [reportId, session.organization.id, session.user.id]);
      if (!calls[0]) throw new NotFoundException(`Report ${reportId} was not found`);
      return {
        callNumber: calls[0].call_number ?? `New patient · ${reportId.slice(0, 8)}`,
        ...(calls[0].dispatched_at ? { dispatchedAt: new Date(calls[0].dispatched_at).toISOString() } : {}),
        dispatchReason: calls[0].dispatch_reason,
        dispatchPriority: calls[0].dispatch_priority_code ? {
          code: calls[0].dispatch_priority_code,
          display: calls[0].dispatch_priority_display ?? calls[0].dispatch_priority_code,
        } : null,
        chiefComplaint: calls[0].chief_complaint,
        unitCallSign: calls[0].unit_call_sign,
        report: {
          id: String(details.id),
          documentingUserId: String(details.documentingUserId),
          formVersionId: String(details.formVersionId),
          catalogReleaseId: String(details.catalogReleaseId),
          ...(details.validationVersionId ? { validationVersionId: details.validationVersionId } : {}),
          ...(details.formDefinitionSha256 ? { formDefinitionSha256: details.formDefinitionSha256 } : {}),
          ...(details.catalogArtifactSha256 ? { catalogArtifactSha256: details.catalogArtifactSha256 } : {}),
          ...(details.validationCompiledSha256 ? { validationCompiledSha256: details.validationCompiledSha256 } : {}),
          mediaPolicy: details.mediaPolicy,
          clinicalForm,
          revision: Number(details.revision),
          status: "draft" as const,
          ...(calls[0].demo_mutable ? { demoMutable: true } : {}),
          ...(calls[0].expires_at ? { expiresAt: new Date(calls[0].expires_at).toISOString() } : {}),
          document,
          notes,
          ...(calls[0].agency_time_zone ? { agencyTimeZone: calls[0].agency_time_zone } : {}),
          dispatchConflicts: conflicts,
          ...(calls[0].dispatch_canceled_at && calls[0].dispatch_cancellation_revision && calls[0].dispatch_cancellation_receipt_id ? {
            dispatchCancellation: {
              canceledAt: new Date(calls[0].dispatch_canceled_at).toISOString(),
              dispatchRevision: Number(calls[0].dispatch_cancellation_revision),
              receiptId: calls[0].dispatch_cancellation_receipt_id
            }
          } : {})
        }
      };
    });
  }

  /** Physical deletion limited to a currently authorized, generator-provenanced demo draft. */
  async deleteSyntheticDraft(accessToken: string, reportId: string, csrfToken?: string): Promise<DeleteDraftReportResponse> {
    return this.dataSource.transaction(async (manager) => {
      await this.sessions.assertCsrf(accessToken, csrfToken, manager);
      await this.sessions.requireCapability(accessToken, "clinical:document", manager);
      const session = await this.sessions.requireCapability(accessToken, "clinical:demo", manager);
      const reports = await manager.query<Array<{ patient_id: string }>>(`
        select r.patient_id from clinical.report r
        join clinical.call_assignment ca
          on ca.report_id = r.id and ca.organization_id = r.organization_id
        where r.id = $1 and r.organization_id = $2 and r.documenting_user_id = $3
          and r.status = 'draft' and r.synthetic and ca.synthetic
          and ca.synthetic_generated_by = $3
        for update
      `, [reportId, session.organization.id, session.user.id]);
      const report = reports[0];
      if (!report) throw new ConflictException("Only a clinician-owned synthetic draft can be deleted");

      await manager.query("select set_config('open_triage.prototype_delete_report', $1, true)", [reportId]);
      await manager.query(`delete from clinical_audit.draft_reconciliation where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical_audit.event where report_id = $1`, [reportId]);
      await manager.query(`delete from integration.projection_backfill_job where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.draft_target_state where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.dispatch_conflict where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.validation_finding where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.element_occurrence where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.group_instance where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.report_contributor where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.command_receipt where report_id = $1`, [reportId]);
      await manager.query(`delete from clinical.report_change where report_id = $1`, [reportId]);
      await manager.query(`
        delete from clinical.call_assignment
        where report_id = $1 and organization_id = $2
      `, [reportId, session.organization.id]);
      const deleted = mutationRows<{ id: string }>(await manager.query(`
        delete from clinical.report where id = $1 and status = 'draft' and synthetic returning id
      `, [reportId]));
      if (!deleted[0]) throw new ConflictException("The synthetic draft could not be deleted");
      await manager.query(`
        delete from clinical.patient where id = $1
          and not exists (select 1 from clinical.report where patient_id = $1)
      `, [report.patient_id]);
      await this.auditDemoMutation(manager, { id: reportId, organization_id: session.organization.id },
        "delete", null, session.user.id, 0, null);
      return { deleted: true, reportId };
    });
  }

  private async assertDemoMutationBoundary(
    manager: EntityManager,
    report: ReportRow,
    command: SaveDraftReportCommand,
  ): Promise<void> {
    const groups = command.groups ?? [];
    const occurrences = command.occurrences ?? [];
    const claimsDemoProvenance = groups.some(({ correlationId }) => correlationId?.startsWith(DEMO_GROUP_PREFIX)) ||
      occurrences.some((occurrence) => occurrence.provenanceKind === "demo" ||
        occurrence.provenanceDetail?.generator === DEMO_GENERATOR ||
        occurrence.sourceAttributes?.["x-open-triage-demo"] === DEMO_GENERATOR);
    if (!command.demoAction) {
      if (claimsDemoProvenance) throw new ConflictException("Demo provenance requires an authorized demo action");
      return;
    }
    if (report.status !== "draft" || report.synthetic !== true || report.demo_mutable !== true) {
      throw new ConflictException("Demo actions require an open generated synthetic draft");
    }
    if (command.demoAction === "populate") {
      const validGroups = groups.every((group) => !group.tombstone && group.correlationId?.startsWith(DEMO_GROUP_PREFIX));
      const validOccurrences = occurrences.every((occurrence) => !occurrence.tombstone && occurrence.provenanceKind === "demo" &&
        occurrence.provenanceDetail?.generator === DEMO_GENERATOR &&
        occurrence.sourceAttributes?.["x-open-triage-demo"] === DEMO_GENERATOR);
      if (!validGroups || !validOccurrences) {
        throw new ConflictException("Populate accepts only immutable demo-owned values");
      }
      return;
    }
    if (!groups.every(({ tombstone }) => tombstone) || !occurrences.every(({ tombstone }) => tombstone)) {
      throw new ConflictException("Clear accepts only demo-owned removals");
    }
    const rows = await manager.query<Array<{ group_count: string | number; occurrence_count: string | number }>>(`
      select
        (select count(*) from clinical.group_instance gi
          where gi.report_id = $1 and gi.id = any($2::uuid[]) and gi.tombstoned_at is null
            and gi.correlation_id like $4) as group_count,
        (select count(*) from clinical.element_occurrence eo
          where eo.report_id = $1 and eo.id = any($3::uuid[]) and eo.tombstoned_at is null
            and eo.provenance_detail->>'generator' = $5) as occurrence_count
    `, [report.id, groups.map(({ id }) => id), occurrences.map(({ id }) => id), `${DEMO_GROUP_PREFIX}%`, DEMO_GENERATOR]);
    if (Number(rows[0]?.group_count ?? 0) !== groups.length ||
        Number(rows[0]?.occurrence_count ?? 0) !== occurrences.length) {
      throw new ConflictException("Clear accepts only demo-owned removals");
    }
  }

  private async auditDemoMutation(
    manager: EntityManager,
    report: Pick<ReportRow, "id" | "organization_id">,
    action: "populate" | "clear" | "delete",
    commandId: string | null,
    actorId: string,
    targetCount: number,
    revision: number | null,
  ): Promise<void> {
    await manager.query(`insert into clinical_audit.synthetic_draft_mutation_event
      (organization_id, actor_id, report_id, command_id, action, target_count, report_revision)
      values ($1, $2, $3, $4, $5, $6, $7)`,
    [report.organization_id, actorId, report.id, commandId, `synthetic_draft.${action}`, targetCount, revision]);
  }

  async active(accessToken: string, reportId: string, ifNoneMatch?: string): Promise<{
    readonly etag: string;
    readonly resource: ActiveReportResource | null;
  }> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
    return withReportSnapshot(this.dataSource, async (manager) => {
      const rows = await manager.query<Array<{
        revision: string | number;
        dispatch_revision: string | number | null;
        dispatch_canceled_at: Date | string | null;
        dispatch_cancellation_revision: string | number | null;
        dispatch_cancellation_receipt_id: string | null;
        media_settings_revision: string | number;
        report_media_allowance_bytes: string | number;
        image_media_limit_bytes: string | number;
      }>>(`
        select r.revision, ca.dispatch_revision, r.dispatch_canceled_at,
               r.dispatch_cancellation_revision, r.dispatch_cancellation_receipt_id,
               settings.revision as media_settings_revision,
               settings.report_media_allowance_bytes, settings.image_media_limit_bytes
        from clinical.report r left join clinical.call_assignment ca
          on ca.report_id = r.id and ca.organization_id = r.organization_id
        join app_identity.agency_settings settings on settings.organization_id = r.organization_id
        where r.id = $1 and r.organization_id = $2 and r.documenting_user_id = $3
          and r.status = 'draft'
      `, [reportId, session.organization.id, session.user.id]);
      const row = rows[0];
      if (!row) throw new NotFoundException(`Report ${reportId} was not found`);
      const reportRevision = Number(row.revision);
      const dispatchRevision = Number(row.dispatch_revision ?? 0);
      const settingsRevision = Number(row.media_settings_revision);
      const etag = `"report-${reportRevision}-dispatch-${dispatchRevision}-settings-${settingsRevision}"`;
      if (ifNoneMatch === etag) return { etag, resource: null };
      const document = await encounterDocument(manager, reportId);
      const notes = await reportTextNotes(manager, reportId);
      const conflicts = await dispatchConflicts(manager, reportId);
      return {
        etag,
        resource: {
          reportId,
          reportRevision,
          dispatchRevision,
          document,
          notes,
          mediaPolicy: {
            settingsRevision,
            reportMediaAllowanceBytes: Number(row.report_media_allowance_bytes),
            imageMediaLimitBytes: Number(row.image_media_limit_bytes),
          },
          dispatchConflicts: conflicts,
          dispatchCancellation: row.dispatch_canceled_at && row.dispatch_cancellation_revision && row.dispatch_cancellation_receipt_id ? {
            canceledAt: new Date(row.dispatch_canceled_at).toISOString(),
            dispatchRevision: Number(row.dispatch_cancellation_revision),
            receiptId: row.dispatch_cancellation_receipt_id,
          } : null,
        },
      };
    });
  }

  async resolveDispatchConflict(
    accessToken: string,
    reportId: string,
    conflictId: string,
    input: unknown
  ): Promise<DispatchConflict> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
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
    const ordered: Array<typeof upserts> = [];
    const pending = [...upserts];
    while (pending.length) {
      const savedIds = new Set(ordered.flat().map(({ id }) => id));
      const ready = pending.filter((group) => !group.parentGroupInstanceId ||
        !inputIds.has(group.parentGroupInstanceId) || savedIds.has(group.parentGroupInstanceId));
      if (!ready.length) throw new UnprocessableEntityException("Group parent identities contain a cycle");
      ordered.push(ready);
      for (const group of ready) pending.splice(pending.indexOf(group), 1);
    }
    for (const layer of ordered) {
      const saved = mutationRows<{ id: string }>(await manager.query(`
        insert into clinical.group_instance
          (id, report_id, catalog_release_id, parent_group_instance_id, group_id, source_kind,
           custom_group_definition_id, ordinal, correlation_id, documented_time,
           documented_utc_offset_minutes, created_by)
        select incoming.id, $1, $2, incoming.parent_group_instance_id, incoming.group_id,
               incoming.source_kind, incoming.custom_group_definition_id, incoming.ordinal,
               incoming.correlation_id, incoming.documented_time,
               incoming.documented_utc_offset_minutes, $3
        from jsonb_to_recordset($4::jsonb) as incoming(
          id uuid, parent_group_instance_id uuid, group_id text, source_kind text,
          custom_group_definition_id uuid, ordinal integer, correlation_id text,
          documented_time timestamptz, documented_utc_offset_minutes smallint)
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
      `, [report.id, report.catalog_release_id, command.authorId, JSON.stringify(layer.map((group) => ({
        id: group.id,
        parent_group_instance_id: group.parentGroupInstanceId ?? null,
        group_id: group.groupId,
        source_kind: group.customGroupDefinitionId ? "custom" : "nemsis",
        custom_group_definition_id: group.customGroupDefinitionId ?? null,
        ordinal: group.ordinal,
        correlation_id: group.correlationId ?? null,
        documented_time: group.documentedTime ?? null,
        documented_utc_offset_minutes: group.documentedUtcOffsetMinutes ?? null
      }))) ]));
      if (saved.length !== layer.length) {
        throw new ConflictException("One or more group identities already belong to different data");
      }
    }
    const tombstones = mutations.filter((candidate) => candidate.tombstone);
    if (tombstones.length) {
      const removed = mutationRows<{ id: string }>(await manager.query(`
        update clinical.group_instance saved set tombstoned_at = now()
        from jsonb_to_recordset($2::jsonb) as incoming(id uuid, group_id text)
        where saved.id = incoming.id and saved.report_id = $1 and saved.group_id = incoming.group_id
        returning saved.id
      `, [report.id, JSON.stringify(tombstones.map((group) => ({ id: group.id, group_id: group.groupId })))]));
      if (removed.length !== tombstones.length) {
        throw new ConflictException("One or more group identities do not belong to this report and group");
      }
    }
  }

  private async applyOccurrence(
    manager: EntityManager,
    report: ReportRow,
    command: SaveDraftReportCommand,
    occurrence: DraftOccurrenceMutation
  ): Promise<void> {
    const metadata = occurrence.tombstone
      ? new Map<string, ElementMetadata>()
      : await this.elementMetadataBatch(manager, report, [occurrence]);
    await this.applyOccurrences(manager, report, command, [occurrence], metadata);
  }

  private async applyOccurrences(
    manager: EntityManager,
    report: ReportRow,
    command: SaveDraftReportCommand,
    occurrences: ReadonlyArray<DraftOccurrenceMutation>,
    metadataByOccurrence: ReadonlyMap<string, ElementMetadata>
  ): Promise<void> {
    const tombstones = occurrences.filter((occurrence) => occurrence.tombstone);
    if (tombstones.length) {
      const removed = mutationRows<{ id: string }>(await manager.query(`
        update clinical.element_occurrence saved
        set tombstoned_at = now(), updated_at = now(), author_id = $3,
            provenance_kind = 'clinician',
            provenance_detail = coalesce(saved.provenance_detail, '{}'::jsonb) ||
              '{"ownershipAction":"clear","clinicianValue":null}'::jsonb
        from jsonb_to_recordset($2::jsonb) as incoming(id uuid, element_id text)
        where saved.id = incoming.id and saved.report_id = $1 and saved.element_id = incoming.element_id
        returning saved.id
      `, [report.id, JSON.stringify(tombstones.map((occurrence) => ({
        id: occurrence.id, element_id: occurrence.elementId
      }))), command.authorId]));
      if (removed.length !== tombstones.length) {
        throw new ConflictException("One or more occurrence identities do not belong to this report and element");
      }
    }

    const upserts = occurrences.filter((occurrence) => !occurrence.tombstone);
    if (!upserts.length) return;
    const rows = upserts.map((occurrence) => {
      const metadata = metadataByOccurrence.get(occurrence.id)!;
      const value = occurrence.value!;
      this.validateDatatype(value, metadata, occurrence.elementId);
      if (metadata.base_datatype === "binary" && value.kind === "binary" &&
          (value.value.length < 1 || value.value.length > 100000 ||
           !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.value) ||
           Buffer.from(value.value, "base64").toString("base64") !== value.value))
        throw new UnprocessableEntityException(`${occurrence.elementId} requires canonical base64 of at most 100000 characters`);
      if (metadata.text_constraints && value.kind === "text") {
        const constraints = metadata.text_constraints;
        if (value.value.length < 1 || value.value.length > 100000 || constraints.minLength !== undefined && value.value.length < constraints.minLength ||
            constraints.maxLength !== undefined && value.value.length > constraints.maxLength ||
            constraints.pattern && !new RegExp(`^(?:${constraints.pattern})$`).test(value.value))
          throw new UnprocessableEntityException(`${occurrence.elementId} does not satisfy its published text constraints`);
      }
      if (metadata.text_constraints && value.kind === "numeric") {
        const bounds = metadata.text_constraints;
        const numeric = Number(value.value);
        if (!Number.isFinite(numeric) || bounds.minimum !== undefined && numeric < bounds.minimum ||
            bounds.maximum !== undefined && numeric > bounds.maximum)
          throw new UnprocessableEntityException(`${occurrence.elementId} does not satisfy its published numeric bounds`);
      }
      const columns = this.valueColumns(value);
      return {
        id: occurrence.id,
        group_instance_id: occurrence.groupInstanceId ?? null,
        element_identity_id: metadata.element_identity_id,
        element_id: occurrence.elementId,
        form_field_id: occurrence.formFieldId ?? metadata.form_field_id ?? null,
        ordinal: occurrence.ordinal ?? 0,
        analytical_repeatable: metadata.analytical_repeatable,
        identifying: metadata.identifying,
        value_kind: value.kind,
        value_text: columns.valueText,
        value_integer: columns.valueInteger,
        value_numeric: columns.valueNumeric,
        value_boolean: columns.valueBoolean,
        value_date: columns.valueDate,
        value_datetime: columns.valueDatetime,
        value_time: columns.valueTime,
        value_duration: columns.valueDuration,
        value_binary: columns.valueBinary instanceof Buffer ? columns.valueBinary.toString("base64") : null,
        value_lexical: columns.valueLexical,
        value_utc_offset_minutes: columns.valueUtcOffsetMinutes,
        value_precision: columns.valuePrecision,
        code: columns.code,
        code_system: columns.codeSystem,
        code_display: columns.codeDisplay,
        terminology_version: columns.terminologyVersion,
        absence_code: columns.absenceCode,
        absence_display: columns.absenceDisplay,
        not_value_code: columns.notValueCode,
        not_value_display: columns.notValueDisplay,
        pertinent_negative_code: columns.pertinentNegativeCode,
        pertinent_negative_display: columns.pertinentNegativeDisplay,
        source_attributes: occurrence.sourceAttributes ?? null,
        correlation_id: occurrence.correlationId ?? null,
        provenance_kind: occurrence.provenanceKind === "demo" ? "demo" : "clinician",
        provenance_detail: occurrence.provenanceKind === "demo"
          ? { ...occurrence.provenanceDetail, ownershipAction: "demo-populate", clinicianValue: occurrence.value }
          : { ownershipAction: "create-edit-or-affirm", clinicianValue: occurrence.value },
        documented_time: occurrence.documentedTime ?? null,
        documented_utc_offset_minutes: occurrence.documentedUtcOffsetMinutes ?? null,
        documented_precision: occurrence.documentedPrecision ?? null
      };
    });
    const saved = mutationRows<{ id: string }>(await manager.query(`
      insert into clinical.element_occurrence
        (id, report_id, catalog_release_id, group_instance_id, element_identity_id, element_id,
         form_field_id, ordinal, analytical_repeatable, identifying, value_kind,
         value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime,
         value_time, value_duration, value_binary, value_lexical, value_utc_offset_minutes,
         value_precision, code, code_system, code_display, terminology_version, absence_code,
         absence_display, not_value_code, not_value_display, pertinent_negative_code,
         pertinent_negative_display, source_attributes, correlation_id, provenance_kind, provenance_detail,
         documented_time, documented_utc_offset_minutes, documented_precision, author_id)
      select incoming.id, $1, $2, incoming.group_instance_id, incoming.element_identity_id,
             incoming.element_id, incoming.form_field_id, incoming.ordinal,
             incoming.analytical_repeatable, incoming.identifying, incoming.value_kind,
             incoming.value_text, incoming.value_integer, incoming.value_numeric,
             incoming.value_boolean, incoming.value_date, incoming.value_datetime,
             incoming.value_time, incoming.value_duration,
             case when incoming.value_binary is null then null else decode(incoming.value_binary, 'base64') end,
             incoming.value_lexical, incoming.value_utc_offset_minutes, incoming.value_precision,
             incoming.code, incoming.code_system, incoming.code_display,
             incoming.terminology_version, incoming.absence_code, incoming.absence_display,
             incoming.not_value_code, incoming.not_value_display,
             incoming.pertinent_negative_code, incoming.pertinent_negative_display,
             incoming.source_attributes, incoming.correlation_id, incoming.provenance_kind,
             incoming.provenance_detail, incoming.documented_time,
             incoming.documented_utc_offset_minutes, incoming.documented_precision, $3
      from jsonb_to_recordset($4::jsonb) as incoming(
        id uuid, group_instance_id uuid, element_identity_id uuid, element_id text,
        form_field_id uuid, ordinal integer, analytical_repeatable boolean, identifying boolean,
        value_kind text, value_text text, value_integer bigint, value_numeric numeric,
        value_boolean boolean, value_date date, value_datetime timestamptz, value_time time,
        value_duration interval, value_binary text, value_lexical text,
        value_utc_offset_minutes smallint, value_precision text, code text, code_system text,
        code_display text, terminology_version text, absence_code text, absence_display text,
        not_value_code text, not_value_display text,
        pertinent_negative_code text, pertinent_negative_display text,
        source_attributes jsonb, correlation_id text, provenance_kind text, provenance_detail jsonb,
        documented_time timestamptz, documented_utc_offset_minutes smallint,
        documented_precision text)
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
        absence_display = excluded.absence_display, not_value_code = excluded.not_value_code,
        not_value_display = excluded.not_value_display,
        pertinent_negative_code = excluded.pertinent_negative_code,
        pertinent_negative_display = excluded.pertinent_negative_display,
        source_attributes = excluded.source_attributes,
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
    `, [report.id, report.catalog_release_id, command.authorId, JSON.stringify(rows)]));
    if (saved.length !== upserts.length) {
      throw new ConflictException("One or more occurrence identities already belong to different data");
    }
  }

  private async elementMetadataBatch(
    manager: EntityManager,
    report: ReportRow,
    occurrences: ReadonlyArray<DraftOccurrenceMutation>
  ): Promise<Map<string, ElementMetadata>> {
    if (!occurrences.length) return new Map();
    const elementIds = [...new Set(occurrences.map(({ elementId }) => elementId))];
    const standard = await manager.query<ElementMetadata[]>(`
      select e.element_id, e.element_identity_id, e.base_datatype, e.max_occurs,
             e.supports_not_values, e.supports_pertinent_negatives,
             (m.analytical_location = 'repeatable') as analytical_repeatable,
             m.identifying,
             array(select o.source_kind || ':' || o.code from catalog.element_option o
                   where o.release_id = e.release_id and o.element_id = e.element_id) as allowed_absence_states
      from catalog.element_definition e
      join catalog.analytics_element_mapping m on m.release_id = e.release_id and m.element_id = e.element_id
      where e.release_id = $1 and e.element_id = any($2::text[])
    `, [report.catalog_release_id, elementIds]);
    const standardByElement = new Map(standard.map((metadata) => [metadata.element_id!, metadata]));
    const formFieldIds = [...new Set(occurrences.flatMap(({ formFieldId }) => formFieldId ? [formFieldId] : []))];
    const fields = formFieldIds.length ? await manager.query<ElementMetadata[]>(`
        select ff.id as form_field_id, ced.namespace || '.' || ced.slug as element_id,
               coalesce(ff.catalog_element_identity_id, ff.custom_element_definition_id) as element_identity_id,
               ced.base_datatype, case when ced.definition->>'recurrence' = 'single' then 1 else null end as max_occurs,
               (cardinality(ff.allowed_absence_states) > 0) as supports_not_values,
               (cardinality(ff.allowed_absence_states) > 0) as supports_pertinent_negatives,
               ff.analytical_repeatable, ced.identifying, ced.definition as custom_definition,
               (select item->'choicePolicy' from jsonb_array_elements(fv.canonical_definition->'sections') section,
                 jsonb_array_elements(section->'fields') item where item->>'key'=ff.stable_key limit 1) as form_choice_policy,
               array(select 'form:' || state from unnest(ff.allowed_absence_states) state) as allowed_absence_states
        from forms.form_field ff
        join forms.form_version fv on fv.id=ff.form_version_id
        left join forms.custom_element_definition ced on ced.id = ff.custom_element_definition_id
        where ff.id = any($1::uuid[]) and ff.form_version_id = $2
      `, [formFieldIds, report.form_version_id]) : [];
    const fieldsById = new Map(fields.map((metadata) => [metadata.form_field_id!, metadata]));
    const customElementIds = elementIds.filter((id) => id.split(".").length > 2);
    const custom = customElementIds.length ? await manager.query<ElementMetadata[]>(`
      select ced.namespace || '.' || ced.slug as element_id,ff.id as form_field_id,
             ced.id as element_identity_id,ced.base_datatype,
             case when ced.definition->>'recurrence' = 'single' then 1 else null end as max_occurs,
             ff.analytical_repeatable,ced.identifying,
             (cardinality(ff.allowed_absence_states) > 0) as supports_not_values,
             (cardinality(ff.allowed_absence_states) > 0) as supports_pertinent_negatives,
             array(select 'form:' || state from unnest(ff.allowed_absence_states) state) as allowed_absence_states,
             ced.definition->'constraints' as text_constraints, ced.definition as custom_definition,
             (select item->'choicePolicy' from jsonb_array_elements(fv.canonical_definition->'sections') section,
               jsonb_array_elements(section->'fields') item where item->>'key'=ff.stable_key limit 1) as form_choice_policy
      from forms.form_field ff join forms.custom_element_definition ced on ced.id=ff.custom_element_definition_id
      join forms.form_version fv on fv.id=ff.form_version_id
      where ff.form_version_id=$1 and ced.namespace || '.' || ced.slug=any($2::text[])
    `, [report.form_version_id, customElementIds]) : [];
    const customByElement = new Map(custom.map((metadata) => [metadata.element_id!, metadata]));
    const result = new Map<string, ElementMetadata>();
    for (const occurrence of occurrences) {
      let metadata = standardByElement.get(occurrence.elementId) ?? customByElement.get(occurrence.elementId);
      const field = occurrence.formFieldId ? fieldsById.get(occurrence.formFieldId) : undefined;
      if (!metadata && field?.base_datatype && field.element_id === occurrence.elementId) metadata = field;
      if (!metadata) {
        throw new UnprocessableEntityException(`Element ${occurrence.elementId} is not in the pinned catalog or form`);
      }
      if (occurrence.formFieldId && (!field || field.element_identity_id !== metadata.element_identity_id)) {
        throw new UnprocessableEntityException(`formFieldId does not map to ${occurrence.elementId}`);
      }
      result.set(occurrence.id, metadata);
    }
    return result;
  }

  private validateDatatype(value: DraftValue, metadata: ElementMetadata, elementId: string): void {
    if (metadata.base_datatype === "coded" && metadata.custom_definition?.datatype === "coded") {
      const findings = customCodedValueFindings(metadata.custom_definition, value,
        metadata.form_choice_policy, metadata.allowed_absence_states.map((state) => state.replace(/^form:/, "")));
      if (findings.length) throw new UnprocessableEntityException(findings.join("; "));
    }
    const expected: Record<string, DraftValue["kind"]> = {
      string: "text", integer: "integer", decimal: "numeric", boolean: "boolean",
      date: "date", dateTime: "datetime", time: "time", duration: "duration",
      binary: "binary", anyURI: "uri"
    };
    if (!["coded", "null", "pertinent-negative", "absent"].includes(value.kind) && expected[metadata.base_datatype] !== value.kind) {
      throw new UnprocessableEntityException(`${elementId} requires ${metadata.base_datatype}, not ${value.kind}`);
    }
    if (metadata.base_datatype === "decimal" && value.kind === "numeric" &&
        (typeof value.value !== "number" && typeof value.value !== "string" ||
         String(value.value).trim() === "" || !Number.isFinite(Number(value.value))))
      throw new UnprocessableEntityException(`${elementId} requires a finite number`);
    if (metadata.base_datatype === "boolean" && value.kind === "boolean" && typeof value.value !== "boolean")
      throw new UnprocessableEntityException(`${elementId} requires true or false`);
    if (metadata.base_datatype === "dateTime" && value.kind === "datetime" &&
        (typeof value.value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.value) ||
         !Number.isFinite(Date.parse(value.value))))
      throw new UnprocessableEntityException(`${elementId} requires an ISO date and time with a timezone`);
    if (value.kind === "null" || value.kind === "pertinent-negative") {
      const prefix = value.kind === "null" ? "not-value:" : "pertinent-negative:";
      if (!metadata.allowed_absence_states.includes(`${prefix}${value.absenceCode}`) &&
          !metadata.allowed_absence_states.includes(`form:${value.absenceCode}`)) {
        throw new UnprocessableEntityException(`${value.absenceCode} is not a supported ${value.kind} for ${elementId}`);
      }
    }
    const notValue = value.notValue ?? (value.kind === "null" ? { code: value.absenceCode, display: value.display } : undefined);
    const pertinentNegative = value.pertinentNegative ?? (value.kind === "pertinent-negative" ? { code: value.absenceCode, display: value.display } : undefined);
    if (notValue && (!metadata.supports_not_values ||
        (!metadata.allowed_absence_states.includes(`not-value:${notValue.code}`) &&
         !metadata.allowed_absence_states.includes(`form:${notValue.code}`)))) {
      throw new UnprocessableEntityException(`${notValue.code} is not a supported not-value for ${elementId}`);
    }
    if (pertinentNegative && (!metadata.supports_pertinent_negatives ||
        (!metadata.allowed_absence_states.includes(`pertinent-negative:${pertinentNegative.code}`) &&
         !metadata.allowed_absence_states.includes(`form:${pertinentNegative.code}`)))) {
      throw new UnprocessableEntityException(`${pertinentNegative.code} is not a supported pertinent-negative for ${elementId}`);
    }
  }

  private valueColumns(value: DraftValue): Record<string, unknown> {
    const result: Record<string, unknown> = {
      valueText: null, valueInteger: null, valueNumeric: null, valueBoolean: null,
      valueDate: null, valueDatetime: null, valueTime: null, valueDuration: null,
      valueBinary: null, valueLexical: null, valueUtcOffsetMinutes: null,
      valuePrecision: null, code: null, codeSystem: null, codeDisplay: null,
      terminologyVersion: null, absenceCode: null, absenceDisplay: null,
      notValueCode: null, notValueDisplay: null,
      pertinentNegativeCode: null, pertinentNegativeDisplay: null
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
    const notValue = value.notValue ?? (value.kind === "null" ? { code: value.absenceCode, display: value.display } : undefined);
    const pertinentNegative = value.pertinentNegative ?? (value.kind === "pertinent-negative" ? { code: value.absenceCode, display: value.display } : undefined);
    result.notValueCode = notValue?.code ?? null;
    result.notValueDisplay = notValue?.display ?? null;
    result.pertinentNegativeCode = pertinentNegative?.code ?? null;
    result.pertinentNegativeDisplay = pertinentNegative?.display ?? null;
    return result;
  }

  private async reportResult(
    manager: EntityManager,
    reportId: string,
    organizationId?: string,
    documentingUserId?: string
  ): Promise<DraftReportResult> {
    const rows = await manager.query<ReportRow[]>(`select id, status, revision, organization_id, incident_id,
      patient_id, agency_demographic_version_id, form_version_id, catalog_release_id, validation_version_id,
      form_definition_sha256, catalog_artifact_sha256, validation_compiled_sha256,
      documenting_user_id, media_settings_revision, report_media_allowance_bytes,
      image_media_limit_bytes,
      expires_at
      from clinical.report where id = $1
        and ($2::uuid is null or organization_id = $2)
        and ($3::uuid is null or documenting_user_id = $3)`,
    [reportId, organizationId ?? null, documentingUserId ?? null]);
    const row = rows[0];
    if (!row) {
      await this.throwIfPurged(manager, reportId, organizationId);
      throw new NotFoundException(`Report ${reportId} was not found`);
    }
    if (row.status !== "draft") throw new ConflictException("Report is no longer a draft");
    return this.draftResult(row, Number(row.revision));
  }

  private draftResult(row: ReportRow, revision: number): DraftReportResult {
    return {
      id: row.id, status: "draft", revision, organizationId: row.organization_id,
      incidentId: row.incident_id, patientId: row.patient_id,
      agencyDemographicVersionId: row.agency_demographic_version_id,
      formVersionId: row.form_version_id, catalogReleaseId: row.catalog_release_id,
      ...(row.validation_version_id ? { validationVersionId: row.validation_version_id } : {}),
      ...(row.form_definition_sha256 ? { formDefinitionSha256: row.form_definition_sha256 } : {}),
      ...(row.catalog_artifact_sha256 ? { catalogArtifactSha256: row.catalog_artifact_sha256 } : {}),
      ...(row.validation_compiled_sha256 ? { validationCompiledSha256: row.validation_compiled_sha256 } : {}),
      documentingUserId: row.documenting_user_id,
      mediaPolicy: {
        reportMediaAllowanceBytes: Number(row.report_media_allowance_bytes ?? DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES),
        imageMediaLimitBytes: Number(row.image_media_limit_bytes ?? DEFAULT_IMAGE_MEDIA_LIMIT_BYTES),
        settingsRevision: Number(row.media_settings_revision ?? 1),
      },
    };
  }

  private async lockCommand(manager: EntityManager, commandId: string): Promise<void> {
    await manager.query("select pg_advisory_xact_lock(hashtext($1))", [commandId]);
  }

  private async throwIfPurged(
    manager: EntityManager,
    reportId: string,
    organizationId?: string,
  ): Promise<void> {
    const rows = await manager.query<Array<{ exists: boolean }>>(`select exists (
      select 1 from clinical_audit.synthetic_purge_tombstone
      where record_type = 'report' and record_id = $1
        and ($2::uuid is null or organization_id = $2)
    )`, [reportId, organizationId ?? null]);
    if (rows[0]?.exists) throw new GoneException(`Report ${reportId} expired and was permanently purged`);
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
