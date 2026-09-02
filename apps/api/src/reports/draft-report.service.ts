import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type {
  CreateDraftReportCommand,
  DraftOccurrenceMutation,
  DraftReportResult,
  DraftValue,
  SaveDraftReportCommand
} from "./draft-report.types.js";
import {
  commandSha256,
  DraftReportValidationError,
  validateCreateDraftReportCommand,
  validateSaveDraftReportCommand
} from "./draft-report.validation.js";

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

@Injectable()
export class DraftReportService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(input: unknown): Promise<DraftReportResult> {
    let command: CreateDraftReportCommand;
    try {
      command = validateCreateDraftReportCommand(input);
    } catch (error) {
      this.rethrowValidation(error);
    }
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
          insert into clinical.patient (id, organization_id, identity_state, pseudonymous_key)
          values ($1, $2, $3, $4) on conflict (id) do nothing
        `, [command.patientId, command.organizationId, command.patientIdentityState, command.patientPseudonymousKey]);

        const related = await manager.query<Array<{ incident_ok: boolean; patient_ok: boolean }>>(`
          select
            exists(select 1 from clinical.incident where id = $1 and organization_id = $3) as incident_ok,
            exists(select 1 from clinical.patient where id = $2 and organization_id = $3
                   and identity_state = $4 and pseudonymous_key = $5) as patient_ok
        `, [command.incidentId, command.patientId, command.organizationId,
          command.patientIdentityState, command.patientPseudonymousKey]);
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

  async save(reportId: string, input: unknown): Promise<DraftReportResult> {
    let command: SaveDraftReportCommand;
    try {
      command = validateSaveDraftReportCommand(input);
    } catch (error) {
      this.rethrowValidation(error);
    }
    const digest = commandSha256(command);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await this.lockCommand(manager, command.commandId);
        const replay = await this.replay<DraftReportResult>(manager, command.commandId, "save-draft", digest, reportId);
        if (replay) return replay;

        const rows = await manager.query<ReportRow[]>("select * from clinical.report where id = $1 for update", [reportId]);
        const report = rows[0];
        if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
        if (report.status !== "draft") throw new ConflictException("A signed report cannot be autosaved");
        const revision = Number(report.revision);
        if (revision !== command.expectedRevision) {
          throw new ConflictException({ message: "Draft revision is stale", expectedRevision: command.expectedRevision, currentRevision: revision });
        }
        const authors = await manager.query<Array<{ id: string }>>(`
          select id from app_identity.app_user where id = $1 and organization_id = $2 and active
        `, [command.authorId, report.organization_id]);
        if (!authors[0]) throw new UnprocessableEntityException("authorId must be an active user in the report organization");

        await this.applyGroups(manager, report, command);
        for (const occurrence of command.occurrences ?? []) await this.applyOccurrence(manager, report, command, occurrence);

        const nextRevision = revision + 1;
        await manager.query(`
          update clinical.report set revision = $2, updated_at = now() where id = $1
        `, [reportId, nextRevision]);
        await manager.query(`
          insert into clinical.report_change
            (report_id, revision, idempotency_key, author_id, device_id, client_time, changes)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `, [reportId, nextRevision, command.commandId, command.authorId,
          command.deviceId ?? null, command.clientTime ?? null, JSON.stringify({
            groups: command.groups ?? [], occurrences: command.occurrences ?? []
          })]);
        const result = await this.reportResult(manager, reportId);
        await this.storeReceipt(manager, command.commandId, reportId, "save-draft", digest, result);
        return result;
      });
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  async get(reportId: string): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const report = await this.reportResult(manager, reportId);
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
          documented_utc_offset_minutes = excluded.documented_utc_offset_minutes
        where clinical.group_instance.report_id = excluded.report_id
          and clinical.group_instance.group_id = excluded.group_id
          and clinical.group_instance.source_kind = excluded.source_kind
          and clinical.group_instance.custom_group_definition_id is not distinct from excluded.custom_group_definition_id
          and clinical.group_instance.tombstoned_at is null
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
        update clinical.element_occurrence set tombstoned_at = now(), updated_at = now(), author_id = $4
        where id = $1 and report_id = $2 and element_id = $3 returning id
      `, [occurrence.id, report.id, occurrence.elementId, command.authorId]);
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
        provenance_detail = excluded.provenance_detail, documented_time = excluded.documented_time,
        documented_utc_offset_minutes = excluded.documented_utc_offset_minutes,
        documented_precision = excluded.documented_precision, author_id = excluded.author_id,
        server_received_time = now(), updated_at = now()
      where clinical.element_occurrence.report_id = excluded.report_id
        and clinical.element_occurrence.element_identity_id = excluded.element_identity_id
        and clinical.element_occurrence.element_id = excluded.element_id
        and clinical.element_occurrence.tombstoned_at is null
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
      occurrence.correlationId ?? null, occurrence.provenanceKind ?? "clinician",
      occurrence.provenanceDetail ? JSON.stringify(occurrence.provenanceDetail) : null,
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

  private async reportResult(manager: EntityManager, reportId: string): Promise<DraftReportResult> {
    const rows = await manager.query<ReportRow[]>(`select id, status, revision, organization_id, incident_id,
      patient_id, agency_demographic_version_id, form_version_id, catalog_release_id, documenting_user_id
      from clinical.report where id = $1`, [reportId]);
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
    response: DraftReportResult
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
