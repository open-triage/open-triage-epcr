import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ReviewSignedReport, ReviewSignedReportsResponse, ReviewReportValue, ReviewVolumeResult, ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { reportTextNotes } from "../reports/report-note.persistence.js";
import { recordMediaAccess } from "../reports/report-note-collaboration.js";
import { reviewScope } from "./review-scope.js";
import type { ReviewScope } from "./review-scope.js";
import { reviewFields, repeatedReviewFields } from "./review-fields.js";
import { reduceRepeated, type RepeatedRow } from "./review-repeated.js";

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

  analysisFields(token: string): Promise<ReviewAnalysisField[]> {
    return this.sessions.get(token).then((session) => {
      reviewScope(session);
      return [...reviewFields, ...repeatedReviewFields].map((field) => ({ ...field,
        operations: field.kind === "categorical" ? ["distribution"] :
          ["mean", "median", "minimum", "maximum"] }));
    });
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
    const field = [...reviewFields, ...repeatedReviewFields].find((candidate) => candidate.id === input.fieldId);
    const groupField = input.groupBy ? reviewFields.find((candidate) => candidate.id === input.groupBy) : undefined;
    const filter = input.filters.field;
    const filterField = filter ? [...reviewFields, ...repeatedReviewFields].find((candidate) => candidate.id === filter.id) : undefined;
    if (!field || (input.groupBy && (!groupField || groupField.kind !== "categorical")) ||
      (filter && (!filterField || filterField.kind !== "categorical" ||
        typeof filter.value !== "string" || !filter.value || filter.value.length > 256))) {
      throw new BadRequestException("Review field is not permitted");
    }
    if (field.kind === "categorical" ? input.operation !== "distribution" :
      !["mean", "median", "minimum", "maximum"].includes(input.operation)) {
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
    const metadata: ReviewAnalysisField = { ...field,
      operations: field.kind === "categorical" ? ["distribution"] : ["mean", "median", "minimum", "maximum"] };
    const population = { unit: "patient-report" as const, scope: scope.reports,
      organizationId: scope.organizationId, signedOnly: true as const };
    if (!current) return { definition, field: metadata, population, freshness, groups: [] };
    if ("repeating" in field && field.repeating) {
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
      return { id, reportingDate: report.reporting_date, signedAt: new Date(report.signed_at).toISOString(),
        amendmentSequence: changes.at(-1)?.sequence ?? 0, identifying: scope.identifying,
        groups: groups.map((group) => ({ id: group.id, parentGroupInstanceId: group.parent_group_instance_id,
          groupId: group.group_id, label: group.label, ordinal: Number(group.ordinal) })), values, notes };
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
    if (filters.status && !["new", "in-review", "resolved"].includes(filters.status))
      throw new BadRequestException("Invalid Review status");
    for (const value of [filters.from, filters.to]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException("Invalid Review date");
    const params = [scope.organizationId, dataset === "synthetic", scope.reports === "all", scope.userId,
      filters.criterion ?? null, filters.priority ?? null, filters.status ?? null,
      filters.from ?? null, filters.to ?? null];
    const where = `i.organization_id=$1 and r.organization_id=$1 and r.synthetic=$2 and r.status='signed'
      and ($3::boolean or r.documenting_user_id=$4)
      and ($5::uuid is null or i.criterion_id=$5) and ($6::text is null or i.priority=$6)
      and ($7::text is null or i.status=$7)
      and ($8::date is null or r.reporting_date >= $8)
      and ($9::date is null or r.reporting_date <= $9)`;
    const [counts, rows] = await Promise.all([
      this.database.query<Array<{ total: string }>>(`select count(*)::text total from clinical.review_item i
        join clinical.report r on r.id=i.report_id where ${where}`, params),
      this.database.query<Array<{ id: string; report_id: string; criterion_id: string; priority: string;
        status: string; assignee_id: string | null; first_matched_at: Date | string;
        reporting_date: string; signed_at: Date | string; findings: unknown }>>(`
        select i.id,i.report_id,i.criterion_id,i.priority,i.status,i.assignee_id,i.first_matched_at,
          r.reporting_date,s.signed_at,
          (select e.findings from clinical.review_item_evidence e where e.item_id=i.id
            order by e.recorded_at desc,e.id desc limit 1) findings
        from clinical.review_item i join clinical.report r on r.id=i.report_id
        join clinical.signed_snapshot s on s.report_id=r.id
        where ${where} order by i.first_matched_at desc,i.id desc limit $10 offset $11`,
      [...params, pageSize, offset]),
    ]);
    return { dataset, page, pageSize, total: Number(counts[0]?.total ?? 0),
      asOf: new Date().toISOString(), items: rows.map((row) => ({
        id: row.id, reportId: row.report_id, criterionId: row.criterion_id, priority: row.priority,
        status: row.status, assigneeId: row.assignee_id, firstMatchedAt: new Date(row.first_matched_at).toISOString(),
        reportingDate: row.reporting_date, signedAt: new Date(row.signed_at).toISOString(),
        findings: row.findings ?? [],
      })) };
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
