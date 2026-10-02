import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AddReviewCommentCommand, AssignReviewItemCommand, ClaimReviewItemCommand, CloseReviewOverdueCommand, ReviewOverdueExceptionCode, ConfigureReviewRouteCommand, ReviewCriterionRoute, ReviewEligibleReviewer, ReviewItemDetail, ReviewProgressCommand, ReviewOutcomeCommand, ReviewOutcomeOption, ReviewOverdueDraft, ReviewSignedReport, ReviewSignedReportsResponse, ReviewReportValue, ReviewVolumeResult, ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult, ReviewRetrospectiveDefinition, ReviewRetrospectivePreview, ReviewRetrospectiveRun, ReviewRetrospectiveVersion, StartReviewRetrospectiveCommand, ConfigureReviewAmendmentPolicyCommand, ReviewAmendmentPolicy } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { mutationRows } from "../database/mutation-result.js";
import { reportTextNotes } from "../reports/report-note.persistence.js";
import { recordMediaAccess } from "../reports/report-note-collaboration.js";
import { reviewScope } from "./review-scope.js";
import type { ReviewScope } from "./review-scope.js";
import { reviewFields, repeatedReviewFields, operationalTimeFields } from "./review-fields.js";
import { reduceRepeated, type RepeatedRow } from "./review-repeated.js";
import { eligibleReviewer, eligibleReviewers } from "./review-assignment.js";
import { reduceCustom, type CustomOccurrenceRow, type CustomReportRow } from "./review-custom.js";
import { loadRetrospectivePopulation, previewRetrospective, requireRetrospectiveAdmin,
  retrospectiveRunStatus, retrospectiveVersions, validateRetrospectiveDefinition } from "./review-retrospective.js";
import { processReviewWork } from "./review-worker.js";

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new BadRequestException("Invalid Review pagination");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new BadRequestException("Invalid Review pagination");
  return number;
}

function validDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function reviewOutcome(row: { outcome_option_id: string | null; outcome_revision: number | null;
  outcome_label: string | null; outcome_meaning: string | null }): ReviewItemDetail["outcome"] {
  return row.outcome_option_id && row.outcome_revision !== null ? {
    optionId: row.outcome_option_id, revision: Number(row.outcome_revision),
    label: row.outcome_label ?? "", meaning: row.outcome_meaning ?? "",
  } : null;
}

@Injectable()
export class ReviewService implements OnModuleDestroy {
  private reportingInitialization?: Promise<DataSource>;
  constructor(@InjectDataSource() private readonly database: DataSource,
    private readonly sessions: ClinicianSessionService) {}

  async onModuleDestroy(): Promise<void> {
    if (this.reportingInitialization) {
      const replica = await this.reportingInitialization.catch(() => null);
      if (replica?.isInitialized) await replica.destroy();
    }
  }

  private async analyticsDatabase(): Promise<DataSource> {
    const url = process.env.REVIEW_REPORTING_REPLICA_DATABASE_URL;
    if (!url) return this.database;
    if (!this.reportingInitialization) {
      const reportingDatabase = new DataSource({ type: "postgres", url, synchronize: false,
        extra: { max: 5, statement_timeout: 10000 } });
      this.reportingInitialization = reportingDatabase.initialize().catch((error: unknown) => {
        this.reportingInitialization = undefined;
        throw error;
      });
    }
    return this.reportingInitialization;
  }

  async retrospectiveVersions(token: string): Promise<ReviewRetrospectiveVersion[]> {
    return retrospectiveVersions(this.database.manager, reviewScope(await this.sessions.get(token)));
  }

  async retrospectivePreview(token: string, definition: ReviewRetrospectiveDefinition): Promise<ReviewRetrospectivePreview> {
    const scope = reviewScope(await this.sessions.get(token));
    return (await previewRetrospective(this.database.manager, scope, definition)).preview;
  }

  async retrospectiveRuns(token: string): Promise<ReviewRetrospectiveRun[]> {
    const scope = reviewScope(await this.sessions.get(token));
    requireRetrospectiveAdmin(scope);
    const rows = await this.database.query<Array<{ id: string }>>(`
      select id from clinical.review_retrospective_run where organization_id=$1
      order by created_at desc,id desc limit 25`, [scope.organizationId]);
    return Promise.all(rows.map((row) => retrospectiveRunStatus(this.database.manager, scope, row.id)));
  }

  async retrospectiveRun(token: string, id: string): Promise<ReviewRetrospectiveRun> {
    return retrospectiveRunStatus(this.database.manager, reviewScope(await this.sessions.get(token)), id);
  }

  async startRetrospective(token: string, command: StartReviewRetrospectiveCommand,
    csrfToken?: string): Promise<ReviewRetrospectiveRun> {
    if (!command || !uuid(command.commandId) || typeof command.expectedRevision !== "string" ||
      !/^[0-9a-f]{64}$/.test(command.expectedRevision))
      throw new BadRequestException("Invalid retrospective Review command");
    validateRetrospectiveDefinition(command.definition);
    await this.sessions.assertCsrf(token, csrfToken);
    const scope = reviewScope(await this.sessions.get(token));
    requireRetrospectiveAdmin(scope);
    const prior = (await this.database.query<Array<{ id: string; actor_id: string;
      criterion_id: string; validation_version_id: string; dataset: string;
      date_from: string; date_to: string; preview_hash: string }>>(`
      select id,actor_id,criterion_id,validation_version_id,dataset,date_from::text,date_to::text,preview_hash
      from clinical.review_retrospective_run where organization_id=$1 and command_id=$2`,
    [scope.organizationId, command.commandId]))[0];
    if (prior) {
      if (prior.actor_id !== scope.userId || prior.criterion_id !== command.definition.criterionId ||
        prior.validation_version_id !== command.definition.validationVersionId ||
        prior.dataset !== command.definition.dataset || prior.date_from !== command.definition.from ||
        prior.date_to !== command.definition.to || prior.preview_hash !== command.expectedRevision)
        throw new ConflictException("Retrospective Review command has already been used");
      return retrospectiveRunStatus(this.database.manager, scope, prior.id);
    }
    const { preview, candidates } = await previewRetrospective(this.database.manager, scope, command.definition);
    if (preview.revision !== command.expectedRevision)
      throw new ConflictException({ message: "Retrospective Review selection changed; preview again", preview });
    const runId = await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const current = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      requireRetrospectiveAdmin(current);
      await manager.query(`select pg_advisory_xact_lock(hashtextextended($1::text,0))`,
        [`review-retrospective:${current.organizationId}:${command.commandId}`]);
      const replay = (await manager.query<Array<{ id: string; actor_id: string; preview_hash: string }>>(`
        select id,actor_id,preview_hash from clinical.review_retrospective_run
        where organization_id=$1 and command_id=$2`, [current.organizationId, command.commandId]))[0];
      if (replay) {
        if (replay.actor_id !== current.userId || replay.preview_hash !== command.expectedRevision)
          throw new ConflictException("Retrospective Review command has already been used");
        return replay.id;
      }
      const currentPopulation = await loadRetrospectivePopulation(manager, current, command.definition);
      if (currentPopulation.sourceRevision !== preview.sourceRevision)
        throw new ConflictException("Retrospective Review population changed; preview again");
      const [inserted] = mutationRows<{ id: string }>(await manager.query(`
        insert into clinical.review_retrospective_run
          (organization_id,command_id,actor_id,criterion_id,validation_version_id,dataset,report_scope,
           date_from,date_to,preview_hash)
        values ($1,$2,$3,$4,$5,$6,'all',$7,$8,$9) returning id`,
      [current.organizationId, command.commandId, current.userId, command.definition.criterionId,
        command.definition.validationVersionId, command.definition.dataset, command.definition.from,
        command.definition.to, preview.revision]));
      if (!inserted) throw new Error("Retrospective Review run was not created");
      if (candidates.length) await manager.query(`
        insert into clinical.review_retrospective_report
          (run_id,report_id,organization_id,signed_snapshot_id,amendment_sequence,reporting_date,
           catalog_release_id,preview_outcome,preview_existing,failure_code)
        select $1::uuid,c.report_id,$2::uuid,c.signed_snapshot_id,c.amendment_sequence,
          c.reporting_date,c.catalog_release_id,c.outcome,c.existing,c.failure_code
        from jsonb_to_recordset($3::jsonb) as c(report_id uuid,signed_snapshot_id uuid,
          amendment_sequence integer,reporting_date date,catalog_release_id uuid,outcome text,
          existing boolean,failure_code text)`,
      [inserted.id, current.organizationId, JSON.stringify(candidates.map((candidate) => ({
        report_id: candidate.report_id, signed_snapshot_id: candidate.signed_snapshot_id,
        amendment_sequence: Number(candidate.amendment_sequence), reporting_date: candidate.reporting_date,
        catalog_release_id: candidate.catalog_release_id, outcome: candidate.outcome,
        existing: candidate.existing_item_version !== null, failure_code: candidate.failureCode })))]);
      return inserted.id;
    });
    return retrospectiveRunStatus(this.database.manager, scope, runId);
  }

  async advanceRetrospective(token: string, id: string, requestedBatch: number,
    csrfToken?: string): Promise<ReviewRetrospectiveRun> {
    if (!uuid(id) || !Number.isSafeInteger(requestedBatch) || requestedBatch < 1 || requestedBatch > 25)
      throw new BadRequestException("Invalid retrospective Review batch");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      requireRetrospectiveAdmin(scope);
      const [run] = await manager.query<Array<{ criterion_id: string; validation_version_id: string }>>(`
        select criterion_id,validation_version_id from clinical.review_retrospective_run
        where id=$1 and organization_id=$2`, [id, scope.organizationId]);
      if (!run) throw new NotFoundException("Retrospective Review run is unavailable");
      const reports = await manager.query<Array<{ report_id: string; signed_snapshot_id: string;
        amendment_sequence: number; work_id: string | null; state: string | null }>>(`
        select rr.report_id,rr.signed_snapshot_id,rr.amendment_sequence,rr.work_id,w.state
        from clinical.review_retrospective_report rr
        left join clinical.review_work w on w.id=rr.work_id
        where rr.run_id=$1 and rr.organization_id=$2 and rr.preview_outcome<>'incompatible'
          and (rr.work_id is null or w.state='failed')
        order by (rr.work_id is not null),rr.reporting_date,rr.report_id
        limit $3 for update of rr skip locked`,
      [id, scope.organizationId, requestedBatch]);
      for (const report of reports) {
        if (report.work_id) {
          await manager.query(`update clinical.review_work set next_attempt_at=now()
            where id=$1 and state='failed'`, [report.work_id]);
          continue;
        }
        const [inserted] = mutationRows<{ id: string }>(await manager.query(`
          insert into clinical.review_work (organization_id,report_id,signed_snapshot_id,
            amendment_sequence,validation_version_id,source_key,selected_criterion_id)
          values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
        [scope.organizationId, report.report_id, report.signed_snapshot_id,
          report.amendment_sequence, run.validation_version_id,
          `retrospective:${run.criterion_id}`, run.criterion_id]));
        const workId = inserted?.id ?? (await manager.query<Array<{ id: string }>>(`
          select id from clinical.review_work where report_id=$1 and signed_snapshot_id=$2
            and amendment_sequence=$3 and validation_version_id=$4 and source_key=$5`,
        [report.report_id, report.signed_snapshot_id, report.amendment_sequence,
          run.validation_version_id, `retrospective:${run.criterion_id}`]))[0]?.id;
        if (!workId) throw new Error("Retrospective Review work could not be recovered");
        await manager.query(`update clinical.review_retrospective_report set work_id=$3
          where run_id=$1 and report_id=$2 and organization_id=$4`,
        [id, report.report_id, workId, scope.organizationId]);
      }
    });
    await processReviewWork(this.database, requestedBatch, id);
    return this.retrospectiveRun(token, id);
  }

  async analysisFields(token: string): Promise<ReviewAnalysisField[]> {
    const scope = reviewScope(await this.sessions.get(token));
    const custom = await this.database.query<Array<{ custom_definition_id: string; title: string;
      datatype: string; recurrence: string; identifying: boolean; semantic_count: string;
      datatype_count: string;
      recurrence_count: string; privacy_count: string; grouped: boolean }>>(`
      select custom_definition_id, title, datatype, recurrence, identifying,
        semantic_count, datatype_count, recurrence_count, privacy_count, grouped
      from analytics.review_custom_dictionary
      where organization_id = $1::uuid and ($2::boolean or not identifying)
      order by title, custom_definition_id`, [scope.organizationId, scope.identifying]);
    return [...[...reviewFields, ...repeatedReviewFields, ...operationalTimeFields].map((field) => ({ ...field,
      operations: field.kind === "categorical" ? ["distribution" as const] :
        ["mean" as const, "median" as const, "minimum" as const, "maximum" as const] })),
    ...custom.map((row): ReviewAnalysisField => {
      const compatible = Number(row.semantic_count) === 1 && Number(row.datatype_count) === 1 &&
        Number(row.privacy_count) === 1 && Number(row.recurrence_count) === 1;
      const numeric = row.datatype === "number";
      const categorical = ["string", "coded", "boolean", "date", "dateTime"].includes(row.datatype);
      const operations: ReviewAnalysisField["operations"] = compatible && numeric
        ? ["mean", "median", "minimum", "maximum"] : compatible && categorical
          ? ["distribution"] : [];
      return { id: row.custom_definition_id, label: row.title, source: "custom",
        kind: numeric ? "numeric" : "categorical", unit: null,
        repeating: row.grouped || row.recurrence === "multiple", operations,
        ...(operations.length ? {} : { unsupportedReason: !compatible
          ? "Historical definitions differ" : "This value type has no supported chart operation" }) };
    })];
  }

  async analysis(token: string, input: ReviewAnalysisDefinition): Promise<ReviewAnalysisResult> {
    const scope = reviewScope(await this.sessions.get(token));
    if (!input || typeof input !== "object" || !input.filters || typeof input.filters !== "object")
      throw new BadRequestException("Invalid Review analysis definition");
    const { from, to, dataset } = input.filters;
    if (!validDate(from) || !validDate(to) || from > to ||
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 365 ||
      (dataset !== "real" && dataset !== "synthetic")) {
      throw new BadRequestException("Invalid Review analysis period or dataset");
    }
    const fields = await this.analysisFields(token);
    const field = fields.find((candidate) => candidate.id === input.fieldId);
    const groupField = input.groupBy ? fields.find((candidate) => candidate.id === input.groupBy) : undefined;
    const filter = input.filters.field;
    const filterField = filter ? fields.find((candidate) => candidate.id === filter.id) : undefined;
    if (!field || (input.groupBy && (!groupField || groupField.kind !== "categorical" ||
      !groupField.operations.includes("distribution"))) ||
      (filter && (!filterField || filterField.kind !== "categorical" ||
        !filterField.operations.includes("distribution") ||
        typeof filter.value !== "string" || !filter.value || filter.value.length > 256))) {
      throw new BadRequestException("Review field is not permitted");
    }
    if (!field.operations.includes(input.operation)) {
      throw new BadRequestException("Unsupported Review field operation");
    }
    if ("repeating" in field && field.repeating && field.kind === "numeric" &&
      !["first", "last", "minimum", "maximum"].includes(input.reducer ?? "")) {
      throw new BadRequestException("Repeated numeric field requires a per-report reducer");
    }
    if (input.reducer && (!("repeating" in field) || field.kind !== "numeric"))
      throw new BadRequestException("Reducer is only supported for repeated numeric fields");
    if (input.unit && (field.id !== "eMedications.05" || typeof input.unit !== "string" ||
      !/^[A-Za-z0-9.\[\]{}\/\-]{1,40}$/.test(input.unit)))
      throw new BadRequestException("Invalid Review analysis unit");
    if ((groupField?.source === "custom" || filterField?.source === "custom") && field.source !== "custom")
      throw new BadRequestException("Custom grouping and filtering require a custom measure");
    if (field.source === "custom" &&
      ((groupField?.repeating && groupField.source !== "custom") ||
        (filterField?.repeating && filterField.source !== "custom")))
      throw new BadRequestException("Repeated standard dimensions are unsupported for custom measures");
    const definition: ReviewAnalysisDefinition = { fieldId: field.id, operation: input.operation,
      ...(groupField ? { groupBy: groupField.id } : {}),
      ...(input.reducer ? { reducer: input.reducer } : {}),
      ...(input.unit ? { unit: input.unit } : {}),
      filters: { from, to, dataset, ...(filter ? { field: { id: filter.id, value: filter.value } } : {}) } };
    const database = await this.analyticsDatabase();
    const [health] = await database.query<Array<{
      observed_at: Date | string; oldest_backlog_age_seconds: string | number | null;
      persistent_failure_count: number; retrying_count: number; stale_run_count: number;
      last_run_status: string | null; is_read_only_replica: boolean; replay_lag_seconds: string | number | null;
    }>>(`select h.observed_at, h.oldest_backlog_age_seconds,
      h.persistent_failure_count, h.retrying_count, h.stale_run_count, h.last_run_status,
      r.is_read_only_replica, r.replay_lag_seconds
      from operations.projection_health h cross join operations.reporting_replica_health r`);
    if (!health) throw new Error("Projection health is unavailable");
    const backlog = health.oldest_backlog_age_seconds === null ? null : Number(health.oldest_backlog_age_seconds);
    const lag = health.replay_lag_seconds === null ? null : Number(health.replay_lag_seconds);
    const current = Number(health.persistent_failure_count) === 0 &&
      Number(health.retrying_count) === 0 && Number(health.stale_run_count) === 0 &&
      health.last_run_status !== "failed" && health.last_run_status !== "partial" &&
      (backlog === null || backlog <= 300) &&
      (!process.env.REVIEW_REPORTING_REPLICA_DATABASE_URL ||
        (health.is_read_only_replica && lag !== null && lag <= 300));
    const freshness = { observedAt: new Date(health.observed_at).toISOString(), targetSeconds: 300 as const,
      status: current ? "current" as const : "stale" as const,
      oldestBacklogSeconds: backlog, replicaLagSeconds: lag };
    const metadata: ReviewAnalysisField = { ...field };
    const population = { unit: "patient-report" as const, scope: scope.reports,
      organizationId: scope.organizationId, signedOnly: true as const };
    if (!current) return { definition, field: metadata, population, freshness, groups: [] };
    if (field.source !== "custom" && "repeating" in field && field.repeating) {
      const rows = await database.query<RepeatedRow[]>(`
        select source.report_id, source.field_values ->> $8::text as group_value,
          occurrence.element_occurrence_id as occurrence_id, occurrence.group_id,
          occurrence.group_instance_id, occurrence.parent_group_instance_id,
          occurrence.group_ordinal, occurrence.element_ordinal, occurrence.clinical_time,
          occurrence.documented_time, occurrence.code, occurrence.numeric_value,
          occurrence.unit_code, occurrence.absence_kind, occurrence.absence_code,
          occurrence.normalization_rule_id, occurrence.quality_flags
        from analytics.review_field_source_with_identity source
        left join analytics.review_repeated_field_source occurrence
          on occurrence.report_id = source.report_id and occurrence.reporting_date = source.reporting_date
          and occurrence.element_id = $7::text
        where source.reporting_date between $1::date and $2::date
          and source.organization_id = $3::uuid and source.synthetic = $4::boolean
          and ($5::boolean or source.documenting_user_id = $6::uuid)
          and ($9::text is null or ${filterField && "repeating" in filterField ?
            `exists (select 1 from analytics.review_repeated_field_source f
              where f.report_id = source.report_id and f.reporting_date = source.reporting_date
                and f.element_id = $9::text and f.code = $10::text)` :
            "source.field_values ->> $9::text = $10::text"})
        order by source.report_id, occurrence.group_ordinal, occurrence.element_ordinal,
          occurrence.element_occurrence_id limit 20001`,
      [from, to, scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId,
        field.id, groupField?.id ?? null, filterField?.id ?? null, filter?.value ?? null]);
      if (rows.length > 20000) throw new BadRequestException("Review analysis exceeds the repeated-value limit");
      const unit = field.id === "eMedications.05" ? input.unit ?? null : field.unit;
      if (field.id === "eMedications.05" && !unit)
        throw new BadRequestException("Select a medication dosage unit");
      const reduced = reduceRepeated(rows, definition, unit);
      return { definition, field: { ...metadata, unit }, population, freshness, ...reduced };
    }
    if (field.source === "custom") {
      const reportRows = await database.query<CustomReportRow[]>(`
        select source.report_id,
          case when $7::text is null then null else source.field_values ->> $7::text end
            as standard_group_value
        from analytics.review_field_source_with_identity source
        where source.reporting_date between $1::date and $2::date
          and source.organization_id=$3::uuid and source.synthetic=$4::boolean
          and ($5::boolean or source.documenting_user_id=$6::uuid)
          and ($8::text is null or source.field_values ->> $8::text = $9::text)
        order by source.report_id limit 20001`,
      [from, to, scope.organizationId, dataset === "synthetic", scope.reports === "all",
        scope.userId, groupField?.source === "custom" ? null : groupField?.id ?? null,
        filterField?.source === "custom" ? null : filterField?.id ?? null,
        filterField?.source === "custom" ? null : filter?.value ?? null]);
      if (reportRows.length > 20000) throw new BadRequestException("Review analysis exceeds the report limit");
      const ids = [...new Set([field, groupField, filterField]
        .filter((candidate): candidate is ReviewAnalysisField => candidate?.source === "custom")
        .map((candidate) => candidate.id))];
      const occurrences = await database.query<CustomOccurrenceRow[]>(`
        select c.report_id, c.element_occurrence_id as occurrence_id,
          c.custom_definition_id, c.element_identity_id, c.catalog_release_id,
          c.effective_amendment_sequence, c.group_id, c.group_instance_id,
          c.parent_group_instance_id, c.group_path, c.instance_path,
          c.group_ordinal, c.element_ordinal, c.correlation_id, c.group_correlation_id,
          c.clinical_time, c.documented_time, c.code,
          case when c.absence_kind is not null or c.not_value_code is not null
            or c.pertinent_negative_code is not null then null
            else case c.value_kind when 'coded' then c.code when 'text' then c.value_text
              when 'boolean' then c.value_boolean::text when 'date' then c.value_date::text
              when 'datetime' then c.value_datetime::text else null end end as categorical_value,
          case when c.absence_kind is not null or c.not_value_code is not null
            or c.pertinent_negative_code is not null then null
            else coalesce(c.normalized_numeric, c.value_numeric, c.value_integer::numeric) end
            as numeric_value,
          coalesce(c.normalized_unit_code, c.source_unit_code) as unit_code,
          coalesce(c.absence_kind, case when c.not_value_code is not null then 'null'
            when c.pertinent_negative_code is not null then 'pertinent-negative' end) as absence_kind,
          coalesce(c.absence_code, c.not_value_code, c.pertinent_negative_code) as absence_code,
          c.normalization_rule_id, c.quality_flags
        from analytics.review_custom_field_source c
        join analytics.review_volume_source report on report.report_id=c.report_id
          and report.reporting_date=c.reporting_date and report.organization_id=c.organization_id
        where report.reporting_date between $1::date and $2::date
          and report.organization_id=$3::uuid and report.synthetic=$4::boolean
          and ($5::boolean or report.documenting_user_id=$6::uuid)
          and c.custom_definition_id=any($7::uuid[])
        order by c.report_id, c.group_ordinal nulls first, c.element_ordinal,
          c.element_occurrence_id limit 20001`,
      [from, to, scope.organizationId, dataset === "synthetic", scope.reports === "all",
        scope.userId, ids]);
      if (occurrences.length > 20000) throw new BadRequestException("Review analysis exceeds the occurrence limit");
      if (occurrences.some((row) => row.categorical_value && row.categorical_value.length > 256))
        throw new BadRequestException("Custom category exceeds chart limits");
      const reduced = reduceCustom(reportRows, occurrences, definition, field, groupField, filterField);
      return { definition, field: metadata, population, freshness, ...reduced };
    }
    if (field.source === "operational-time") {
      // IDs come from the fixed allowlist; no client supplied SQL identifier is interpolated.
      const endpoints = {
        "review.duration.response": ["etimes_03", "etimes_06"],
        "review.duration.scene": ["etimes_06", "etimes_09"],
        "review.duration.transport": ["etimes_09", "etimes_11"],
      }[field.id];
      if (!endpoints) throw new BadRequestException("Unknown operational time measure");
      const [startColumn, endColumn] = endpoints;
      const start = `interval_source.${startColumn}`;
      const end = `interval_source.${endColumn}`;
      const interval = `extract(epoch from (${end} - ${start})) / 60`;
      const invalid = `${start} is not null and ${end} is not null and ${end} < ${start}`;
      const absent = `(${start} is null and interval_source.${startColumn}_absent)
        or (${end} is null and interval_source.${endColumn}_absent)`;
      const valid = `${start} is not null and ${end} is not null and ${end} >= ${start}`;
      const rows = await database.query<Array<{ group_value: string | null; denominator: string;
        missing: string; absent: string; invalid: string; mean: string | null;
        median: string | null; minimum: string | null; maximum: string | null }>>(`
        select case when $7::text is null then null else source.field_values ->> $7::text end as group_value,
          count(*)::text as denominator,
          count(*) filter (where not (${valid}) and not (${invalid}) and not (${absent}))::text as missing,
          count(*) filter (where not (${valid}) and not (${invalid}) and (${absent}))::text as absent,
          count(*) filter (where ${invalid})::text as invalid,
          avg(case when ${valid} then ${interval} end)::text as mean,
          percentile_cont(0.5) within group (order by case when ${valid} then (${interval})::double precision end)::text as median,
          min(case when ${valid} then ${interval} end)::text as minimum,
          max(case when ${valid} then ${interval} end)::text as maximum
        from analytics.review_field_source_with_identity source
        join analytics.review_operational_time_source interval_source
          on interval_source.report_id = source.report_id
          and interval_source.reporting_date = source.reporting_date
        where source.reporting_date between $1::date and $2::date
          and source.organization_id = $3::uuid and source.synthetic = $4::boolean
          and ($5::boolean or source.documenting_user_id = $6::uuid)
          and ($8::text is null or ${filterField && "repeating" in filterField ?
            `exists (select 1 from analytics.review_repeated_field_source f
              where f.report_id = source.report_id and f.reporting_date = source.reporting_date
                and f.element_id = $8::text and f.code = $9::text)` :
            "source.field_values ->> $8::text = $9::text"})
        group by 1 order by 1 nulls first limit 101`,
      [from, to, scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId,
        groupField?.id ?? null, filterField?.id ?? null, filter?.value ?? null]);
      if (rows.length > 100) throw new BadRequestException("Review analysis has too many groups");
      return { definition, field: metadata, population, freshness,
        groups: rows.map((row) => ({ group: row.group_value, denominator: Number(row.denominator),
          missing: Number(row.missing), absent: Number(row.absent), invalid: Number(row.invalid),
          values: [], summary: row[input.operation as "mean" | "median" | "minimum" | "maximum"] === null
            ? null : Number(row[input.operation as "mean" | "median" | "minimum" | "maximum"]) })) };
    }
    const params = [from, to, scope.organizationId, dataset === "synthetic", scope.reports === "all",
      scope.userId, field.id, groupField?.id ?? null, filterField?.id ?? null, filter?.value ?? null];
    const source = `from analytics.${filterField && "repeating" in filterField ?
      "review_field_source_with_identity" : "review_field_source"} source
      where source.reporting_date between $1::date and $2::date
        and source.organization_id = $3::uuid and source.synthetic = $4::boolean
        and ($5::boolean or source.documenting_user_id = $6::uuid)
        and ($9::text is null or ${filterField && "repeating" in filterField ?
          `exists (select 1 from analytics.review_repeated_field_source f
            where f.report_id = source.report_id and f.reporting_date = source.reporting_date
              and f.element_id = $9::text and f.code = $10::text)` :
          "source.field_values ->> $9::text = $10::text"})`;
    const group = `case when $8::text is null then null else source.field_values ->> $8::text end`;
    if (field.kind === "categorical") {
      const rows = await database.query<Array<{ group_value: string | null; field_value: string | null;
        absent: boolean; count: string }>>(`select ${group} as group_value,
        source.field_values ->> $7::text as field_value,
        source.field_absences ? $7::text as absent, count(*)::text as count
        ${source} group by 1, 2, 3 order by 1 nulls first, 2 nulls first limit 501`, params);
      if (rows.length > 500) throw new BadRequestException("Review analysis has too many categories");
      const groups = new Map<string | null, ReviewAnalysisResult["groups"][number]>();
      for (const row of rows) {
        const item = groups.get(row.group_value) ?? { group: row.group_value, denominator: 0,
          missing: 0, absent: 0, values: [], summary: null };
        const count = Number(row.count);
        item.denominator += count;
        if (row.field_value === null) {
          if (row.absent) item.absent += count; else item.missing += count;
        } else item.values.push({ value: row.field_value, count, percentage: 0 });
        groups.set(row.group_value, item);
      }
      for (const item of groups.values()) for (const value of item.values)
        value.percentage = item.denominator ? 100 * value.count / item.denominator : 0;
      return { definition, field: metadata, population, freshness, groups: [...groups.values()] };
    }
    const rows = await database.query<Array<{ group_value: string | null; denominator: string;
      missing: string; absent: string; value_count: string; mean: string | null;
      median: string | null; minimum: string | null; maximum: string | null }>>(`
      select ${group} as group_value, count(*)::text as denominator,
        count(*) filter (where source.field_values ->> $7::text is null
          and not source.field_absences ? $7::text)::text as missing,
        count(*) filter (where source.field_values ->> $7::text is null
          and source.field_absences ? $7::text)::text as absent,
        count(source.field_values ->> $7::text)::text as value_count,
        avg((source.field_values ->> $7::text)::numeric)::text as mean,
        percentile_cont(0.5) within group (order by (source.field_values ->> $7::text)::double precision)::text as median,
        min((source.field_values ->> $7::text)::numeric)::text as minimum,
        max((source.field_values ->> $7::text)::numeric)::text as maximum
      ${source} group by 1 order by 1 nulls first limit 101`, params);
    if (rows.length > 100) throw new BadRequestException("Review analysis has too many groups");
    return { definition, field: metadata, population, freshness,
      groups: rows.map((row) => ({ group: row.group_value, denominator: Number(row.denominator),
        missing: Number(row.missing), absent: Number(row.absent),
        values: [], summary: row[input.operation as "mean" | "median" | "minimum" | "maximum"] === null ? null :
          Number(row[input.operation as "mean" | "median" | "minimum" | "maximum"]) })) };
  }

  async volume(token: string, requestedDataset?: string,
    from?: string, to?: string): Promise<ReviewVolumeResult> {
    const scope = reviewScope(await this.sessions.get(token));
    const dataset = requestedDataset ?? scope.defaultDataset;
    if (dataset !== "real" && dataset !== "synthetic") throw new BadRequestException("Invalid Review dataset");
    if (!validDate(from) || !validDate(to) || from > to ||
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 365) {
      throw new BadRequestException("Invalid Review date period");
    }
    const database = await this.analyticsDatabase();
    const [health] = await database.query<Array<{
      observed_at: Date | string; oldest_backlog_age_seconds: string | number | null;
      persistent_failure_count: number; retrying_count: number;
      stale_run_count: number; last_run_status: string | null;
      is_read_only_replica: boolean; replay_lag_seconds: string | number | null;
    }>>(`select h.observed_at, h.oldest_backlog_age_seconds,
        h.persistent_failure_count, h.retrying_count, h.stale_run_count, h.last_run_status,
        r.is_read_only_replica, r.replay_lag_seconds
      from operations.projection_health h cross join operations.reporting_replica_health r`);
    if (!health) throw new Error("Projection health is unavailable");
    const backlog = health.oldest_backlog_age_seconds === null ? null : Number(health.oldest_backlog_age_seconds);
    const lag = health.replay_lag_seconds === null ? null : Number(health.replay_lag_seconds);
    const replicaConfigured = !!process.env.REVIEW_REPORTING_REPLICA_DATABASE_URL;
    const current = Number(health.persistent_failure_count) === 0 &&
      Number(health.retrying_count) === 0 && Number(health.stale_run_count) === 0 &&
      health.last_run_status !== "failed" && health.last_run_status !== "partial" &&
      (backlog === null || backlog <= 300) &&
      (!replicaConfigured || (health.is_read_only_replica && lag !== null && lag <= 300));
    const definition = { measure: "signed-report-count" as const, grouping: "day" as const,
      filters: { from, to, dataset: dataset as "real" | "synthetic" } };
    const population = { unit: "patient-report" as const, scope: scope.reports,
      organizationId: scope.organizationId, signedOnly: true as const };
    const freshness = { observedAt: new Date(health.observed_at).toISOString(), targetSeconds: 300 as const,
      status: current ? "current" as const : "stale" as const,
      oldestBacklogSeconds: backlog, replicaLagSeconds: lag };
    if (!current) return { definition, population, freshness, total: null, points: [] };
    const rows = await database.query<Array<{ date: string; count: string }>>(`
      select days.date::date::text as date, count(source.report_id)::text as count
      from generate_series($1::date, $2::date, interval '1 day') days(date)
      left join analytics.review_volume_source source
        on source.reporting_date = days.date::date
        and source.organization_id = $3::uuid and source.synthetic = $4::boolean
        and ($5::boolean or source.documenting_user_id = $6::uuid)
      group by days.date order by days.date`,
    [from, to, scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId]);
    const points = rows.map((row) => ({ date: row.date, count: Number(row.count) }));
    return { definition, population, freshness, points,
      total: points.reduce((sum, point) => sum + point.count, 0) };
  }

  async signedReports(token: string, requestedDataset?: string,
    requestedPage?: string, requestedPageSize?: string): Promise<ReviewSignedReportsResponse> {
    const scope = reviewScope(await this.sessions.get(token));
    const dataset = requestedDataset ?? scope.defaultDataset;
    if (dataset !== "real" && dataset !== "synthetic") throw new BadRequestException("Invalid Review dataset");
    const page = positiveInteger(requestedPage, 1, 1000000);
    const pageSize = positiveInteger(requestedPageSize, 25, 100);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new BadRequestException("Invalid Review pagination");
    const parameters = [scope.organizationId, dataset === "synthetic", scope.userId, scope.reports === "all"];
    const where = `r.organization_id = $1 and r.synthetic = $2 and r.status = 'signed'
      and ($4::boolean or r.documenting_user_id = $3)`;
    const [countRows, reportRows] = await Promise.all([
      this.database.query<Array<{ total: string }>>(`select count(*)::text total from clinical.report r where ${where}`, parameters),
      this.database.query<Array<{ id: string; reporting_date: string; signed_at: Date | string;
        author_name: string | null }>>(`
        select r.id, r.reporting_date, s.signed_at,
          case when $7::boolean then u.display_name else null end author_name
        from clinical.report r
        join clinical.signed_snapshot s on s.report_id = r.id
        join app_identity.app_user u on u.id = r.documenting_user_id
        where ${where}
        order by s.signed_at desc, r.id desc limit $5 offset $6
      `, [...parameters, pageSize, offset, scope.identifying]),
    ]);
    return {
      dataset, page, pageSize, total: Number(countRows[0]?.total ?? 0),
      scope: scope.reports, identifying: scope.identifying, administrator: scope.administrator,
      asOf: new Date().toISOString(),
      reports: reportRows.map((row) => ({ id: row.id, reportingDate: row.reporting_date,
        signedAt: new Date(row.signed_at).toISOString(),
        ...(row.author_name ? { documentingClinician: row.author_name } : {}) })),
    };
  }

  private dataset(requested: string | undefined, scope: ReviewScope): "real" | "synthetic" {
    const dataset = requested ?? scope.defaultDataset;
    if (dataset !== "real" && dataset !== "synthetic") throw new BadRequestException("Invalid Review dataset");
    return dataset;
  }

  async overduePolicy(token: string): Promise<{ deadlineHours: number; version: number }> {
    const scope = reviewScope(await this.sessions.get(token));
    if (!scope.administrator) throw new ForbiddenException("Review administration is required");
    const [row] = await this.database.query<Array<{ deadline_hours: number; version: string }>>(`
      select deadline_hours,version from clinical.review_overdue_policy
      where organization_id=$1`, [scope.organizationId]);
    return { deadlineHours: Number(row?.deadline_hours ?? 24), version: Number(row?.version ?? 0) };
  }

  async configureOverduePolicy(token: string, command: { commandId: string;
    expectedVersion: number; deadlineHours: number }, csrfToken?: string):
    Promise<{ deadlineHours: number; version: number }> {
    if (!command || !uuid(command.commandId) || !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0 || !Number.isSafeInteger(command.deadlineHours) ||
      command.deadlineHours < 1 || command.deadlineHours > 720)
      throw new BadRequestException("Invalid overdue deadline setting");
    return this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.administrator) throw new ForbiddenException("Review administration is required");
      await manager.query(`insert into clinical.review_overdue_policy (organization_id)
        values ($1) on conflict do nothing`, [scope.organizationId]);
      const [row] = await manager.query<Array<{ version: string }>>(`
        select version from clinical.review_overdue_policy where organization_id=$1 for update`,
      [scope.organizationId]);
      const [replayed] = await manager.query<Array<{ actor_id: string; version: string;
        deadline_hours: number }>>(`select actor_id,version,deadline_hours
        from clinical.review_overdue_policy_history where organization_id=$1 and command_id=$2`,
      [scope.organizationId, command.commandId]);
      if (replayed) {
        if (replayed.actor_id !== scope.userId || Number(replayed.version) !== command.expectedVersion + 1 ||
          Number(replayed.deadline_hours) !== command.deadlineHours)
          throw new ConflictException("Overdue setting command has already been used");
        return { deadlineHours: command.deadlineHours, version: Number(replayed.version) };
      }
      if (Number(row?.version) !== command.expectedVersion)
        throw new ConflictException("Overdue deadline setting changed; refresh and try again");
      await manager.query(`update clinical.review_overdue_policy set deadline_hours=$2,
        version=version+1,updated_by=$3,updated_at=now() where organization_id=$1`,
      [scope.organizationId, command.deadlineHours, scope.userId]);
      await manager.query(`insert into clinical.review_overdue_policy_history
        (organization_id,command_id,actor_id,deadline_hours,version) values ($1,$2,$3,$4,$5)`,
      [scope.organizationId,command.commandId,scope.userId,command.deadlineHours,command.expectedVersion+1]);
      return { deadlineHours: command.deadlineHours, version: command.expectedVersion + 1 };
    });
  }

  private async scopedReport(manager: EntityManager, scope: ReviewScope, id: string, dataset: "real" | "synthetic") {
    const rows = await manager.query<Array<{ id: string; reporting_date: string; signed_at: Date | string;
      catalog_release_id: string }>>(`
      select r.id, r.reporting_date, s.signed_at, r.catalog_release_id
      from clinical.report r join clinical.signed_snapshot s on s.report_id = r.id
      where r.id = $1 and r.organization_id = $2 and r.synthetic = $3
        and r.status = 'signed' and ($4::boolean or r.documenting_user_id = $5)`,
    [id, scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId]);
    if (!rows[0]) throw new NotFoundException("Signed report was not found in Review scope");
    return rows[0];
  }

  async report(token: string, id: string, requestedDataset?: string): Promise<ReviewSignedReport> {
    return this.database.transaction("REPEATABLE READ", async (manager) => {
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      const dataset = this.dataset(requestedDataset, scope);
      const report = await this.scopedReport(manager, scope, id, dataset);
      const groups = await manager.query<Array<{ id: string; parent_group_instance_id: string | null;
        group_id: string; label: string; ordinal: number }>>(`
        select gi.id, gi.parent_group_instance_id, gi.group_id,
          coalesce(gd.name, cgd.definition->>'title', gi.group_id) as label, gi.ordinal
        from clinical.group_instance gi
        left join catalog.group_definition gd on gd.release_id = $2 and gd.group_id = gi.group_id
        left join forms.custom_group_definition cgd on cgd.id = gi.custom_group_definition_id
        where gi.report_id = $1 and gi.tombstoned_at is null
        order by gi.group_id, gi.ordinal, gi.id`, [id, report.catalog_release_id]);
      type ValueRow = { occurrence: Record<string, unknown>; label: string; identifying: boolean };
      const base = await manager.query<ValueRow[]>(`
        select to_jsonb(o) as occurrence, coalesce(ed.name, ced.title, o.element_id) as label,
          o.identifying or coalesce(ced.identifying, false) as identifying
        from clinical.element_occurrence o
        left join catalog.element_definition ed on ed.release_id = $2 and ed.element_identity_id = o.element_identity_id
        left join forms.custom_element_definition ced on ced.id = o.element_identity_id
        where o.report_id = $1 and o.tombstoned_at is null`, [id, report.catalog_release_id]);
      const definitions = await manager.query<Array<{ element_identity_id: string; label: string; identifying: boolean }>>(`
        select ed.element_identity_id, ed.name as label, coalesce(m.identifying, false) as identifying
        from catalog.element_definition ed
        left join catalog.analytics_element_mapping m on m.release_id = ed.release_id and m.element_id = ed.element_id
        where ed.release_id = $1
        union all
        select ced.id, ced.title, ced.identifying from forms.custom_element_definition ced
        where ced.organization_id = $2`, [report.catalog_release_id, scope.organizationId]);
      const definitionByIdentity = new Map(definitions.map((row) => [row.element_identity_id, row]));
      const effective = new Map(base.map((row) => [String(row.occurrence.id), row]));
      const changes = await manager.query<Array<{ action: string; target_element_occurrence_id: string | null;
        corrected_value: Record<string, unknown> | null; sequence: number }>>(`
        select ac.action, ac.target_element_occurrence_id, ac.corrected_value, a.sequence
        from clinical.amendment a join clinical.amendment_change ac on ac.amendment_id = a.id
        where a.report_id = $1 order by a.sequence, ac.id`, [id]);
      for (const change of changes) {
        if (change.action === "remove") { effective.delete(change.target_element_occurrence_id!); continue; }
        if (!change.corrected_value) continue;
        const previous = change.target_element_occurrence_id ? effective.get(change.target_element_occurrence_id) : undefined;
        const occurrence = { ...(previous?.occurrence ?? {}), ...change.corrected_value };
        const identity = String(occurrence.element_identity_id ?? "");
        const definition = definitionByIdentity.get(identity);
        effective.set(String(occurrence.id), { occurrence,
          label: definition?.label ?? previous?.label ?? String(occurrence.element_id ?? identity),
          identifying: Boolean(occurrence.identifying ?? definition?.identifying ?? previous?.identifying) });
      }
      const values = [...effective.values()].filter((row) => scope.identifying || !row.identifying)
        .map(({ occurrence, label }) => this.presentValue(occurrence, label, scope.identifying))
        .filter((value): value is ReviewReportValue => value !== null)
        .sort((a, b) => (a.groupInstanceId ?? "").localeCompare(b.groupInstanceId ?? "") ||
          a.elementId.localeCompare(b.elementId) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
      // Narrative and media metadata are unrestricted clinical content. Return neither without identifying access.
      const notes = scope.identifying ? [...await reportTextNotes(manager, id)] : [];
      const reviewItems = await manager.query<Array<{ id: string; criterion_id: string;
        status: ReviewItemDetail["status"]; outcome_option_id: string | null;
        outcome_revision: number | null; outcome_label: string | null; outcome_meaning: string | null;
        clearance_pending: boolean; closure_reason: string | null }>>(`
        select item.id,item.criterion_id,item.status,item.outcome_option_id,item.outcome_revision,
          item.clearance_pending,item.closure_reason,
          outcome.label as outcome_label,outcome.meaning as outcome_meaning
        from clinical.review_item item left join clinical.review_outcome_revision outcome
          on outcome.option_id=item.outcome_option_id and outcome.revision=item.outcome_revision
        where item.report_id=$1 and item.organization_id=$2 order by item.first_matched_at,item.id`,
      [id, scope.organizationId]);
      return { id, reportingDate: report.reporting_date, signedAt: new Date(report.signed_at).toISOString(),
        amendmentSequence: changes.at(-1)?.sequence ?? 0, identifying: scope.identifying,
        groups: groups.map((group) => ({ id: group.id, parentGroupInstanceId: group.parent_group_instance_id,
          groupId: group.group_id, label: group.label, ordinal: Number(group.ordinal) })), values, notes,
        reviewItems: reviewItems.map((item) => ({ id: item.id, criterionId: item.criterion_id,
          status: item.status, outcome: reviewOutcome(item), clearancePending: item.clearance_pending,
          closureReason: item.closure_reason })) };
    });
  }

  async overdueDraft(token: string, itemId: string, requestedDataset?: string): Promise<ReviewOverdueDraft> {
    return this.database.transaction("REPEATABLE READ", async (manager) => {
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      const dataset = this.dataset(requestedDataset, scope);
      const [row] = await manager.query<Array<{ id: string; catalog_release_id: string;
        created_at: Date | string; deadline_at: Date | string;
        deadline_source: ReviewOverdueDraft["deadlineSource"] }>>(`
        select r.id,r.catalog_release_id,r.created_at,i.deadline_at,i.deadline_source
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        where i.id=$1 and i.kind='overdue-unsigned' and i.organization_id=$2
          and r.organization_id=$2 and r.synthetic=$3 and r.status='draft'
          and ($4::boolean or r.documenting_user_id=$5)`,
      [itemId,scope.organizationId,dataset === "synthetic",scope.reports === "all",scope.userId]);
      if (!row) throw new NotFoundException("Overdue draft was not found in Review scope");
      const groups = await manager.query<Array<{ id: string; parent_group_instance_id: string | null;
        group_id: string; label: string; ordinal: number }>>(`
        select gi.id,gi.parent_group_instance_id,gi.group_id,
          coalesce(gd.name,cgd.definition->>'title',gi.group_id) label,gi.ordinal
        from clinical.group_instance gi
        left join catalog.group_definition gd on gd.release_id=$2 and gd.group_id=gi.group_id
        left join forms.custom_group_definition cgd on cgd.id=gi.custom_group_definition_id
        where gi.report_id=$1 and gi.tombstoned_at is null
        order by gi.group_id,gi.ordinal,gi.id`, [row.id,row.catalog_release_id]);
      const occurrences = await manager.query<Array<{ occurrence: Record<string, unknown>;
        label: string; identifying: boolean }>>(`
        select to_jsonb(o) occurrence,coalesce(ed.name,ced.title,o.element_id) label,
          o.identifying or coalesce(ced.identifying,false) identifying
        from clinical.element_occurrence o
        left join catalog.element_definition ed on ed.release_id=$2
          and ed.element_identity_id=o.element_identity_id
        left join forms.custom_element_definition ced on ced.id=o.element_identity_id
        where o.report_id=$1 and o.tombstoned_at is null`, [row.id,row.catalog_release_id]);
      const values = occurrences.filter((value) => scope.identifying || !value.identifying)
        .map((value) => this.presentValue(value.occurrence,value.label,scope.identifying))
        .filter((value): value is ReviewReportValue => value !== null)
        .sort((a,b) => (a.groupInstanceId ?? "").localeCompare(b.groupInstanceId ?? "") ||
          a.elementId.localeCompare(b.elementId) || a.ordinal-b.ordinal || a.id.localeCompare(b.id));
      return { id: row.id,itemId,createdAt: new Date(row.created_at).toISOString(),
        deadlineAt: new Date(row.deadline_at).toISOString(),deadlineSource: row.deadline_source,
        identifying: scope.identifying,
        groups: groups.map((group) => ({ id: group.id,parentGroupInstanceId: group.parent_group_instance_id,
          groupId: group.group_id,label: group.label,ordinal: Number(group.ordinal) })),
        values,notes: scope.identifying ? await reportTextNotes(manager,row.id) : [] };
    });
  }


  async queue(token: string, filters: { dataset?: string; criterion?: string; priority?: string;
    status?: string; from?: string; to?: string; page?: string; pageSize?: string }) {
    const scope = reviewScope(await this.sessions.get(token));
    const dataset = this.dataset(filters.dataset, scope);
    const page = positiveInteger(filters.page, 1, 1000000);
    const pageSize = positiveInteger(filters.pageSize, 25, 100);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new BadRequestException("Invalid Review pagination");
    if (filters.criterion && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.criterion))
      throw new BadRequestException("Invalid Review criterion");
    if (filters.priority && !["high", "medium", "low"].includes(filters.priority))
      throw new BadRequestException("Invalid Review priority");
    if (filters.status && !["new", "in-review", "awaiting-clinician", "completed"].includes(filters.status))
      throw new BadRequestException("Invalid Review status");
    for (const value of [filters.from, filters.to]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException("Invalid Review date");
    const params = [scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId,
      filters.criterion ?? null, filters.priority ?? null, filters.status ?? null,
      filters.from ?? null, filters.to ?? null];
    const where = `i.organization_id=$1 and r.organization_id=$1 and r.synthetic=$2
      and ((i.kind='criterion' and r.status='signed') or i.kind='overdue-unsigned')
      and ($3::boolean or r.documenting_user_id=$4)
      and ($5::uuid is null or i.criterion_id=$5) and ($6::text is null or i.priority=$6)
      and ($7::text is null or i.status=$7)
      and ($8::date is null or coalesce(r.reporting_date,i.deadline_basis_at::date) >= $8)
      and ($9::date is null or coalesce(r.reporting_date,i.deadline_basis_at::date) <= $9)`;
    const [counts, rows] = await Promise.all([
      this.database.query<Array<{ total: string }>>(`select count(*)::text total from clinical.review_item i
        join clinical.report r on r.id=i.report_id where ${where}`, params),
      this.database.query<Array<{ id: string; report_id: string; criterion_id: string; priority: string;
        status: string; assignee_id: string | null; version: string; recovery_reason: string | null;
        active_match: boolean; clearance_pending: boolean; reopened: boolean; closure_reason: string | null;
        catalog_release_id: string;
        first_matched_at: Date | string; kind: ReviewItemDetail["kind"];
        deadline_at: Date | string | null; deadline_source: ReviewItemDetail["deadlineSource"];
        resolution_reason: string | null; exception_code: ReviewOverdueExceptionCode | null;
        reporting_date: string | null; signed_at: Date | string | null; findings: unknown;
        outcome_option_id: string | null; outcome_revision: number | null;
        outcome_label: string | null; outcome_meaning: string | null }>>(`
        select i.id,i.report_id,i.criterion_id,i.priority,i.status,i.assignee_id,i.version,
          i.recovery_reason,i.active_match,i.clearance_pending,i.reopened,i.closure_reason,i.first_matched_at,i.kind,i.deadline_at,i.deadline_source,i.resolution_reason,i.exception_code,
          r.reporting_date,r.catalog_release_id,s.signed_at,i.outcome_option_id,i.outcome_revision,
          outcome.label as outcome_label,outcome.meaning as outcome_meaning,
          case when i.active_match then (select e.findings from clinical.review_item_evidence e
            where e.item_id=i.id order by e.recorded_at desc,e.id desc limit 1)
            else '[]'::jsonb end findings
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        left join clinical.signed_snapshot s on s.report_id=r.id
        left join clinical.review_outcome_revision outcome
          on outcome.option_id=i.outcome_option_id and outcome.revision=i.outcome_revision
        where ${where} order by i.first_matched_at desc,i.id desc limit $10 offset $11`,
      [...params, pageSize, offset]),
    ]);
    const queueTargets = [...new Set(rows.flatMap((row) => (row.findings as ReviewItemDetail["findings"] ?? [])
      .map((finding) => finding.primaryTarget.elementId)))];
    const queueReleases = [...new Set(rows.map((row) => row.catalog_release_id))];
    const queueVisibility = scope.identifying || !queueTargets.length ? [] :
      await this.database.query<Array<{ release_id: string; element_id: string }>>(`
        select release_id,element_id from catalog.analytics_element_mapping
        where release_id=any($1::uuid[]) and element_id=any($2::text[]) and not identifying`,
      [queueReleases, queueTargets]);
    const visibleQueueTargets = new Set(queueVisibility.map((entry) => `${entry.release_id}:${entry.element_id}`));
    return { dataset, page, pageSize, total: Number(counts[0]?.total ?? 0),
      asOf: new Date().toISOString(), items: rows.map((row) => ({
        id: row.id, reportId: row.report_id, criterionId: row.criterion_id, priority: row.priority,
        kind: row.kind, deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
        deadlineSource: row.deadline_source, resolutionReason: row.resolution_reason,
        exceptionCode: row.exception_code,
        status: row.status, outcome: reviewOutcome(row), activeMatch: row.active_match,
        clearancePending: row.clearance_pending, reopened: row.reopened, closureReason: row.closure_reason, assigneeId: row.assignee_id, version: Number(row.version),
        recoveryReason: row.recovery_reason,
        firstMatchedAt: new Date(row.first_matched_at).toISOString(),
        reportingDate: row.reporting_date, signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
        findings: (row.findings as ReviewItemDetail["findings"] ?? []).filter((finding) =>
          scope.identifying || visibleQueueTargets.has(`${row.catalog_release_id}:${finding.primaryTarget.elementId}`)),
      })) };
  }

  async item(token: string, id: string, requestedDataset?: string): Promise<ReviewItemDetail> {
    const scope = reviewScope(await this.sessions.get(token));
    const dataset = this.dataset(requestedDataset, scope);
    const rows = await this.database.query<Array<{ id: string; report_id: string; criterion_id: string;
      priority: "high" | "medium" | "low"; status: ReviewItemDetail["status"];
      assignee_id: string | null; version: string; recovery_reason: string | null;
      active_match: boolean; clearance_pending: boolean; reopened: boolean; closure_reason: string | null;
        catalog_release_id: string;
        first_matched_at: Date | string; kind: ReviewItemDetail["kind"];
      deadline_at: Date | string | null; deadline_source: ReviewItemDetail["deadlineSource"];
      resolution_reason: string | null; exception_code: ReviewOverdueExceptionCode | null;
      reporting_date: string | null; signed_at: Date | string | null; findings: ReviewItemDetail["findings"];
      outcome_option_id: string | null; outcome_revision: number | null;
      outcome_label: string | null; outcome_meaning: string | null;
      documenting_user_id: string }>>(`
      select i.id,i.report_id,i.criterion_id,i.priority,i.status,i.assignee_id,i.version,
        i.recovery_reason,i.active_match,i.clearance_pending,i.reopened,i.closure_reason,i.first_matched_at,i.kind,i.deadline_at,i.deadline_source,i.resolution_reason,i.exception_code,
        r.reporting_date,r.catalog_release_id,r.documenting_user_id,s.signed_at,i.outcome_option_id,i.outcome_revision,
        outcome.label as outcome_label,outcome.meaning as outcome_meaning,
        case when i.active_match then (select e.findings from clinical.review_item_evidence e
          where e.item_id=i.id order by e.recorded_at desc,e.id desc limit 1)
          else '[]'::jsonb end findings
      from clinical.review_item i join clinical.report r on r.id=i.report_id
      left join clinical.signed_snapshot s on s.report_id=r.id
      left join clinical.review_outcome_revision outcome
        on outcome.option_id=i.outcome_option_id and outcome.revision=i.outcome_revision
      where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
        and r.synthetic=$3 and ((i.kind='criterion' and r.status='signed')
          or i.kind='overdue-unsigned') and ($4::boolean or r.documenting_user_id=$5)`,
    [id, scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId]);
    const row = rows[0];
    if (!row) throw new NotFoundException("Review item was not found in scope");
    const history = await this.database.query<Array<{ command_id: string; actor_id: string | null;
      assignee_id: string | null; previous_assignee_id: string | null; action: "claimed" | "assigned" | "routed" | "recovered";
      reason: string | null; item_version: string; assigned_at: Date | string }>>(`
      select command_id,actor_id,assignee_id,previous_assignee_id,action,reason,item_version,assigned_at
      from clinical.review_assignment_history where item_id=$1 and organization_id=$2
      order by item_version`, [id, scope.organizationId]);
    const progress = await this.database.query<Array<{ command_id: string; actor_id: string | null;
      item_version: string; status: ReviewItemDetail["status"]; recorded_at: Date | string;
      reason: string | null; evaluation_id: string | null;
      outcome_option_id: string | null; outcome_revision: number | null;
      outcome_label: string | null; outcome_meaning: string | null }>>(`
      select h.command_id,h.actor_id,h.item_version,h.status,h.recorded_at,h.reason,h.evaluation_id,
        h.outcome_option_id,h.outcome_revision,o.label as outcome_label,o.meaning as outcome_meaning
      from clinical.review_progress_history h left join clinical.review_outcome_revision o
        on o.option_id=h.outcome_option_id and o.revision=h.outcome_revision
      where h.item_id=$1 and h.organization_id=$2 order by h.item_version`, [id, scope.organizationId]);
    const overdueHistory = row.kind === "overdue-unsigned" ? await this.database.query<Array<{
      action: "detected" | "resolved-by-signing" | "closed-exceptionally" | "signed-after-exception";
      item_version: string;
      actor_id: string | null; reason_code: ReviewOverdueExceptionCode | null;
      recorded_at: Date | string }>>(`select action,item_version,recorded_at,actor_id,reason_code
      from clinical.review_overdue_history where item_id=$1 and organization_id=$2
      order by item_version`, [id, scope.organizationId]) : [];
    const decisions = await this.database.query<Array<{ evaluation_id: string;
      amendment_sequence: number; matched: boolean; action: ReviewItemDetail["amendmentHistory"][number]["action"];
      reason: string | null; policy: "confirm" | "automatic" | null; item_version: string;
      validation_version_id: string; evaluated_at: Date | string;
      findings: ReviewItemDetail["findings"];
      changes: Array<{ elementId: string | null; groupInstanceId: string; occurrenceId: string | null;
        change: "added" | "removed" | "changed"; identifying: boolean }> }>>(`
      select decision.evaluation_id,decision.amendment_sequence,decision.matched,
        decision.action,decision.reason,decision.policy,decision.item_version,
        evaluation.validation_version_id,evaluation.evaluated_at,
        coalesce(evidence.findings,'[]'::jsonb) findings,decision.changes
      from clinical.review_amendment_decision decision
      join clinical.review_evaluation evaluation on evaluation.id=decision.evaluation_id
      left join clinical.review_item_evidence evidence on evidence.item_id=decision.item_id
        and evidence.work_id=decision.work_id
      where decision.organization_id=$1 and decision.item_id=$2
      order by decision.amendment_sequence,decision.recorded_at,decision.id`,
    [scope.organizationId, id]);
    const detailTargets = [...new Set([...(row.findings ?? []), ...decisions.flatMap((decision) => decision.findings)]
      .map((finding) => finding.primaryTarget.elementId))];
    const detailVisibility = scope.identifying || !detailTargets.length ? [] :
      await this.database.query<Array<{ element_id: string }>>(`
        select element_id from catalog.analytics_element_mapping
        where release_id=$1 and element_id=any($2::text[]) and not identifying`,
      [row.catalog_release_id, detailTargets]);
    const visibleDetailTargets = new Set(detailVisibility.map((entry) => entry.element_id));
    const permittedFindings = (findings: ReviewItemDetail["findings"]) =>
      findings.filter((finding) => scope.identifying || visibleDetailTargets.has(finding.primaryTarget.elementId));
    const comments = scope.identifying ? await this.database.query<Array<{
      id: string; actor_id: string; display_name: string; body: string;
      item_version: string; recorded_at: Date | string }>>(`
      select c.id,c.actor_id,u.display_name,c.body,c.item_version,c.recorded_at
      from clinical.review_comment c join app_identity.app_user u on u.id=c.actor_id
      where c.item_id=$1 and c.organization_id=$2
      order by c.recorded_at,c.id`, [id, scope.organizationId]) : [];
    return { id: row.id, reportId: row.report_id, criterionId: row.criterion_id,
      kind: row.kind, deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
      deadlineSource: row.deadline_source, resolutionReason: row.resolution_reason,
      exceptionCode: row.exception_code,
      priority: row.priority, status: row.status, outcome: reviewOutcome(row),
      activeMatch: row.active_match, clearancePending: row.clearance_pending,
      reopened: row.reopened, closureReason: row.closure_reason, assigneeId: row.assignee_id,
      version: Number(row.version), recoveryReason: row.recovery_reason,
      firstMatchedAt: new Date(row.first_matched_at).toISOString(),
      reportingDate: row.reporting_date, signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
      findings: permittedFindings(row.findings ?? []), assignmentHistory: history.map((event) => ({
        commandId: event.command_id, actorId: event.actor_id, assigneeId: event.assignee_id,
        previousAssigneeId: event.previous_assignee_id, action: event.action, reason: event.reason,
        itemVersion: Number(event.item_version), assignedAt: new Date(event.assigned_at).toISOString(),
      })), progressHistory: progress.map((event) => ({ commandId: event.command_id,
        actorId: event.actor_id, itemVersion: Number(event.item_version), status: event.status,
        outcome: reviewOutcome(event), reason: event.reason, evaluationId: event.evaluation_id, recordedAt: new Date(event.recorded_at).toISOString() })),
      overdueHistory: overdueHistory.map((event) => ({ action: event.action,
        itemVersion: Number(event.item_version), recordedAt: new Date(event.recorded_at).toISOString(),
        actorId: event.actor_id, reasonCode: event.reason_code })),
      amendmentHistory: decisions.map((decision) => ({ evaluationId: decision.evaluation_id,
        amendmentSequence: Number(decision.amendment_sequence), matched: decision.matched,
        action: decision.action, reason: decision.reason, policy: decision.policy,
        itemVersion: Number(decision.item_version), validationVersionId: decision.validation_version_id,
        evaluatedAt: new Date(decision.evaluated_at).toISOString(),
        findings: permittedFindings(decision.findings),
        changes: decision.changes.filter((change) => scope.identifying || !change.identifying)
          .map(({ elementId, groupInstanceId, occurrenceId, change }) =>
            ({ elementId, groupInstanceId, occurrenceId, change })) })),
      comments: comments.map((comment) => ({ id: comment.id, actorId: comment.actor_id,
        actorName: comment.display_name, body: comment.body, itemVersion: Number(comment.item_version),
        recordedAt: new Date(comment.recorded_at).toISOString() })), commentsRestricted: !scope.identifying,
      canComment: scope.identifying && (scope.administrator ||
        row.documenting_user_id === scope.userId || row.assignee_id === scope.userId) };

  }

  async closeOverdueException(token: string, id: string, command: CloseReviewOverdueCommand,
    csrfToken?: string): Promise<ReviewItemDetail> {
    if (!uuid(id) || !command || !uuid(command.commandId) ||
      !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 ||
      !["duplicate-follow-up", "report-not-required", "administrative-exception"].includes(command.reasonCode))
      throw new BadRequestException("A valid overdue exception reason is required");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.administrator) throw new ForbiddenException("Review administration is required");
      const dataset = this.dataset(command.dataset, scope);
      // Match the signing path's report -> item lock order.
      const reports = await manager.query<Array<{ status: string; kind: string }>>(`
        select r.status,i.kind from clinical.report r
        join clinical.review_item i on i.report_id=r.id and i.organization_id=r.organization_id
        where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
          and r.synthetic=$3 and ($4::boolean or r.documenting_user_id=$5)
        for update of r`, [id, scope.organizationId, dataset === "synthetic",
        scope.reports === "all", scope.userId]);
      if (!reports[0]) throw new NotFoundException("Review item was not found in scope");
      if (reports[0].kind !== "overdue-unsigned")
        throw new ConflictException("Only overdue unsigned follow-ups can be closed exceptionally");
      const items = await manager.query<Array<{ status: string; version: string }>>(`
        select status,version from clinical.review_item
        where id=$1 and organization_id=$2 for update`, [id, scope.organizationId]);
      const previous = await manager.query<Array<{ item_id: string; actor_id: string;
        item_version: string; reason_code: string }>>(`
        select item_id,actor_id,item_version,reason_code from clinical.review_overdue_history
        where organization_id=$1 and command_id=$2`, [scope.organizationId, command.commandId]);
      if (previous[0]) {
        if (previous[0].item_id !== id || previous[0].actor_id !== scope.userId ||
          previous[0].reason_code !== command.reasonCode ||
          Number(previous[0].item_version) !== command.expectedVersion + 1)
          throw new ConflictException("Overdue exception command has already been used");
        return;
      }
      if (reports[0].status !== "draft" || items[0]?.status === "completed")
        throw new ConflictException("Overdue follow-up is already resolved");
      if (Number(items[0]?.version) !== command.expectedVersion)
        throw new ConflictException("Review item changed; refresh and try again");
      await manager.query(`update clinical.review_item set status='completed',
        resolution_reason='closed-exceptionally',exception_code=$3,version=version+1,updated_at=now()
        where id=$1 and organization_id=$2`, [id, scope.organizationId, command.reasonCode]);
      await manager.query(`insert into clinical.review_overdue_history
        (organization_id,item_id,item_version,action,command_id,actor_id,reason_code)
        values ($1,$2,$3,'closed-exceptionally',$4,$5,$6)`,
      [scope.organizationId,id,command.expectedVersion + 1,command.commandId,scope.userId,
        command.reasonCode]);
    });
    return this.item(token, id, command.dataset);
  }

  async claim(token: string, id: string, command: ClaimReviewItemCommand, csrfToken?: string): Promise<ReviewItemDetail> {
    if (!command || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.commandId) ||
      !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0)
      throw new BadRequestException("Invalid Review claim command");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (scope.reports !== "all") throw new ForbiddenException("Review-all access is required to claim items");
      await manager.query(`select id from app_identity.organization where id=$1 for share`,
        [scope.organizationId]);
      const dataset = this.dataset(command.dataset, scope);
      // Lock the item itself so two claimants cannot both observe an unassigned version.
      const rows = await manager.query<Array<{ version: string; status: string; assignee_id: string | null;
        documenting_user_id: string; independent_review: boolean }>>(`
        select i.version,i.status,i.assignee_id,r.documenting_user_id,
          coalesce(route.independent_review,false) independent_review from clinical.review_item i
        join clinical.report r on r.id=i.report_id
        left join clinical.review_criterion_route route on route.organization_id=i.organization_id
          and route.criterion_id=i.criterion_id
        where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
          and r.synthetic=$3 and (r.status='signed' or i.kind='overdue-unsigned') for update of i`,
      [id, scope.organizationId, dataset === "synthetic"]);
      const item = rows[0];
      if (!item) throw new NotFoundException("Review item was not found in scope");
      const previous = await manager.query<Array<{ actor_id: string; assignee_id: string;
        item_version: string }>>(`select actor_id,assignee_id,item_version
          from clinical.review_assignment_history where item_id=$1 and command_id=$2`,
      [id, command.commandId]);
      if (previous[0]) {
        if (previous[0].actor_id !== scope.userId || previous[0].assignee_id !== scope.userId ||
            Number(previous[0].item_version) !== command.expectedVersion + 1)
          throw new ConflictException("Review claim command has already been used");
      } else {
        if (Number(item.version) !== command.expectedVersion || item.status !== "new" || item.assignee_id !== null)
          throw new ConflictException("Review item changed; refresh and try again");
        if (item.independent_review && item.documenting_user_id === scope.userId)
          throw new ForbiddenException("Reviewer is not eligible for this item");
        await manager.query(`update clinical.review_item set assignee_id=$2, version=version+1,
          recovery_reason=null,updated_at=now() where id=$1 and organization_id=$3`,
        [id, scope.userId, scope.organizationId]);
        await manager.query(`insert into clinical.review_assignment_history
          (organization_id,item_id,command_id,actor_id,assignee_id,item_version)
          values ($1,$2,$3,$4,$4,$5)`,
        [scope.organizationId, id, command.commandId, scope.userId, command.expectedVersion + 1]);
      }
    });
    return this.item(token, id, command.dataset);
  }

  async routes(token: string): Promise<ReviewCriterionRoute[]> {
    const scope = reviewScope(await this.sessions.get(token));
    if (!scope.administrator) throw new ForbiddenException("Review administration is required");
    const rows = await this.database.query<Array<{ criterion_id: string; name: string; route: ReviewCriterionRoute["route"];
      named_user_id: string | null; independent_review: boolean; version: string; recovery_reason: string | null }>>(`
      with published as (
        select distinct on ((rule.value->>'ruleId')::uuid)
          (rule.value->>'ruleId')::uuid criterion_id,rule.value->>'name' name
        from validation.version v cross join lateral jsonb_array_elements(v.compiled_bundle->'rules') rule(value)
        where v.organization_id=$1 and v.status='published' and rule.value->'executionTargets' ? 'review'
        order by (rule.value->>'ruleId')::uuid,v.published_at desc
      )
      select p.criterion_id,p.name,coalesce(route.route,'unassigned') route,
        route.named_user_id,coalesce(route.independent_review,false) independent_review,
        coalesce(route.version,0)::text version,route.recovery_reason
      from (select criterion_id,name from published union all
        select clinical.review_overdue_criterion_id($1::uuid),'Overdue unsigned draft'::text) p
      left join clinical.review_criterion_route route
        on route.organization_id=$1 and route.criterion_id=p.criterion_id
      order by p.name,p.criterion_id`, [scope.organizationId]);
    return rows.map((row) => ({ criterionId: row.criterion_id, name: row.name,
      route: row.route, namedUserId: row.named_user_id, independentReview: row.independent_review,
      version: Number(row.version),
      recoveryReason: row.recovery_reason }));
  }

  async amendmentPolicy(token: string): Promise<ReviewAmendmentPolicy> {
    const scope = reviewScope(await this.sessions.get(token));
    if (!scope.administrator) throw new ForbiddenException("Review administration is required");
    const row = (await this.database.query<Array<{ clearance: ReviewAmendmentPolicy["clearance"];
      version: string }>>(`select clearance,version from clinical.review_amendment_policy
      where organization_id=$1`, [scope.organizationId]))[0];
    return { clearance: row?.clearance ?? "confirm", version: Number(row?.version ?? 0) };
  }

  async configureAmendmentPolicy(token: string, command: ConfigureReviewAmendmentPolicyCommand,
    csrfToken?: string): Promise<ReviewAmendmentPolicy> {
    if (!command || !uuid(command.commandId) || !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0 || !["confirm", "automatic"].includes(command.clearance))
      throw new BadRequestException("Invalid Review amendment policy command");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.administrator) throw new ForbiddenException("Review administration is required");
      await manager.query(`select id from app_identity.organization where id=$1 for update`,
        [scope.organizationId]);
      await manager.query(`insert into clinical.review_amendment_policy (organization_id)
        values ($1) on conflict do nothing`, [scope.organizationId]);
      const current = (await manager.query<Array<{ version: string; clearance: string }>>(`
        select version,clearance from clinical.review_amendment_policy
        where organization_id=$1 for update`, [scope.organizationId]))[0]!;
      const previous = (await manager.query<Array<{ actor_id: string; clearance: string;
        policy_version: string }>>(`select actor_id,clearance,policy_version
        from clinical.review_amendment_policy_history
        where organization_id=$1 and command_id=$2`, [scope.organizationId, command.commandId]))[0];
      if (previous) {
        if (previous.actor_id !== scope.userId || previous.clearance !== command.clearance ||
          Number(previous.policy_version) !== command.expectedVersion + 1)
          throw new ConflictException("Review amendment policy command has already been used");
        return;
      }
      if (Number(current.version) !== command.expectedVersion)
        throw new ConflictException("Review amendment policy changed; refresh and try again");
      if (current.clearance === command.clearance)
        throw new ConflictException("Review amendment policy is unchanged");
      await manager.query(`update clinical.review_amendment_policy set clearance=$2,version=version+1,
        updated_by=$3,updated_at=now() where organization_id=$1`,
      [scope.organizationId, command.clearance, scope.userId]);
      await manager.query(`insert into clinical.review_amendment_policy_history
        (organization_id,command_id,actor_id,clearance,policy_version) values ($1,$2,$3,$4,$5)`,
      [scope.organizationId, command.commandId, scope.userId, command.clearance,
        command.expectedVersion + 1]);
    });
    return this.amendmentPolicy(token);
  }

  async reviewers(token: string, itemId?: string, requestedDataset?: string): Promise<ReviewEligibleReviewer[]> {
    const scope = reviewScope(await this.sessions.get(token));
    if (!scope.administrator) throw new ForbiddenException("Review administration is required");
    let authorId: string | null = null;
    let independent = false;
    if (itemId) {
      if (!uuid(itemId)) throw new BadRequestException("Invalid Review item");
      const rows = await this.database.query<Array<{ documenting_user_id: string; independent_review: boolean }>>(`
        select r.documenting_user_id,coalesce(route.independent_review,false) independent_review
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        left join clinical.review_criterion_route route on route.organization_id=i.organization_id
          and route.criterion_id=i.criterion_id
        where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
          and r.synthetic=$3 and (r.status='signed' or i.kind='overdue-unsigned')`,
      [itemId, scope.organizationId, this.dataset(requestedDataset, scope) === "synthetic"]);
      if (!rows[0]) throw new NotFoundException("Review item was not found in scope");
      authorId = rows[0].documenting_user_id;
      independent = rows[0].independent_review;
    }
    const rows = await eligibleReviewers(this.database.manager, scope.organizationId, authorId, independent);
    return rows.filter((row) => itemId || row.all_access).map((row) =>
      ({ id: row.id, displayName: row.display_name }));
  }

  async configureRoute(token: string, criterionId: string, command: ConfigureReviewRouteCommand,
    csrfToken?: string): Promise<ReviewCriterionRoute> {
    if (!uuid(criterionId) || !command || !uuid(command.commandId) ||
      !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 ||
      !["unassigned", "author", "named"].includes(command.route) ||
      (command.route === "named" ? !uuid(command.namedUserId) : command.namedUserId !== null) ||
      typeof command.independentReview !== "boolean")
      throw new BadRequestException("Invalid Review route command");
    if (command.independentReview && command.route === "author")
      throw new BadRequestException("Independent review cannot route to the documenting clinician; choose a named reviewer or the unassigned queue");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.administrator) throw new ForbiddenException("Review administration is required");
      await manager.query(`select id from app_identity.organization where id=$1 for update`,
        [scope.organizationId]);
      const exists = await manager.query<Array<{ id: string }>>(`
        select v.id from validation.version v
        cross join lateral jsonb_array_elements(v.compiled_bundle->'rules') rule(value)
        where v.organization_id=$1 and v.status='published'
          and rule.value->>'ruleId'=$2 and rule.value->'executionTargets' ? 'review' limit 1`,
      [scope.organizationId, criterionId]);
      const systemId = (await manager.query<Array<{ id: string }>>(`
        select clinical.review_overdue_criterion_id($1::uuid) id`, [scope.organizationId]))[0]!.id;
      if (!exists[0] && criterionId !== systemId)
        throw new NotFoundException("Published Review criterion was not found");
      if (criterionId === systemId)
        await manager.query(`insert into validation.rule_identity (id, organization_id, created_by)
          values ($1,$2,$3) on conflict do nothing`,
        [criterionId, scope.organizationId, scope.userId]);
      await manager.query(`insert into clinical.review_criterion_route (organization_id,criterion_id)
        values ($1,$2) on conflict do nothing`, [scope.organizationId, criterionId]);
      const current = (await manager.query<Array<{ version: string }>>(`
        select version from clinical.review_criterion_route where organization_id=$1 and criterion_id=$2 for update`,
      [scope.organizationId, criterionId]))[0]!;
      const previous = await manager.query<Array<{ route: string; named_user_id: string | null;
        independent_review: boolean;
        route_version: string; actor_id: string | null }>>(`
        select route,named_user_id,independent_review,route_version,actor_id from clinical.review_criterion_route_history
        where organization_id=$1 and command_id=$2`, [scope.organizationId, command.commandId]);
      if (previous[0]) {
        if (previous[0].actor_id !== scope.userId || previous[0].route !== command.route ||
          previous[0].named_user_id !== command.namedUserId ||
          previous[0].independent_review !== command.independentReview ||
          Number(previous[0].route_version) !== command.expectedVersion + 1)
          throw new ConflictException("Review route command has already been used");
        return;
      }
      if (Number(current.version) !== command.expectedVersion)
        throw new ConflictException("Review route changed; refresh and try again");
      if (command.route === "named") {
        const eligible = (await eligibleReviewers(manager, scope.organizationId, null, false,
          command.namedUserId!))[0]?.all_access ?? false;
        if (!eligible) throw new BadRequestException("Named reviewer must have current organization-wide Review access");
      }
      await manager.query(`update clinical.review_criterion_route set route=$3,named_user_id=$4,
        independent_review=$5,version=version+1,recovery_reason=null,updated_by=$6,updated_at=now(),eligibility_checked_at=null
        where organization_id=$1 and criterion_id=$2`,
      [scope.organizationId, criterionId, command.route, command.namedUserId,
        command.independentReview, scope.userId]);
      await manager.query(`insert into clinical.review_criterion_route_history
        (organization_id,criterion_id,command_id,actor_id,route,named_user_id,independent_review,route_version,reason)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'configured')`,
      [scope.organizationId, criterionId, command.commandId, scope.userId,
        command.route, command.namedUserId, command.independentReview, command.expectedVersion + 1]);
    });
    const configured = (await this.routes(token)).find((route) => route.criterionId === criterionId);
    if (!configured) throw new NotFoundException("Published Review criterion was not found");
    return configured;
  }

  async assign(token: string, itemId: string, command: AssignReviewItemCommand,
    csrfToken?: string): Promise<ReviewItemDetail> {
    if (!command || !uuid(command.commandId) || !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0 || (command.assigneeId !== null && !uuid(command.assigneeId)))
      throw new BadRequestException("Invalid Review assignment command");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.administrator) throw new ForbiddenException("Review administration is required");
      await manager.query(`select id from app_identity.organization where id=$1 for share`,
        [scope.organizationId]);
      const dataset = this.dataset(command.dataset, scope);
      const rows = await manager.query<Array<{ version: string; assignee_id: string | null;
        status: string; documenting_user_id: string; independent_review: boolean }>>(`
        select i.version,i.assignee_id,i.status,r.documenting_user_id,
          coalesce(route.independent_review,false) independent_review
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        left join clinical.review_criterion_route route on route.organization_id=i.organization_id
          and route.criterion_id=i.criterion_id
        where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
          and r.synthetic=$3 and (r.status='signed' or i.kind='overdue-unsigned') for update of i`,
      [itemId, scope.organizationId, dataset === "synthetic"]);
      const item = rows[0];
      if (!item) throw new NotFoundException("Review item was not found in scope");
      const previous = await manager.query<Array<{ actor_id: string | null; assignee_id: string | null;
        item_version: string; action: string }>>(`select actor_id,assignee_id,item_version,action
        from clinical.review_assignment_history where organization_id=$1 and command_id=$2`,
      [scope.organizationId, command.commandId]);
      if (previous[0]) {
        if (previous[0].actor_id !== scope.userId || previous[0].assignee_id !== command.assigneeId ||
          previous[0].action !== "assigned" || Number(previous[0].item_version) !== command.expectedVersion + 1)
          throw new ConflictException("Review assignment command has already been used");
        return;
      }
      if (Number(item.version) !== command.expectedVersion || item.assignee_id === command.assigneeId)
        throw new ConflictException("Review item changed; refresh and try again");
      if (command.assigneeId && !await eligibleReviewer(manager, scope.organizationId,
        item.documenting_user_id, command.assigneeId, item.independent_review))
        throw new BadRequestException("Assignee needs current report access and active Review eligibility");
      await manager.query(`update clinical.review_item set assignee_id=$2,version=version+1,
        recovery_reason=null,updated_at=now(),eligibility_checked_at=null
        where id=$1 and organization_id=$3`, [itemId, command.assigneeId, scope.organizationId]);
      await manager.query(`insert into clinical.review_assignment_history
        (organization_id,item_id,command_id,actor_id,assignee_id,previous_assignee_id,item_version,action)
        values ($1,$2,$3,$4,$5,$6,$7,'assigned')`,
      [scope.organizationId, itemId, command.commandId, scope.userId,
        command.assigneeId, item.assignee_id, command.expectedVersion + 1]);
    });
    return this.item(token, itemId, command.dataset);
  }

  async outcomes(token: string): Promise<ReviewOutcomeOption[]> {
    const scope = reviewScope(await this.sessions.get(token));
    const rows = await this.database.query<Array<{ id: string; revision: number; label: string;
      meaning: string; active: boolean }>>(`
      select option.id,revision.revision,revision.label,revision.meaning,revision.active
      from clinical.review_outcome_option option join clinical.review_outcome_revision revision
        on revision.option_id=option.id and revision.revision=option.current_revision
      where option.organization_id=$1 and ($2::boolean or revision.active)
      order by revision.label,option.id`, [scope.organizationId, scope.administrator]);
    return rows.map((row) => ({ id: row.id, revision: Number(row.revision), label: row.label,
      meaning: row.meaning, active: row.active }));
  }

  async configureOutcome(token: string, command: ReviewOutcomeCommand,
    csrfToken?: string): Promise<ReviewOutcomeOption> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!command || !uuid.test(command.commandId) || (command.optionId && !uuid.test(command.optionId)) ||
      (command.optionId ? !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision! < 1 :
        command.expectedRevision !== undefined) || typeof command.label !== "string" ||
      !command.label.trim() || command.label.length > 120 || typeof command.meaning !== "string" ||
      !command.meaning.trim() || command.meaning.length > 1000 || typeof command.active !== "boolean")
      throw new BadRequestException("Invalid Review outcome command");
    const value = await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.administrator) throw new ForbiddenException("Review administration is required");
      // Serialize create/revise commands within the organization so concurrent retries see history.
      await manager.query(`select id from app_identity.organization where id=$1 for update`,
        [scope.organizationId]);
      const previous = await manager.query<Array<{ option_id: string; revision: number; label: string;
        meaning: string; active: boolean; actor_id: string }>>(`
        select option_id,revision,label,meaning,active,actor_id
        from clinical.review_outcome_revision where organization_id=$1 and command_id=$2`,
      [scope.organizationId, command.commandId]);
      if (previous[0]) {
        const row = previous[0];
        if (row.actor_id !== scope.userId || (command.optionId && row.option_id !== command.optionId) ||
          row.label !== command.label.trim() || row.meaning !== command.meaning.trim() ||
          row.active !== command.active || row.revision !== (command.expectedRevision ?? 0) + 1)
          throw new ConflictException("Review outcome command has already been used");
        return { id: row.option_id, revision: Number(row.revision), label: row.label,
          meaning: row.meaning, active: row.active };
      }
      let id = command.optionId;
      let revision = 1;
      if (id) {
        const options = await manager.query<Array<{ current_revision: number }>>(`
          select current_revision from clinical.review_outcome_option
          where id=$1 and organization_id=$2 for update`, [id, scope.organizationId]);
        if (!options[0]) throw new NotFoundException("Review outcome was not found");
        if (Number(options[0].current_revision) !== command.expectedRevision)
          throw new ConflictException("Review outcome changed; refresh and try again");
        revision = command.expectedRevision! + 1;
        await manager.query(`update clinical.review_outcome_option set current_revision=$3
          where id=$1 and organization_id=$2`, [id, scope.organizationId, revision]);
      } else {
        const created = mutationRows<{ id: string }>(await manager.query(`
          insert into clinical.review_outcome_option (organization_id)
          values ($1) returning id`, [scope.organizationId]));
        id = created[0]!.id;
      }
      await manager.query(`insert into clinical.review_outcome_revision
        (option_id,organization_id,revision,command_id,actor_id,label,meaning,active)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, scope.organizationId, revision, command.commandId, scope.userId,
        command.label.trim(), command.meaning.trim(), command.active]);
      return { id, revision, label: command.label.trim(), meaning: command.meaning.trim(),
        active: command.active };
    });
    return value;
  }

  async addComment(token: string, id: string, command: AddReviewCommentCommand,
    csrfToken?: string): Promise<ReviewItemDetail> {
    if (!uuid(id) || !command || !uuid(command.commandId) ||
      !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 ||
      typeof command.body !== "string" || command.body.trim().length < 1 ||
      command.body.length > 4000)
      throw new BadRequestException("Invalid Review comment command");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.identifying)
        throw new ForbiddenException("Review identifying access is required for unrestricted discussion");
      const dataset = this.dataset(command.dataset, scope);
      const [item] = await manager.query<Array<{ version: string; assignee_id: string | null;
        documenting_user_id: string; independent_review: boolean }>>(`
        select i.version,i.assignee_id,r.documenting_user_id,
          coalesce(route.independent_review,false) independent_review
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        left join clinical.review_criterion_route route on route.organization_id=i.organization_id
          and route.criterion_id=i.criterion_id
        where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
          and r.synthetic=$3 and (r.status='signed' or i.kind='overdue-unsigned')
          and ($4::boolean or r.documenting_user_id=$5)
        for update of i`,
      [id, scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId]);
      if (!item) throw new NotFoundException("Review item was not found in scope");
      const isClinician = item.documenting_user_id === scope.userId;
      const isCurrentReviewer = item.assignee_id === scope.userId &&
        await eligibleReviewer(manager, scope.organizationId, item.documenting_user_id,
          scope.userId, item.independent_review);
      if (!isClinician && !isCurrentReviewer && !scope.administrator)
        throw new ForbiddenException("Only the clinician, assigned reviewer, or Review administrator can comment");
      const [previous] = await manager.query<Array<{ actor_id: string; item_id: string;
        item_version: string; body: string }>>(`
        select actor_id,item_id,item_version,body from clinical.review_comment
        where organization_id=$1 and command_id=$2`, [scope.organizationId, command.commandId]);
      if (previous) {
        if (previous.item_id !== id || previous.actor_id !== scope.userId ||
          previous.body !== command.body.trim() ||
          Number(previous.item_version) !== command.expectedVersion + 1)
          throw new ConflictException("Review comment command has already been used");
        return;
      }
      if (Number(item.version) !== command.expectedVersion)
        throw new ConflictException("Review item changed; refresh and try again");
      await manager.query(`update clinical.review_item set version=version+1,updated_at=now()
        where id=$1 and organization_id=$2`, [id, scope.organizationId]);
      await manager.query(`insert into clinical.review_comment
        (organization_id,item_id,command_id,actor_id,item_version,body)
        values ($1,$2,$3,$4,$5,$6)`, [scope.organizationId, id, command.commandId,
        scope.userId, command.expectedVersion + 1, command.body.trim()]);
    });
    return this.item(token, id, command.dataset);
  }

  async progress(token: string, id: string, command: ReviewProgressCommand,
    csrfToken?: string): Promise<ReviewItemDetail> {
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!command || !validUuid.test(command.commandId) ||
      !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 ||
      !["in-review", "awaiting-clinician", "completed"].includes(command.status) ||
      (command.status === "completed" ? !command.outcomeOptionId || !validUuid.test(command.outcomeOptionId) :
        command.outcomeOptionId !== undefined)) throw new BadRequestException("Invalid Review progress command");
    await this.database.transaction(async (manager) => {
      await this.sessions.assertCsrf(token, csrfToken, manager);
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      await manager.query(`select id from app_identity.organization where id=$1 for share`,
        [scope.organizationId]);
      const dataset = this.dataset(command.dataset, scope);
      const rows = await manager.query<Array<{ version: string; status: string; kind: string;
        assignee_id: string | null;
        outcome_option_id: string | null; outcome_revision: number | null;
        documenting_user_id: string; independent_review: boolean; clearance_pending: boolean }>>(`
        select i.version,i.status,i.kind,i.assignee_id,i.outcome_option_id,i.outcome_revision,i.clearance_pending,
          r.documenting_user_id,coalesce(route.independent_review,false) independent_review
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        left join clinical.review_criterion_route route on route.organization_id=i.organization_id
          and route.criterion_id=i.criterion_id
        where i.id=$1 and i.organization_id=$2 and r.organization_id=$2
          and r.synthetic=$3 and (r.status='signed' or i.kind='overdue-unsigned')
          and ($4::boolean or r.documenting_user_id=$5)
        for update of i`, [id, scope.organizationId, dataset === "synthetic",
        scope.reports === "all", scope.userId]);
      const item = rows[0];
      if (!item) throw new NotFoundException("Review item was not found in scope");
      if (item.kind === "overdue-unsigned" && command.status === "completed")
        throw new ConflictException("Signing resolves overdue draft follow-up");
      if (item.assignee_id !== scope.userId)
        throw new ForbiddenException("Only the assigned reviewer can progress this item");
      if (item.independent_review && item.documenting_user_id === scope.userId)
        throw new ForbiddenException("Independent review requires a reviewer other than the documenting clinician");
      const previous = await manager.query<Array<{ actor_id: string; item_version: string;
        status: string; outcome_option_id: string | null }>>(`
        select actor_id,item_version,status,outcome_option_id from clinical.review_progress_history
        where item_id=$1 and command_id=$2`, [id, command.commandId]);
      if (previous[0]) {
        if (previous[0].actor_id !== scope.userId || previous[0].status !== command.status ||
          previous[0].outcome_option_id !== (command.outcomeOptionId ?? null) ||
          Number(previous[0].item_version) !== command.expectedVersion + 1)
          throw new ConflictException("Review progress command has already been used");
        return;
      }
      if (Number(item.version) !== command.expectedVersion) throw new ConflictException("Review item changed; refresh and try again");
      const transitions: Record<string, string[]> = { new: ["in-review"],
        "in-review": ["awaiting-clinician", "completed"],
        "awaiting-clinician": ["in-review", "completed"], completed: ["completed"] };
      if (!transitions[item.status]?.includes(command.status))
        throw new ConflictException("Review status transition is not allowed");
      let outcomeRevision: number | null = null;
      if (command.outcomeOptionId) {
        const outcomes = await manager.query<Array<{ revision: number }>>(`
          select revision.revision from clinical.review_outcome_option option
          join clinical.review_outcome_revision revision
            on revision.option_id=option.id and revision.revision=option.current_revision
          where option.id=$1 and option.organization_id=$2 and revision.active
          for share of option`,
        [command.outcomeOptionId, scope.organizationId]);
        if (!outcomes[0]) throw new BadRequestException("Review outcome is not active");
        outcomeRevision = Number(outcomes[0].revision);
      }
      if (item.status === "completed" && item.outcome_option_id === command.outcomeOptionId &&
        Number(item.outcome_revision) === outcomeRevision)
        throw new ConflictException("Review outcome has not changed");
      await manager.query(`update clinical.review_item set status=$3,outcome_option_id=$4,
        outcome_revision=$5,clearance_pending=case when $3='completed' then false else clearance_pending end,
        reopened=case when $3='completed' then false else reopened end,
        closure_reason=case when $3='completed' and clearance_pending then 'criterion-cleared-confirmed'
          else null end,version=version+1,updated_at=now()
        where id=$1 and organization_id=$2`, [id, scope.organizationId,
        command.status, command.outcomeOptionId ?? null, outcomeRevision]);
      await manager.query(`insert into clinical.review_progress_history
        (organization_id,item_id,command_id,actor_id,item_version,status,outcome_option_id,outcome_revision)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`, [scope.organizationId,id,command.commandId,
        scope.userId,command.expectedVersion+1,command.status,command.outcomeOptionId ?? null,outcomeRevision]);
    });
    return this.item(token, id, command.dataset);
  }

  async backlog(token: string, requestedDataset?: string) {
    const scope = reviewScope(await this.sessions.get(token));
    if (!scope.administrator) throw new ForbiddenException("Review administration is required");
    const dataset = this.dataset(requestedDataset, scope);
    const rows = await this.database.query<Array<{ id: string; report_id: string; state: string;
      attempts: number; last_error: string | null; created_at: Date | string }>>(`
      select backlog.id,backlog.report_id,backlog.state,backlog.attempts,backlog.last_error,backlog.created_at
      from (
        select w.id,w.report_id,w.state,w.attempts,w.last_error,w.created_at
        from clinical.review_work w join clinical.report r on r.id=w.report_id
        where w.organization_id=$1 and r.synthetic=$2 and w.state <> 'complete'
        union all
        select r.id,r.id,'unevaluated'::text,0,'No pinned published Validation version'::text,s.signed_at
        from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
        where r.organization_id=$1 and r.synthetic=$2 and r.status='signed'
          and s.validation_version_id is null
      ) backlog order by backlog.created_at desc limit 100`, [scope.organizationId, dataset === "synthetic"]);
    return { dataset, asOf: new Date().toISOString(), work: rows.map((row) => ({
      id: row.id, reportId: row.report_id, state: row.state, attempts: row.attempts,
      lastError: row.last_error, createdAt: new Date(row.created_at).toISOString(),
    })) };
  }

  private presentValue(row: Record<string, unknown>, label: string, identifying: boolean): ReviewReportValue | null {
    const kind = String(row.value_kind ?? "");
    // A free-text field may contain a name even when its catalog flag is false.
    if (!identifying && ["text", "uri", "binary"].includes(kind)) return null;
    const column = ({ text: "value_text", uri: "value_text", integer: "value_integer",
      numeric: "value_numeric", boolean: "value_boolean", date: "value_date",
      datetime: "value_datetime", time: "value_time", duration: "value_duration",
      coded: "code", null: "absence_code", "pertinent-negative": "absence_code" } as Record<string, string>)[kind];
    const raw = column ? row[column] : null;
    return { id: String(row.id), elementId: String(row.element_id), label,
      groupInstanceId: row.group_instance_id ? String(row.group_instance_id) : null,
      ordinal: Number(row.ordinal ?? 0), valueKind: kind,
      value: typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : null,
      ...(row.code_display ? { codeDisplay: String(row.code_display) } : {}),
      ...(row.absence_display ? { absenceDisplay: String(row.absence_display) } : {}) };
  }

  async media(token: string, id: string, noteId: string, type: "photo" | "audio", requestedDataset?: string) {
    return this.database.transaction(async (manager) => {
      const scope = reviewScope(await this.sessions.get(token, new Date(), false, manager));
      if (!scope.identifying) throw new ForbiddenException("Review identifying access is required for media");
      await this.scopedReport(manager, scope, id, this.dataset(requestedDataset, scope));
      const table = type === "photo" ? "report_photo" : "report_audio";
      const rows = await manager.query<Array<{ canonical_bytes: Buffer; content_type: string; sha256: string }>>(`
        select blob.canonical_bytes, note.content_type, note.sha256
        from clinical.${table}_note note
        join clinical.${table}_blob blob on blob.report_id = note.report_id and blob.note_id = note.id
        where note.report_id = $1 and note.id = $2 and note.organization_id = $3`,
      [id, noteId, scope.organizationId]);
      if (!rows[0]) throw new NotFoundException("Review media was not found");
      await recordMediaAccess(manager, { organizationId: scope.organizationId, reportId: id, noteId,
        mediaType: type, actorId: scope.userId });
      return { bytes: rows[0].canonical_bytes, contentType: rows[0].content_type, sha256: rows[0].sha256 };
    });
  }
}

// Review queue reads are deliberately scoped with the same boundary as report inspection.
