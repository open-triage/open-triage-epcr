import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type { AmendReportCommand, AmendedReportResult, AmendmentChange } from "./amend-report.types.js";
import { AmendReportValidationError, validateAmendReportCommand } from "./amend-report.validation.js";
import type { DraftOccurrenceMutation, DraftValue } from "./draft-report.types.js";
import { commandSha256 } from "./draft-report.validation.js";
import { customCodedValueFindings } from "./custom-coded-validation.js";

type ReportRow = {
  id: string;
  status: "draft" | "signed";
  organization_id: string;
  form_version_id: string;
  catalog_release_id: string;
};

type ReceiptRow = {
  report_id: string | null;
  command_type: string;
  request_sha256: string;
  response_body: unknown;
};

type ElementMetadata = {
  element_identity_id: string;
  base_datatype: string;
  analytical_repeatable: boolean;
  identifying: boolean;
  allowed_absence_states: string[];
  supports_not_values: boolean;
  supports_pertinent_negatives: boolean;
  custom_definition?: import("@open-triage/contracts").CatalogDraftCustomElement | null;
  form_choice_policy?: import("@open-triage/contracts").FormDraftField["choicePolicy"];
};

type StoredChange = {
  action: "add" | "replace" | "remove";
  targetElementOccurrenceId: string | null;
  targetPath: Record<string, unknown>;
  originalValue: Record<string, unknown> | null;
  correctedValue: Record<string, unknown> | null;
};

@Injectable()
export class AmendReportService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async amend(reportId: string, input: unknown): Promise<AmendedReportResult> {
    let command: AmendReportCommand;
    try {
      command = validateAmendReportCommand(input);
    } catch (error) {
      if (error instanceof AmendReportValidationError) {
        throw new UnprocessableEntityException({ message: error.message, findings: error.findings });
      }
      throw error;
    }
    const digest = commandSha256(command);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await manager.query("select pg_advisory_xact_lock(hashtext($1))", [command.commandId]);
        const replay = await this.replay(manager, command.commandId, digest, reportId);
        if (replay) return replay;

        const reports = await manager.query<ReportRow[]>("select * from clinical.report where id = $1 for update", [reportId]);
        const report = reports[0];
        if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
        if (report.status !== "signed") throw new ConflictException("Only a signed report may be amended");
        const sequenceRows = await manager.query<Array<{ next_sequence: string | number }>>(
          "select coalesce(max(sequence), 0) + 1 as next_sequence from clinical.amendment where report_id = $1",
          [reportId]
        );
        const nextSequence = Number(sequenceRows[0]!.next_sequence);
        if (command.expectedSequence !== nextSequence) {
          throw new ConflictException({
            message: "Amendment sequence is stale",
            expectedSequence: command.expectedSequence,
            nextSequence
          });
        }
        const authors = await manager.query<Array<{ id: string }>>(`select id from app_identity.app_user
          where id = $1 and organization_id = $2 and active`, [command.authorId, report.organization_id]);
        if (!authors[0]) {
          throw new UnprocessableEntityException("authorId must be an active user in the report organization");
        }

        const effective = await this.effectiveOccurrences(manager, reportId);
        const storedChanges: StoredChange[] = [];
        const signedAt = new Date().toISOString();
        for (const change of command.changes) {
          const stored = await this.prepareChange(manager, report, command, change, effective, signedAt);
          storedChanges.push(stored);
          if (stored.action === "remove") effective.delete(stored.targetElementOccurrenceId!);
          else effective.set(String(stored.correctedValue!.id), stored.correctedValue!);
        }
        await this.validateEffectiveState(manager, report, effective);

        const amendmentId = randomUUID();
        const canonicalPayload = {
          schemaVersion: 1,
          reportId,
          amendmentId,
          sequence: nextSequence,
          authorId: command.authorId,
          reason: command.reason,
          attestation: command.attestation,
          signedAt,
          changes: storedChanges
        };
        const canonicalSha256 = commandSha256(canonicalPayload);
        await manager.query(`insert into clinical.amendment
          (id, report_id, sequence, author_id, reason, attestation, canonical_sha256, signed_at)
          values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [amendmentId, reportId, nextSequence, command.authorId, command.reason,
          JSON.stringify(command.attestation), canonicalSha256, signedAt]);
        for (const change of storedChanges) {
          await manager.query(`insert into clinical.amendment_change
            (amendment_id, action, target_element_occurrence_id, target_path, original_value, corrected_value)
            values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
          [amendmentId, change.action, change.targetElementOccurrenceId,
            JSON.stringify(change.targetPath), change.originalValue ? JSON.stringify(change.originalValue) : null,
            change.correctedValue ? JSON.stringify(change.correctedValue) : null]);
        }
        await this.appendAudit(manager, reportId, command, amendmentId, nextSequence,
          canonicalSha256, signedAt, storedChanges);

        const result: AmendedReportResult = {
          id: reportId,
          status: "signed",
          amendmentId,
          amendmentSequence: nextSequence,
          canonicalSha256,
          authorId: command.authorId,
          reason: command.reason,
          signedAt,
          changeCount: storedChanges.length
        };
        await manager.query(`insert into clinical.command_receipt
          (idempotency_key, report_id, command_type, request_sha256, response_status, response_body)
          values ($1, $2, 'amend-report', $3, 201, $4::jsonb)`,
        [command.commandId, reportId, digest, JSON.stringify(result)]);
        return result;
      });
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  private async effectiveOccurrences(
    manager: EntityManager,
    reportId: string
  ): Promise<Map<string, Record<string, unknown>>> {
    const base = await manager.query<Array<{ occurrence: Record<string, unknown> }>>(
      "select to_jsonb(o) as occurrence from clinical.element_occurrence o where report_id = $1 and tombstoned_at is null",
      [reportId]
    );
    const effective = new Map(base.map(({ occurrence }) => [String(occurrence.id), occurrence]));
    const overlays = await manager.query<Array<{
      action: string;
      target_element_occurrence_id: string | null;
      corrected_value: Record<string, unknown> | null;
    }>>(`select ac.action, ac.target_element_occurrence_id, ac.corrected_value
      from clinical.amendment a join clinical.amendment_change ac on ac.amendment_id = a.id
      where a.report_id = $1 order by a.sequence, ac.id`, [reportId]);
    for (const overlay of overlays) {
      if (overlay.action === "remove") effective.delete(overlay.target_element_occurrence_id!);
      else if (overlay.corrected_value) {
        const target = overlay.action === "replace" ? effective.get(overlay.target_element_occurrence_id!) : undefined;
        const next = { ...(target ?? {}), ...overlay.corrected_value };
        effective.set(String(next.id), next);
      }
    }
    return effective;
  }

  private async prepareChange(
    manager: EntityManager,
    report: ReportRow,
    command: AmendReportCommand,
    change: AmendmentChange,
    effective: Map<string, Record<string, unknown>>,
    signedAt: string
  ): Promise<StoredChange> {
    if (change.action === "remove") {
      const original = effective.get(change.targetElementOccurrenceId);
      if (!original) throw new UnprocessableEntityException(`Occurrence ${change.targetElementOccurrenceId} is not in the effective report`);
      return {
        action: "remove",
        targetElementOccurrenceId: change.targetElementOccurrenceId,
        targetPath: this.targetPath(original),
        originalValue: original,
        correctedValue: null
      };
    }
    if (change.action === "replace") {
      const original = effective.get(change.targetElementOccurrenceId);
      if (!original) throw new UnprocessableEntityException(`Occurrence ${change.targetElementOccurrenceId} is not in the effective report`);
      const metadata = await this.elementMetadata(manager, report, {
        id: String(original.id), elementId: String(original.element_id),
        formFieldId: original.form_field_id as string | null, value: change.value
      });
      await this.validateDatatype(manager, change.value, metadata, report, String(original.element_id));
      const corrected = { ...original, ...this.valueColumns(change.value), author_id: command.authorId,
        provenance_kind: "amendment", updated_at: signedAt };
      return {
        action: "replace",
        targetElementOccurrenceId: change.targetElementOccurrenceId,
        targetPath: this.targetPath(original),
        originalValue: original,
        correctedValue: corrected
      };
    }

    const occurrence = change.occurrence;
    if (effective.has(occurrence.id)) throw new ConflictException(`Occurrence ${occurrence.id} already exists in the effective report`);
    if (occurrence.groupInstanceId) {
      const groups = await manager.query<Array<{ id: string }>>(
        "select id from clinical.group_instance where id = $1 and report_id = $2 and tombstoned_at is null",
        [occurrence.groupInstanceId, report.id]
      );
      if (!groups[0]) throw new UnprocessableEntityException(`Group ${occurrence.groupInstanceId} is not in the signed report`);
    }
    const metadata = await this.elementMetadata(manager, report, occurrence);
    await this.validateDatatype(manager, occurrence.value!, metadata, report, occurrence.elementId);
    const corrected: Record<string, unknown> = {
      id: occurrence.id,
      report_id: report.id,
      catalog_release_id: report.catalog_release_id,
      group_instance_id: occurrence.groupInstanceId ?? null,
      element_identity_id: metadata.element_identity_id,
      element_id: occurrence.elementId,
      form_field_id: occurrence.formFieldId ?? null,
      ordinal: occurrence.ordinal ?? 0,
      analytical_repeatable: metadata.analytical_repeatable,
      identifying: metadata.identifying,
      ...this.valueColumns(occurrence.value!),
      source_attributes: occurrence.sourceAttributes ?? null,
      correlation_id: occurrence.correlationId ?? null,
      provenance_kind: "amendment",
      provenance_detail: occurrence.provenanceDetail ?? null,
      documented_time: occurrence.documentedTime ?? null,
      documented_utc_offset_minutes: occurrence.documentedUtcOffsetMinutes ?? null,
      documented_precision: occurrence.documentedPrecision ?? null,
      server_received_time: signedAt,
      author_id: command.authorId,
      created_at: signedAt,
      updated_at: signedAt,
      tombstoned_at: null
    };
    return {
      action: "add",
      targetElementOccurrenceId: null,
      targetPath: this.targetPath(corrected),
      originalValue: null,
      correctedValue: corrected
    };
  }

  private targetPath(row: Record<string, unknown>): Record<string, unknown> {
    return {
      elementOccurrenceId: row.id,
      elementId: row.element_id,
      groupInstanceId: row.group_instance_id ?? null,
      ordinal: row.ordinal
    };
  }

  private async elementMetadata(
    manager: EntityManager,
    report: ReportRow,
    occurrence: Omit<DraftOccurrenceMutation, "tombstone">
  ): Promise<ElementMetadata> {
    const standard = await manager.query<ElementMetadata[]>(`select e.element_identity_id, e.base_datatype,
        e.supports_not_values, e.supports_pertinent_negatives,
        (m.analytical_location = 'repeatable') as analytical_repeatable, m.identifying,
        array(select o.source_kind || ':' || o.code from catalog.element_option o
          where o.release_id = e.release_id and o.element_id = e.element_id) as allowed_absence_states
      from catalog.element_definition e join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
      where e.release_id = $1 and e.element_id = $2`, [report.catalog_release_id, occurrence.elementId]);
    let metadata = standard[0];
    if (!metadata && occurrence.formFieldId) {
      const custom = await manager.query<ElementMetadata[]>(`select ced.id as element_identity_id, ced.base_datatype,
          ff.analytical_repeatable, ced.identifying, ced.definition as custom_definition,
          (select item->'choicePolicy' from jsonb_array_elements(fv.canonical_definition->'sections') section,
            jsonb_array_elements(section->'fields') item where item->>'key'=ff.stable_key limit 1) as form_choice_policy,
          (cardinality(ff.allowed_absence_states) > 0) as supports_not_values,
          (cardinality(ff.allowed_absence_states) > 0) as supports_pertinent_negatives,
          array(select 'form:' || state from unnest(ff.allowed_absence_states) state) as allowed_absence_states
        from forms.form_field ff join forms.custom_element_definition ced on ced.id = ff.custom_element_definition_id
        join forms.form_version fv on fv.id=ff.form_version_id
        where ff.id = $1 and ff.form_version_id = $2 and ced.namespace || '.' || ced.slug = $3`,
      [occurrence.formFieldId, report.form_version_id, occurrence.elementId]);
      metadata = custom[0];
    }
    if (!metadata) throw new UnprocessableEntityException(`Element ${occurrence.elementId} is not in the pinned catalog or form`);
    if (occurrence.formFieldId) {
      const fields = await manager.query<Array<{ identity_id: string }>>(`select
          coalesce(catalog_element_identity_id, custom_element_definition_id) as identity_id
        from forms.form_field where id = $1 and form_version_id = $2`, [occurrence.formFieldId, report.form_version_id]);
      if (!fields[0] || fields[0].identity_id !== metadata.element_identity_id) {
        throw new UnprocessableEntityException(`formFieldId does not map to ${occurrence.elementId}`);
      }
    }
    return metadata;
  }

  private async baseDatatype(manager: EntityManager, report: ReportRow, elementId: string, formFieldId: string | null): Promise<string> {
    const metadata = await this.elementMetadata(manager, report, {
      id: randomUUID(), elementId, formFieldId, value: { kind: "absent" }
    });
    return metadata.base_datatype;
  }

  private async allowedAbsenceStates(manager: EntityManager, report: ReportRow, elementId: string, formFieldId: string | null): Promise<string[]> {
    const metadata = await this.elementMetadata(manager, report, {
      id: randomUUID(), elementId, formFieldId, value: { kind: "absent" }
    });
    return metadata.allowed_absence_states;
  }

  private async validateDatatype(
    manager: EntityManager,
    value: DraftValue,
    metadata: ElementMetadata,
    report: ReportRow,
    elementId: string
  ): Promise<void> {
    if (metadata.base_datatype === "coded" && metadata.custom_definition?.datatype === "coded") {
      const findings = customCodedValueFindings(metadata.custom_definition, value,
        metadata.form_choice_policy, metadata.allowed_absence_states.map((state) => state.replace(/^form:/, "")));
      if (findings.length) throw new UnprocessableEntityException(findings.join("; "));
    }
    const expected: Record<string, DraftValue["kind"]> = {
      string: "text", integer: "integer", decimal: "numeric", boolean: "boolean", date: "date",
      dateTime: "datetime", time: "time", duration: "duration", binary: "binary", anyURI: "uri"
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
    if (value.kind === "coded") {
      const invalid = await manager.query<Array<{ invalid: boolean }>>(`select exists (
          select 1 from catalog.element_definition e where e.release_id = $1 and e.element_id = $2
            and e.definition #>> '{valueSource,kind}' = 'inline-enumerated'
            and (e.definition #>> '{valueSource,exhaustive}')::boolean
            and not exists (select 1 from catalog.element_option o where o.release_id = e.release_id
              and o.element_id = e.element_id and o.source_kind = 'inline'
              and o.code = $3 and o.code_system = coalesce($4, ''))
        ) as invalid`, [report.catalog_release_id, elementId, value.code, value.codeSystem ?? null]);
      if (invalid[0]?.invalid) throw new UnprocessableEntityException(`Code ${value.code} is not valid for ${elementId}`);
    }
  }

  private valueColumns(value: DraftValue): Record<string, unknown> {
    const result: Record<string, unknown> = {
      value_kind: value.kind, value_text: null, value_integer: null, value_numeric: null,
      value_boolean: null, value_date: null, value_datetime: null, value_time: null,
      value_duration: null, value_binary: null, value_lexical: null,
      value_utc_offset_minutes: null, value_precision: null, code: null, code_system: null,
      code_display: null, terminology_version: null, absence_code: null, absence_display: null,
      not_value_code: null, not_value_display: null,
      pertinent_negative_code: null, pertinent_negative_display: null
    };
    switch (value.kind) {
      case "text": case "uri": result.value_text = value.value; break;
      case "integer": result.value_integer = value.value; result.value_lexical = value.lexical ?? String(value.value); break;
      case "numeric": result.value_numeric = value.value; result.value_lexical = value.lexical ?? String(value.value); break;
      case "boolean": result.value_boolean = value.value; break;
      case "date": result.value_date = value.value; result.value_precision = value.precision ?? null; break;
      case "datetime": result.value_datetime = value.value; result.value_utc_offset_minutes = value.utcOffsetMinutes ?? null; result.value_precision = value.precision ?? null; break;
      case "time": result.value_time = value.value; result.value_utc_offset_minutes = value.utcOffsetMinutes ?? null; result.value_precision = value.precision ?? null; break;
      case "duration": result.value_duration = value.value; result.value_lexical = value.lexical ?? value.value; break;
      case "binary": result.value_binary = `\\x${Buffer.from(value.value, "base64").toString("hex")}`; break;
      case "coded": result.code = value.code; result.code_system = value.codeSystem ?? null; result.code_display = value.display ?? null; result.terminology_version = value.terminologyVersion ?? null; break;
      case "null": case "pertinent-negative": case "absent": result.absence_code = value.absenceCode ?? null; result.absence_display = value.display ?? null; break;
    }
    const notValue = value.notValue ?? (value.kind === "null" ? { code: value.absenceCode, display: value.display } : undefined);
    const pertinentNegative = value.pertinentNegative ?? (value.kind === "pertinent-negative" ? { code: value.absenceCode, display: value.display } : undefined);
    result.not_value_code = notValue?.code ?? null;
    result.not_value_display = notValue?.display ?? null;
    result.pertinent_negative_code = pertinentNegative?.code ?? null;
    result.pertinent_negative_display = pertinentNegative?.display ?? null;
    return result;
  }

  private async validateEffectiveState(
    manager: EntityManager,
    report: ReportRow,
    effective: Map<string, Record<string, unknown>>
  ): Promise<void> {
    const identities = new Set<string>();
    const counts = new Map<string, number>();
    for (const row of effective.values()) {
      const identity = `${row.group_instance_id ?? "root"}:${row.element_identity_id}:${row.ordinal}`;
      if (identities.has(identity)) throw new UnprocessableEntityException(`Amendment creates duplicate occurrence identity ${identity}`);
      identities.add(identity);
      const countKey = `${row.group_instance_id ?? "root"}:${row.element_id}`;
      counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
    }
    const definitions = await manager.query<Array<{ element_id: string; min_occurs: number; max_occurs: number | null }>>(
      "select element_id, min_occurs, max_occurs from catalog.element_definition where release_id = $1",
      [report.catalog_release_id]
    );
    for (const definition of definitions) {
      for (const [key, count] of counts) {
        if (key.endsWith(`:${definition.element_id}`) && definition.max_occurs !== null && count > definition.max_occurs) {
          throw new UnprocessableEntityException(`${definition.element_id} permits at most ${definition.max_occurs} occurrence(s)`);
        }
      }
    }
    const required = await manager.query<Array<{ stable_key: string; identity_id: string }>>(`select stable_key,
        coalesce(catalog_element_identity_id, custom_element_definition_id) as identity_id
      from forms.form_field where form_version_id = $1 and required`, [report.form_version_id]);
    for (const field of required) {
      if (![...effective.values()].some((row) => row.element_identity_id === field.identity_id)) {
        throw new UnprocessableEntityException(`Required form field ${field.stable_key} has no effective value`);
      }
    }
  }

  private async appendAudit(
    manager: EntityManager,
    reportId: string,
    command: AmendReportCommand,
    amendmentId: string,
    sequence: number,
    canonicalSha256: string,
    signedAt: string,
    changes: StoredChange[]
  ): Promise<void> {
    const prior = await manager.query<Array<{ report_sequence: string | number; event_hash: string }>>(`select
      report_sequence, event_hash from clinical_audit.event where report_id = $1
      order by report_sequence desc limit 1`, [reportId]);
    const reportSequence = prior[0] ? Number(prior[0].report_sequence) + 1 : 1;
    const previousHash = prior[0]?.event_hash ?? null;
    const nextValue = { amendmentId, amendmentSequence: sequence, canonicalSha256, reason: command.reason, changes };
    const eventHash = commandSha256({
      reportId, reportSequence, actorId: command.authorId, actorPersona: command.actorPersona ?? null,
      sessionId: command.sessionId ?? null, deviceId: command.deviceId ?? null,
      clientTime: command.clientTime ?? null, serverTime: signedAt, action: "amend",
      targetType: "amendment", targetId: amendmentId,
      priorValue: { effectiveAmendmentSequence: sequence - 1 }, newValue: nextValue, previousHash
    });
    await manager.query(`insert into clinical_audit.event
      (report_id, report_sequence, actor_id, actor_persona, session_id, device_id, client_time,
       server_time, action, target_type, target_id, prior_value, new_value, previous_hash, event_hash)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'amend', 'amendment', $9, $10::jsonb, $11::jsonb, $12, $13)`,
    [reportId, reportSequence, command.authorId, command.actorPersona ?? null, command.sessionId ?? null,
      command.deviceId ?? null, command.clientTime ?? null, signedAt, amendmentId,
      JSON.stringify({ effectiveAmendmentSequence: sequence - 1 }), JSON.stringify(nextValue), previousHash, eventHash]);
  }

  private async replay(manager: EntityManager, commandId: string, digest: string, reportId: string): Promise<AmendedReportResult | null> {
    const rows = await manager.query<ReceiptRow[]>(
      "select * from clinical.command_receipt where idempotency_key = $1", [commandId]);
    const receipt = rows[0];
    if (!receipt) return null;
    if (receipt.command_type !== "amend-report" || receipt.request_sha256 !== digest || receipt.report_id !== reportId) {
      throw new ConflictException("The command identity was already used with different content");
    }
    return receipt.response_body as AmendedReportResult;
  }

  private rethrowDatabaseConflict(error: unknown): never {
    if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
    if (typeof error === "object" && error !== null && "code" in error &&
        ["23503", "23505", "23514", "23P01", "40001", "40P01"].includes(String(error.code))) {
      throw new ConflictException("The amendment command conflicts with existing clinical data");
    }
    throw error;
  }
}
