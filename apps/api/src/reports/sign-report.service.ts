import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { compiledValidationBundleSha256, evaluateValidationBundleSafely, type CompiledValidationBundle } from "@open-triage/contracts";
import {
  evaluateQualityAndNormalization,
  NORMALIZATION_RULE_VERSION,
  QUALITY_RULE_VERSION
} from "@open-triage/contracts/quality-rules";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { encounterDocument } from "./encounter-document.persistence.js";
import { commandSha256 } from "./draft-report.validation.js";
import { customCodedValueFindings } from "./custom-coded-validation.js";
import { lockAndValidateReportNotes, type SignedNoteManifestEntry } from "./sign-report-notes.js";
import type {
  SignedReportResult,
  SigningFinding,
  SignReportCommand,
  WarningAcknowledgement
} from "./sign-report.types.js";
import { SignReportValidationError, validateSignReportCommand } from "./sign-report.validation.js";

type ReceiptRow = {
  report_id: string | null;
  command_type: string;
  request_sha256: string;
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
  validation_version_id: string | null;
  validation_compiled_sha256: string | null;
  documenting_user_id: string;
  reporting_date: string | null;
  report_media_allowance_bytes: string | number;
  image_media_limit_bytes: string | number;
};

type FieldRow = {
  id: string;
  stable_key: string;
  element_id?: string | null;
  required: boolean;
  clinically_stored: boolean;
  catalog_element_identity_id: string | null;
  custom_element_definition_id: string | null;
  min_occurs: number | null;
  agency_required: boolean | null;
  agency_required_severity: "warning" | "error" | null;
};

type RuleRow = {
  target_field_id: string;
  target_key: string;
  rule_kind: "visibility" | "requiredness";
  expression: RuleExpression;
};

type RuleExpression =
  | { operator: "exists"; field: string }
  | { operator: "equals"; field: string; value: unknown }
  | { operator: "not"; condition: RuleExpression }
  | { operator: "and" | "or"; conditions: RuleExpression[] };

type OccurrenceRow = {
  id: string;
  element_identity_id: string;
  element_id: string;
  form_field_id: string | null;
  group_instance_id: string | null;
  ordinal: number;
  value_kind: string;
  scalar_value: unknown;
  code: string | null;
  code_system: string | null;
  absence_code: string | null;
  base_datatype: string | null;
  min_occurs: number | null;
  max_occurs: number | null;
  text_constraints: { minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number } | null;
  custom_definition: import("@open-triage/contracts").CatalogDraftCustomElement | null;
  allowed_absence_states: string[] | null;
  not_value_code: string | null;
  pertinent_negative_code: string | null;
};

type SigningAttempt = { result?: SignedReportResult; findings?: SigningFinding[] };

type CodedValidationRow = {
  id: string;
  disabled_configured: boolean;
  disabled_inline: boolean;
  invalid_inline: boolean;
  exhaustive_value_set_ids: string | null;
};

const RULE_VERSION = "signing-1.0.0";
const SIGNING_TRANSACTION_ATTEMPTS = 3;

export function unresolvedDispatchConflictFindings(
  conflicts: ReadonlyArray<{ id: string; element_id: string }>
): SigningFinding[] {
  return conflicts.map((conflict) => ({
    severity: "error",
    code: "dispatch.unresolved-conflict",
    path: `dispatchConflicts.${conflict.id}`,
    message: `${conflict.element_id} has an unresolved dispatch difference`,
    ruleVersion: RULE_VERSION
  }));
}

export function validationFindingAcknowledgementId(finding: Pick<SigningFinding, "validationVersionId" | "ruleId" |
  "targetElementId" | "targetGroupInstanceId" | "targetOccurrenceId" | "inputFingerprint">): string | null {
  if (!finding.validationVersionId || !finding.ruleId || !finding.targetElementId || !finding.inputFingerprint) return null;
  return ["validation", finding.validationVersionId, finding.ruleId, finding.targetElementId,
    finding.targetGroupInstanceId ?? "root", finding.targetOccurrenceId ?? "none", finding.inputFingerprint]
    .map(encodeURIComponent).join(":");
}

export function acknowledgementMatchesFinding(acknowledgement: WarningAcknowledgement | undefined,
  finding: SigningFinding): boolean {
  return !!acknowledgement && acknowledgement.validationVersionId === finding.validationVersionId
    && acknowledgement.ruleId === finding.ruleId
    && acknowledgement.targetElementId === finding.targetElementId
    && (acknowledgement.targetGroupInstanceId ?? undefined) === (finding.targetGroupInstanceId ?? undefined)
    && (acknowledgement.targetOccurrenceId ?? undefined) === (finding.targetOccurrenceId ?? undefined)
    && acknowledgement.inputFingerprint === finding.inputFingerprint;
}

export function blockingSigningFindings(findings: readonly SigningFinding[],
  acknowledgements: SignReportCommand["warningAcknowledgements"] = {}): SigningFinding[] {
  return findings.filter((finding) => {
    if (finding.severity === "error") return true;
    if (finding.severity === "information") return false;
    const id = validationFindingAcknowledgementId(finding);
    const candidate = id === null ? undefined : acknowledgements?.[id];
    return id === null || candidate === true || !acknowledgementMatchesFinding(candidate, finding);
  });
}

@Injectable()
export class SignReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async sign(accessToken: string, reportId: string, input: unknown): Promise<SignedReportResult> {
    const session = await this.sessions.requireCapability(accessToken, "clinical:document");
    let command: SignReportCommand;
    try {
      command = validateSignReportCommand(input);
    } catch (error) {
      if (error instanceof SignReportValidationError) {
        throw new UnprocessableEntityException({ message: error.message, findings: error.findings });
      }
      throw error;
    }
    const digest = commandSha256(command);
    const evaluationTimestamp = new Date().toISOString();
    const signTransaction = () => this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await manager.query("select pg_advisory_xact_lock(hashtext($1))", [command.commandId]);
        const rows = await manager.query<ReportRow[]>(`
          select * from clinical.report
          where id = $1 and organization_id = $2 and documenting_user_id = $3
          for update
        `, [reportId, session.organization.id, session.user.id]);
        const report = rows[0];
        if (!report) throw new NotFoundException(`Report ${reportId} was not found`);
        if (command.signerId !== session.user.id) {
          throw new NotFoundException("The draft is not available to this clinician");
        }
        const replay = await this.replay(manager, command.commandId, digest, reportId);
        if (replay) return { result: replay };
        if (report.status !== "draft") throw new ConflictException("Report is already signed");
        const revision = Number(report.revision);
        if (revision !== command.expectedRevision) {
          throw new ConflictException({
            message: "Draft revision is stale",
            expectedRevision: command.expectedRevision,
            currentRevision: revision
          });
        }
        const signer = await manager.query<Array<{ id: string }>>(`
          select id from app_identity.app_user
          where id = $1 and organization_id = $2 and active
        `, [command.signerId, report.organization_id]);
        if (!signer[0]) throw new UnprocessableEntityException("signerId must be an active user in the report organization");
        if (command.signerId !== report.documenting_user_id) {
          throw new UnprocessableEntityException("Only the documenting clinician may sign the report");
        }

        const authored = await this.evaluateAuthoredRules(manager, report, evaluationTimestamp);
        const findings = await this.validateSemantics(manager, report);
        findings.push(...authored.findings);
        const unresolvedDispatch = await manager.query<Array<{ id: string; element_id: string }>>(`
          select id, element_id from clinical.dispatch_conflict
          where report_id = $1 and disposition is null order by created_at, id
        `, [report.id]);
        findings.push(...unresolvedDispatchConflictFindings(unresolvedDispatch));
        const noteIntegrity = await lockAndValidateReportNotes(manager, report);
        findings.push(...noteIntegrity.findings);
        await manager.query("delete from clinical.validation_finding where report_id = $1", [report.id]);
        if (findings.length) {
          await manager.query(`insert into clinical.validation_finding
            (report_id, revision, severity, code, path, message, rule_version,
             validation_version_id, validation_rule_id, execution_target, target_element_id,
             target_group_instance_id, target_occurrence_id, input_fingerprint, acknowledged_by, acknowledged_at)
            select $1, $2, incoming.severity, incoming.code, incoming.path,
                   incoming.message, incoming.rule_version, incoming.validation_version_id,
                   incoming.validation_rule_id, incoming.execution_target, incoming.target_element_id,
                   incoming.target_group_instance_id, incoming.target_occurrence_id, incoming.input_fingerprint,
                   incoming.acknowledged_by, case when incoming.acknowledged_by is null then null else $4::timestamptz end
            from jsonb_to_recordset($3::jsonb) as incoming(
              severity text, code text, path text, message text, rule_version text,
              validation_version_id uuid, validation_rule_id uuid, execution_target text,
              target_element_id text, target_group_instance_id uuid, target_occurrence_id uuid,
              input_fingerprint text, acknowledged_by uuid)`,
          [report.id, revision, JSON.stringify(findings.map((finding) => ({
            ...(() => {
              const id = validationFindingAcknowledgementId(finding);
              const candidate = id === null ? undefined : command.warningAcknowledgements?.[id];
              const acknowledged = finding.severity === "warning" && candidate !== true
                && acknowledgementMatchesFinding(candidate, finding);
              return { acknowledged_by: acknowledged ? command.signerId : null };
            })(),
            severity: finding.severity, code: finding.code, path: finding.path,
            message: finding.message, rule_version: finding.ruleVersion,
            validation_version_id: finding.validationVersionId ?? null,
            validation_rule_id: finding.ruleId ?? null,
            execution_target: finding.executionTarget ?? null,
            target_element_id: finding.targetElementId ?? null,
            target_group_instance_id: finding.targetGroupInstanceId ?? null,
            target_occurrence_id: finding.targetOccurrenceId ?? null,
            input_fingerprint: finding.inputFingerprint ?? null,
          }))), evaluationTimestamp]);
        }
        const blockingFindings = blockingSigningFindings(findings, command.warningAcknowledgements);
        if (blockingFindings.length) return { findings: blockingFindings };

        const payload = await this.canonicalPayload(manager, report, revision, noteIntegrity.notes);
        const quality = await this.evaluateQuality(manager, report.id);
        const canonicalSha256 = commandSha256(payload);
        const snapshotId = randomUUID();
        const signedAt = new Date().toISOString();
        const reporting = await this.reportingDate(manager, report, signedAt);

        await manager.query(`update clinical.report
          set status = 'signed', reporting_date = $2, reporting_date_source = $3, updated_at = $4
          where id = $1 and status = 'draft'`,
        [report.id, reporting.date, reporting.source, signedAt]);
        await manager.query(`insert into clinical.signed_snapshot
          (id, report_id, signed_revision, form_version_id, catalog_release_id, validation_version_id, signer_id,
           signed_at, canonical_sha256, attestation, warning_acknowledgements,
           quality_rule_version, normalization_rule_version, quality_findings, derived_values, integrity_manifest)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
                  $12, $13, $14::jsonb, $15::jsonb, $16::jsonb)`,
        [snapshotId, report.id, revision, report.form_version_id, report.catalog_release_id,
          report.validation_version_id, command.signerId, signedAt, canonicalSha256, JSON.stringify(command.attestation),
          JSON.stringify(command.warningAcknowledgements ?? {}), QUALITY_RULE_VERSION,
          NORMALIZATION_RULE_VERSION, JSON.stringify(quality.qualityFindings),
          JSON.stringify(quality.derivedValues), JSON.stringify(payload)]);

        await this.appendAudit(manager, report, command, snapshotId, canonicalSha256, signedAt);
        const result: SignedReportResult = {
          id: report.id,
          status: "signed",
          signedRevision: revision,
          signedSnapshotId: snapshotId,
          canonicalSha256,
          signerId: command.signerId,
          signedAt,
          formVersionId: report.form_version_id,
          catalogReleaseId: report.catalog_release_id,
          ...(report.validation_version_id ? { validationVersionId: report.validation_version_id } : {}),
          reportingDate: reporting.date,
          reportingDateSource: reporting.source,
          qualityRuleVersion: QUALITY_RULE_VERSION,
          normalizationRuleVersion: NORMALIZATION_RULE_VERSION,
          qualityFindings: quality.qualityFindings,
          derivedValues: quality.derivedValues
        };
        await manager.query(`insert into clinical.command_receipt
          (idempotency_key, report_id, command_type, request_sha256, response_status, response_body)
          values ($1, $2, 'sign-report', $3, 201, $4::jsonb)`,
        [command.commandId, report.id, digest, JSON.stringify(result)]);
        return { result };
    });
    let attempt: SigningAttempt | undefined;
    for (let transactionAttempt = 1; transactionAttempt <= SIGNING_TRANSACTION_ATTEMPTS; transactionAttempt += 1) {
      try {
        attempt = await signTransaction();
        break;
      } catch (error) {
        if (transactionAttempt < SIGNING_TRANSACTION_ATTEMPTS && this.retryableTransactionError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 25 * transactionAttempt));
          continue;
        }
        this.rethrowDatabaseConflict(error);
      }
    }
    if (!attempt) throw new ConflictException("The signing transaction could not be completed");
    if (attempt.findings) {
      throw new UnprocessableEntityException({ message: "Report validation failed", findings: attempt.findings });
    }
    return attempt.result!;
  }

  private async evaluateQuality(manager: EntityManager, reportId: string) {
    const rows = await manager.query<Array<{
      id: string;
      element_id: string;
      value_kind: string;
      value_integer: string | number | null;
      value_numeric: string | number | null;
      source_attributes: Record<string, unknown> | null;
    }>>(`select id, element_id, value_kind, value_integer, value_numeric, source_attributes
      from clinical.element_occurrence
      where report_id = $1 and tombstoned_at is null
      order by element_id, ordinal, id`, [reportId]);
    return evaluateQualityAndNormalization(rows.map((row) => ({
      id: row.id,
      elementId: row.element_id,
      valueKind: row.value_kind,
      valueInteger: row.value_integer,
      valueNumeric: row.value_numeric,
      sourceAttributes: row.source_attributes
    })));
  }

  private async validateAuthoredRules(manager: EntityManager, report: ReportRow,
    evaluationTimestamp = new Date().toISOString()): Promise<SigningFinding[]> {
    return (await this.evaluateAuthoredRules(manager, report, evaluationTimestamp)).findings;
  }

  private async evaluateAuthoredRules(manager: EntityManager, report: ReportRow,
    evaluationTimestamp: string): Promise<{ findings: SigningFinding[]; bundle?: CompiledValidationBundle }> {
    if (!report.validation_version_id) return { findings: [] };
    const versions = await manager.query<Array<{ compiled_bundle: CompiledValidationBundle; compiled_sha256: string }>>(`
      select compiled_bundle,compiled_sha256 from validation.version
      where id=$1 and organization_id=$2 and catalog_release_id=$3 and status='published'
    `, [report.validation_version_id, report.organization_id, report.catalog_release_id]);
    if (!versions[0]) return { findings: [{ severity: "error", code: "validation.runtime-unavailable",
      path: "$.validationVersionId", message: "The pinned validation bundle is unavailable",
      ruleVersion: report.validation_version_id, validationVersionId: report.validation_version_id,
      executionTarget: "sign" }] };
    if (!report.validation_compiled_sha256 || versions[0].compiled_sha256 !== report.validation_compiled_sha256
      || compiledValidationBundleSha256(versions[0].compiled_bundle) !== report.validation_compiled_sha256) {
      return { findings: [{ severity: "error", code: "validation.integrity", path: "$.validationVersionId",
        message: "The pinned validation bundle failed its integrity check",
        ruleVersion: report.validation_version_id, validationVersionId: report.validation_version_id,
        ruleId: "bundle", executionTarget: "sign" }] };
    }
    const document = await encounterDocument(manager, report.id);
    const settings = await manager.query<Array<{ language: string }>>(`
      select language from app_identity.agency_settings where organization_id=$1
    `, [report.organization_id]);
    const evaluated = evaluateValidationBundleSafely(versions[0].compiled_bundle, document, "sign",
      { timestamp: evaluationTimestamp, language: settings[0]?.language ?? "en" });
    return { bundle: versions[0].compiled_bundle, findings: [...evaluated.findings.map((finding) => ({
      severity: finding.severity,
      code: "validation.required-element",
      path: finding.primaryTarget.occurrenceId ? `$.occurrences.${finding.primaryTarget.occurrenceId}`
        : finding.primaryTarget.groupInstanceId ? `$.groups.${finding.primaryTarget.groupInstanceId}.elements.${finding.primaryTarget.elementId}`
          : `$.elements.${finding.primaryTarget.elementId}`,
      message: finding.message,
      ruleVersion: finding.validationVersionId,
      validationVersionId: finding.validationVersionId,
      ruleId: finding.ruleId,
      executionTarget: finding.executionTarget,
      targetElementId: finding.primaryTarget.elementId,
      targetGroupInstanceId: finding.primaryTarget.groupInstanceId,
      targetOccurrenceId: finding.primaryTarget.occurrenceId,
      inputFingerprint: finding.inputFingerprint,
    } satisfies SigningFinding)), ...evaluated.failures.map((failure) => ({
      severity: "error" as const, code: `validation.${failure.code}`, path: `$.validationRules.${failure.ruleId}`,
      message: `${failure.message} (rule ${failure.ruleId})`, ruleVersion: failure.validationVersionId,
      validationVersionId: failure.validationVersionId, ruleId: failure.ruleId, executionTarget: "sign" as const,
    }))] };
  }

  private async validateSemantics(manager: EntityManager, report: ReportRow): Promise<SigningFinding[]> {
    const findings: SigningFinding[] = [];
    const form = await manager.query<Array<{ status: string; catalog_release_id: string;
      canonical_definition: import("@open-triage/contracts").FormDraftDefinition }>>(`
      select status, catalog_release_id, canonical_definition from forms.form_version where id = $1
    `, [report.form_version_id]);
    if (!form[0] || form[0].status !== "published" || form[0].catalog_release_id !== report.catalog_release_id) {
      findings.push(this.finding("catalog.pinned-version", "$.formVersionId",
        "The report does not reference a published form and matching catalog release"));
      return findings;
    }
    const fields = await manager.query<FieldRow[]>(`select ff.id, ff.stable_key, ff.required,
      coalesce(e.element_id, ced.namespace || '.' || ced.slug) as element_id,
      (ff.custom_element_definition_id is not null or m.element_id is not null) as clinically_stored,
      ff.catalog_element_identity_id, ff.custom_element_definition_id,
      case when e.agency_required is true then 0
        when ced.definition->>'usage' in ('Mandatory','Required') then 1
        when e.usage in ('Mandatory','Required') then greatest(e.min_occurs, 1)
        else e.min_occurs end as min_occurs,
      e.agency_required, e.agency_required_severity
      from forms.form_field ff
      left join catalog.element_definition e on e.release_id = $2
        and e.element_identity_id = ff.catalog_element_identity_id
      left join catalog.analytics_element_mapping m on m.release_id = e.release_id
        and m.element_id = e.element_id
      left join forms.custom_element_definition ced on ced.id=ff.custom_element_definition_id
      where ff.form_version_id = $1 order by ff.stable_key`, [report.form_version_id, report.catalog_release_id]);
    const rules = await manager.query<RuleRow[]>(`select r.target_field_id, f.stable_key as target_key,
      r.rule_kind, r.expression
      from forms.form_rule r join forms.form_field f on f.id = r.target_field_id
      where r.form_version_id = $1 order by f.stable_key, r.position`, [report.form_version_id]);
    const occurrences = await manager.query<OccurrenceRow[]>(`select o.id, o.element_identity_id, o.element_id,
      o.form_field_id, o.group_instance_id, o.ordinal, o.value_kind,
      case o.value_kind
        when 'text' then to_jsonb(o.value_text) when 'uri' then to_jsonb(o.value_text)
        when 'integer' then to_jsonb(o.value_integer) when 'numeric' then to_jsonb(o.value_numeric)
        when 'boolean' then to_jsonb(o.value_boolean) when 'date' then to_jsonb(o.value_date)
        when 'datetime' then to_jsonb(o.value_datetime) when 'time' then to_jsonb(o.value_time)
        when 'duration' then to_jsonb(o.value_duration) else null end as scalar_value,
      o.code, o.code_system, o.absence_code, o.not_value_code, o.pertinent_negative_code,
      coalesce(e.base_datatype, ced.base_datatype) as base_datatype,
      e.min_occurs, coalesce(e.max_occurs,
        case when ced.definition->>'recurrence' = 'single' then 1 else null end) as max_occurs,
      ced.definition->'constraints' as text_constraints,
      ced.definition as custom_definition, ff.allowed_absence_states
      from clinical.element_occurrence o
      left join catalog.element_definition e on e.release_id = o.catalog_release_id and e.element_id = o.element_id
      left join forms.custom_element_definition ced on ced.id = o.element_identity_id
      left join forms.form_field ff on ff.id=o.form_field_id
      where o.report_id = $1 and o.tombstoned_at is null order by o.element_id, o.ordinal, o.id`, [report.id]);

    const choicePolicies = new Map(form[0].canonical_definition.sections.flatMap((section) => section.fields.flatMap((field) =>
      field.choicePolicy !== undefined
        ? [[field.source.kind === "nemsis" ? field.source.elementId : field.source.elementDefinitionId,
          field.choicePolicy] as const] : [])));
    for (const occurrence of occurrences) {
      const policy = choicePolicies.get(occurrence.custom_definition ? occurrence.element_identity_id : occurrence.element_id);
      if (occurrence.custom_definition?.datatype === "coded") {
        const customFindings = customCodedValueFindings(occurrence.custom_definition, {
          kind: occurrence.value_kind, code: occurrence.code, codeSystem: occurrence.code_system,
          absenceCode: occurrence.absence_code,
          notValue: occurrence.not_value_code ? { code: occurrence.not_value_code } : undefined,
          pertinentNegative: occurrence.pertinent_negative_code ? { code: occurrence.pertinent_negative_code } : undefined,
        }, policy, occurrence.allowed_absence_states ?? []);
        for (const message of customFindings) findings.push(this.finding("catalog.custom-code", `$.occurrences.${occurrence.id}`, message));
        continue;
      }
      if (!policy) continue;
      if (occurrence.value_kind === "coded" && !policy.some((choice) => choice.kind === "code" &&
        choice.code === occurrence.code && choice.codeSystem === (occurrence.code_system ?? ""))) {
        findings.push(this.finding("form.choice-disabled", `$.occurrences.${occurrence.id}.code`,
          `Code ${occurrence.code} is not enabled for this form field`));
      }
      if (occurrence.value_kind === "null" && occurrence.absence_code &&
        !policy.some((choice) => choice.kind === "not-value" && choice.code === occurrence.absence_code)) {
        findings.push(this.finding("form.not-value-disabled", `$.occurrences.${occurrence.id}.absenceCode`,
          `NOT value ${occurrence.absence_code} is not enabled for this form field`));
      }
    }

    const byField = new Map(fields.map((field) => [field.stable_key,
      occurrences.filter((item) => item.form_field_id === field.id ||
        (!item.form_field_id && item.element_identity_id === (field.catalog_element_identity_id ?? field.custom_element_definition_id)))]));
    for (const rule of rules) {
      const applies = this.evaluateRule(rule.expression, byField);
      const target = byField.get(rule.target_key) ?? [];
      if (rule.rule_kind === "visibility" && !applies && target.length > 0) {
        findings.push(this.finding("form.conditional-hidden", `$.fields.${rule.target_key}`,
          `Field ${rule.target_key} has a value while its visibility condition is false`));
      }
    }

    const expectedKinds: Record<string, string> = {
      string: "text", integer: "integer", decimal: "numeric", boolean: "boolean", date: "date",
      dateTime: "datetime", time: "time", duration: "duration", binary: "binary", anyURI: "uri"
    };
    for (const occurrence of occurrences) {
      const path = `$.occurrences.${occurrence.id}`;
      if (!occurrence.base_datatype) {
        findings.push(this.finding("catalog.element", path,
          `${occurrence.element_id} is not defined by the report's pinned catalog`));
        continue;
      }
      if (!["coded", "null", "pertinent-negative", "absent"].includes(occurrence.value_kind) &&
          expectedKinds[occurrence.base_datatype] !== occurrence.value_kind) {
        findings.push(this.finding("catalog.datatype", `${path}.value`,
          `${occurrence.element_id} requires ${occurrence.base_datatype}, not ${occurrence.value_kind}`));
      }
      if (occurrence.value_kind === "text" && occurrence.text_constraints && typeof occurrence.scalar_value === "string") {
        const limits = occurrence.text_constraints;
        if (occurrence.scalar_value.length > 100000 || limits.minLength !== undefined && occurrence.scalar_value.length < limits.minLength ||
            limits.maxLength !== undefined && occurrence.scalar_value.length > limits.maxLength ||
            limits.pattern && !new RegExp(`^(?:${limits.pattern})$`).test(occurrence.scalar_value))
          findings.push(this.finding("catalog.text-constraint", `${path}.value`,
            `${occurrence.element_id} does not satisfy its published text constraints`));
      }
      if (occurrence.value_kind === "numeric" && occurrence.text_constraints) {
        const bounds = occurrence.text_constraints;
        const numeric = Number(occurrence.scalar_value);
        if (!Number.isFinite(numeric) || bounds.minimum !== undefined && numeric < bounds.minimum ||
            bounds.maximum !== undefined && numeric > bounds.maximum)
          findings.push(this.finding("catalog.numeric-bounds", `${path}.value`,
            `${occurrence.element_id} does not satisfy its published numeric bounds`));
      }
    }
    const codedOccurrences = occurrences.filter((occurrence) => occurrence.value_kind === "coded");
    if (codedOccurrences.length) {
      const codedValidation = await manager.query<CodedValidationRow[]>(`
        with incoming as (
          select * from jsonb_to_recordset($2::jsonb) as item(
            id uuid, element_id text, code text, code_system text, form_policy boolean)
        )
        select incoming.id,
          exists (
            select 1 from catalog.value_set_element mapped
            join catalog.value_set_option_configuration configured
              on configured.release_id = mapped.release_id
              and configured.value_set_id = mapped.value_set_id
            where mapped.release_id = $1 and mapped.element_id = incoming.element_id
              and not configured.enabled and configured.code = incoming.code
              and configured.code_system = coalesce(incoming.code_system, '')
          ) as disabled_configured,
          exists (
            select 1 from catalog.element_option_configuration configured
            where configured.release_id = $1 and configured.element_id = incoming.element_id
              and configured.source_kind = 'inline' and configured.code = incoming.code
              and configured.code_system = coalesce(incoming.code_system, '') and not configured.enabled
          ) as disabled_inline,
          exists (
            select 1 from catalog.element_definition e
            where e.release_id = $1 and e.element_id = incoming.element_id
              and e.definition #>> '{valueSource,kind}' = 'inline-enumerated'
              and (e.definition #>> '{valueSource,exhaustive}')::boolean
              and not exists (
                select 1 from catalog.element_option option
                where option.release_id = e.release_id and option.element_id = e.element_id
                  and option.source_kind = 'inline' and option.code = incoming.code
                  and option.code_system = coalesce(incoming.code_system, '')
              )
          ) as invalid_inline,
          (
            select string_agg(vse.value_set_id, ', ' order by vse.value_set_id)
            from catalog.value_set_element vse
            join catalog.value_set vs on vs.release_id = vse.release_id
              and vs.value_set_id = vse.value_set_id
            where vse.release_id = $1 and vse.element_id = incoming.element_id and vs.exhaustive
              and not exists (
                select 1 from catalog.value_set_element valid_element
                join catalog.value_set valid_set on valid_set.release_id = valid_element.release_id
                  and valid_set.value_set_id = valid_element.value_set_id and valid_set.exhaustive
                join catalog.value_set_option option on option.release_id = valid_element.release_id
                  and option.value_set_id = valid_element.value_set_id
                left join catalog.value_set_option_configuration configured
                  on configured.release_id = option.release_id
                  and configured.value_set_id = option.value_set_id
                  and configured.code_system = option.code_system and configured.code = option.code
                where valid_element.release_id = vse.release_id
                  and valid_element.element_id = vse.element_id and option.code = incoming.code
                  and option.code_system = coalesce(incoming.code_system, '')
                  and (incoming.form_policy or coalesce(configured.enabled, true))
              )
          ) as exhaustive_value_set_ids
        from incoming
      `, [report.catalog_release_id, JSON.stringify(codedOccurrences.map((occurrence) => ({
        id: occurrence.id, element_id: occurrence.element_id,
        code: occurrence.code, code_system: occurrence.code_system,
        form_policy: choicePolicies.has(occurrence.element_id),
      })))]);
      const validationById = new Map(codedValidation.map((row) => [row.id, row]));
      for (const occurrence of codedOccurrences) {
        const validation = validationById.get(occurrence.id);
        const path = `$.occurrences.${occurrence.id}.code`;
        if (validation?.disabled_configured && !choicePolicies.has(occurrence.element_id)) {
          findings.push(this.finding("catalog.value-set-disabled", path,
            `Code ${occurrence.code} is disabled by the pinned catalog for ${occurrence.element_id}`));
        }
        if (validation?.disabled_inline && !choicePolicies.has(occurrence.element_id)) {
          findings.push(this.finding("catalog.value-set-disabled", path,
            `Code ${occurrence.code} is disabled by the pinned catalog for ${occurrence.element_id}`));
        }
        if (validation?.invalid_inline) findings.push(this.finding("catalog.value-set", path,
          `Code ${occurrence.code} is not in the exhaustive inline value set for ${occurrence.element_id}`));
        if (validation?.exhaustive_value_set_ids) findings.push(this.finding("catalog.value-set", path,
          `Code ${occurrence.code} is not in exhaustive value set(s) ${validation.exhaustive_value_set_ids} for ${occurrence.element_id}`));
      }
    }
    return findings;
  }

  private evaluateRule(expression: RuleExpression, values: Map<string, OccurrenceRow[]>): boolean {
    switch (expression.operator) {
      case "exists": return (values.get(expression.field)?.length ?? 0) > 0;
      case "equals": {
        const occurrences = values.get(expression.field) ?? [];
        return occurrences.some((item) => {
          const actual = item.value_kind === "coded" ? item.code
            : ["null", "pertinent-negative", "absent"].includes(item.value_kind) ? item.absence_code ?? null
              : item.scalar_value;
          return String(actual) === String(expression.value);
        });
      }
      case "not": return !this.evaluateRule(expression.condition, values);
      case "and": return expression.conditions.every((item) => this.evaluateRule(item, values));
      case "or": return expression.conditions.some((item) => this.evaluateRule(item, values));
    }
  }

  private async canonicalPayload(manager: EntityManager, report: ReportRow, revision: number,
    notes: ReadonlyArray<SignedNoteManifestEntry> = []): Promise<unknown> {
    const content = await manager.query<Array<{ groups: unknown; occurrences: unknown }>>(`select
      coalesce((select jsonb_agg(to_jsonb(g) order by g.group_id, g.ordinal, g.id) from (
        select id, parent_group_instance_id, group_id, source_kind, custom_group_definition_id,
               ordinal, correlation_id, documented_time, documented_utc_offset_minutes
        from clinical.group_instance where report_id = $1 and tombstoned_at is null
      ) g), '[]'::jsonb) as groups,
      coalesce((select jsonb_agg(to_jsonb(o) order by o.element_id, o.ordinal, o.id) from (
        select id, group_instance_id, element_identity_id, element_id, form_field_id, ordinal,
               value_kind, value_text, value_integer, value_numeric, value_boolean, value_date,
               value_datetime, value_time, value_duration, encode(value_binary, 'base64') as value_binary,
               value_lexical, value_utc_offset_minutes, value_precision, code, code_system, code_display,
               terminology_version, absence_code, absence_display, source_attributes, correlation_id,
               provenance_kind, provenance_detail, documented_time, documented_utc_offset_minutes,
               documented_precision, author_id
        from clinical.element_occurrence where report_id = $1 and tombstoned_at is null
      ) o), '[]'::jsonb) as occurrences`, [report.id]);
    return {
      schemaVersion: 1,
      report: {
        id: report.id,
        organizationId: report.organization_id,
        incidentId: report.incident_id,
        patientId: report.patient_id,
        agencyDemographicVersionId: report.agency_demographic_version_id,
        formVersionId: report.form_version_id,
        catalogReleaseId: report.catalog_release_id,
        documentingUserId: report.documenting_user_id,
        revision
      },
      groups: content[0]!.groups,
      occurrences: content[0]!.occurrences,
      notes,
    };
  }

  private async reportingDate(
    manager: EntityManager,
    report: ReportRow,
    signedAt: string
  ): Promise<{ date: string; source: SignedReportResult["reportingDateSource"] }> {
    const rows = await manager.query<Array<{ clinical_date: string | null; server_date: string | null }>>(`select
      ((min(value_datetime) filter (
        where element_id ~ '^eTimes[.][0-9]{2}$' and value_kind = 'datetime'
          and isfinite(value_datetime) and absence_code is null
          and not_value_code is null and pertinent_negative_code is null
      )) at time zone 'UTC')::date::text as clinical_date,
      min((server_received_time at time zone 'UTC')::date)::text as server_date
      from clinical.element_occurrence where report_id = $1 and tombstoned_at is null`, [report.id]);
    if (rows[0]?.clinical_date) return { date: rows[0].clinical_date, source: "earliest-clinical-time" };
    if (report.reporting_date) return { date: report.reporting_date, source: "service-date" };
    if (rows[0]?.server_date) return { date: rows[0].server_date, source: "earliest-server-time" };
    return { date: signedAt.slice(0, 10), source: "signing-time" };
  }

  private async appendAudit(
    manager: EntityManager,
    report: ReportRow,
    command: SignReportCommand,
    snapshotId: string,
    canonicalSha256: string,
    signedAt: string
  ): Promise<void> {
    const prior = await manager.query<Array<{ report_sequence: string | number; event_hash: string }>>(`
      select report_sequence, event_hash from clinical_audit.event
      where report_id = $1 order by report_sequence desc limit 1`, [report.id]);
    const sequence = prior[0] ? Number(prior[0].report_sequence) + 1 : 1;
    const previousHash = prior[0]?.event_hash ?? null;
    const nextValue = { snapshotId, signedRevision: Number(report.revision), canonicalSha256 };
    const eventHash = commandSha256({
      reportId: report.id, reportSequence: sequence, actorId: command.signerId,
      actorPersona: command.actorPersona ?? null, sessionId: command.sessionId ?? null,
      deviceId: command.deviceId ?? null, clientTime: command.clientTime ?? null,
      serverTime: signedAt, action: "sign", targetType: "signed_snapshot", targetId: snapshotId,
      priorValue: { status: "draft", revision: Number(report.revision) }, newValue: nextValue, previousHash
    });
    await manager.query(`insert into clinical_audit.event
      (report_id, report_sequence, actor_id, actor_persona, session_id, device_id, client_time,
       server_time, action, target_type, target_id, prior_value, new_value, previous_hash, event_hash)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'sign', 'signed_snapshot', $9,
              $10::jsonb, $11::jsonb, $12, $13)`,
    [report.id, sequence, command.signerId, command.actorPersona ?? null, command.sessionId ?? null,
      command.deviceId ?? null, command.clientTime ?? null, signedAt, snapshotId,
      JSON.stringify({ status: "draft", revision: Number(report.revision) }), JSON.stringify(nextValue),
      previousHash, eventHash]);
  }

  private finding(code: string, path: string, message: string,
    severity: SigningFinding["severity"] = "error"): SigningFinding {
    return { severity, code, path, message, ruleVersion: RULE_VERSION };
  }

  private async replay(
    manager: EntityManager,
    commandId: string,
    digest: string,
    reportId: string
  ): Promise<SignedReportResult | null> {
    const rows = await manager.query<ReceiptRow[]>(
      "select * from clinical.command_receipt where idempotency_key = $1", [commandId]);
    const receipt = rows[0];
    if (!receipt) return null;
    if (receipt.command_type !== "sign-report" || receipt.request_sha256 !== digest || receipt.report_id !== reportId) {
      throw new ConflictException("The command identity was already used with different content");
    }
    return receipt.response_body as SignedReportResult;
  }

  private rethrowDatabaseConflict(error: unknown): never {
    if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
    if (typeof error === "object" && error !== null && "code" in error &&
        ["23503", "23505", "23514", "23P01", "40001", "40P01"].includes(String(error.code))) {
      throw new ConflictException("The signing command conflicts with existing clinical data");
    }
    throw error;
  }

  private retryableTransactionError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as { code?: unknown; driverError?: { code?: unknown } };
    const code = candidate.driverError?.code ?? candidate.code;
    return code === "40001" || code === "40P01";
  }
}
