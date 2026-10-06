import { configuredAnalyticsLibrary, contributeConfiguredDefinition, contributeConfiguredDefinitions } from "./analytics-definitions.js";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import type { AnalyticsCatalogCounts, AnalyticsCatalogCountsRequest, AnalyticsCatalogPage, AnalyticsCatalogValue, AnalyticsDefinition, AnalyticsElement, AnalyticsResult, AnalyticsValue } from "@open-triage/contracts";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { ReviewService } from "./review.service.js";
import { reviewScope, type ReviewScope } from "./review-scope.js";
import { aggregateAnalytics, countAnalyticsRecords, matchingAnalyticsReports, validateAnalytics } from "./analytics-engine.js";
import { catalogElements, catalogLabelKey, catalogPage, catalogPagination, catalogSelectedLabels, catalogValues, recordsElement } from "./analytics-catalog.js";
import { loadAnalyticsReports } from "./analytics-source.js";
import { unifiedAnalyticsCsv } from "./analytics-csv.js";
import { AnalyticsDiscoveryCache } from "./analytics-discovery-cache.js";

@Injectable()
export class AnalyticsService {
  private readonly discoveredElements = new AnalyticsDiscoveryCache<AnalyticsElement[]>();
  private readonly discoveredValues = new AnalyticsDiscoveryCache<AnalyticsCatalogPage<AnalyticsCatalogValue>>(256);

  constructor(@InjectDataSource() private readonly database: DataSource,
    private readonly sessions: ClinicianSessionService, private readonly review: ReviewService) {}

  private discoveryElements(scope: ReviewScope, includeOperational = false) {
    return this.discoveredElements.get(JSON.stringify([scope, includeOperational]), () =>
      this.database.transaction("REPEATABLE READ", (database) => catalogElements(database, scope, undefined, includeOperational)));
  }

  async elements(token: string, search?: string, page?: string, purpose?: string) {
    const scope = reviewScope(await this.sessions.get(token));
    const pagination = catalogPagination(search, page);
    if (purpose && !["metric", "group", "filter"].includes(purpose)) throw new BadRequestException("Invalid catalog purpose");
    // Configured metrics cannot group or filter. Keep their publication checks live,
    // while sharing recorded discovery across purposes, searches and pages.
    const configured = purpose === "group" || purpose === "filter" ? [] : await this.database.transaction("REPEATABLE READ",
      async (database) => (await configuredAnalyticsLibrary(database, scope)).elements);
    const candidates = purpose === "metric" ? [recordsElement, ...configured]
      : [...configured, ...await this.discoveryElements(scope, !purpose)];
    const elements = candidates.filter((field) =>
      (purpose === "group" ? field.grouping : purpose === "filter" ? field.filtering : true) &&
      `${field.id} ${field.label}`.toLowerCase().includes(pagination.search.toLowerCase()));
    return catalogPage(elements.slice((pagination.page - 1) * 50, pagination.page * 50), elements.length, pagination.page, scope);
  }
  async values(token: string, element: string, search?: string, page?: string) {
    const scope = reviewScope(await this.sessions.get(token));
    const pagination = catalogPagination(search, page);
    const fields = await this.discoveryElements(scope);
    const field = fields.find((field) => field.id === element && field.filtering);
    if (!field) throw new BadRequestException("Recorded element is unavailable");
    return this.discoveredValues.get(JSON.stringify([scope, element, pagination.search, pagination.page]), () =>
      this.database.transaction("REPEATABLE READ", (database) => catalogValues(database, scope, field, pagination.search, pagination.page)));
  }
  async query(token: string, input: AnalyticsDefinition) {
    return (await this.calculate(token, input)).result;
  }
  async counts(token: string, input: AnalyticsCatalogCountsRequest): Promise<AnalyticsCatalogCounts> {
    const scope = reviewScope(await this.sessions.get(token));
    const selection = input?.selection;
    if (!selection || (selection.purpose === "values" ? typeof selection.element !== "string" ||
      !Array.isArray(selection.values) || selection.values.length > 50 :
      !["metric", "group", "filter"].includes(selection.purpose) || !Array.isArray(selection.ids) ||
      selection.ids.length > 50 || selection.ids.some((id) => typeof id !== "string" || id.length > 500)))
      throw new BadRequestException("Invalid catalog count selection");
    const reporting = await this.review.analyticsDatabase();
    return reporting.transaction("REPEATABLE READ", async (database) => {
      const additional = selection.purpose === "values" ? [selection.element] : selection.ids;
      const { library, fields, definition, metric, reports } = await this.prepareQuery(database, scope, input.definition, additional);
      const selected = selection.purpose === "values" ? [] : selection.ids.map((id) => {
        const field = fields.find((field) => field.id === id && (selection.purpose === "metric" ? field.id === "records" || !!field.configured :
          selection.purpose === "group" ? field.grouping : field.filtering));
        if (!field) throw new BadRequestException("Catalog element is unavailable");
        return field;
      });
      let values: AnalyticsValue[] = [];
      if (selection.purpose === "values") {
        if (!fields.some((field) => field.id === selection.element && field.filtering))
          throw new BadRequestException("Recorded element is unavailable");
        if (selection.values.length) values = validateAnalytics({ ...definition, filters: [
          ...definition.filters.filter((filter) => filter.element !== selection.element),
          { element: selection.element, values: selection.values },
        ] }, fields).filters.find((filter) => filter.element === selection.element)!.values;
      }
      const matched = matchingAnalyticsReports(reports, definition);
      await contributeConfiguredDefinitions(database, scope, matched, [metric, ...selected], library);
      const population = countAnalyticsRecords(matched, definition, metric);
      return { ...population, elements: selected.map((field) => {
        // Candidate metrics use their own units and applicability, independently of the current metric.
        const candidate = selection.purpose === "metric" ? { ...definition, metric: field.id, unit: undefined, reducer: undefined } : definition;
        return { id: field.id, included: countAnalyticsRecords(matched, candidate,
          selection.purpose === "metric" ? field : metric, selection.purpose === "metric" ? undefined : field.id).included };
      }), values: selection.purpose === "values" ? values.map((identity) => ({ identity,
        included: countAnalyticsRecords(matched, definition, metric, selection.element, identity).included })) : [] };
    });
  }
  private async prepareQuery(database: EntityManager, scope: ReviewScope, input: AnalyticsDefinition, additionalElements: string[] = []) {
    const library = await configuredAnalyticsLibrary(database, scope);
    // Configured definitions and Records have authoritative metadata without
    // recorded-field discovery. Only selected clinical fields need that scan.
    const selectedIds = [input?.metric, input?.groupBy,
      ...(Array.isArray(input?.filters) ? input.filters.map((filter) => filter?.element) : []), ...additionalElements];
    const needsRecordedFields = selectedIds.some((id) => id && id !== "records" && !/^(metric|rule):/.test(id));
    const recordedFields = needsRecordedFields ? await catalogElements(database, scope,
      selectedIds.filter((id): id is string => typeof id === "string" && id !== "records" && !/^(metric|rule):/.test(id))) : [recordsElement];
    const fields = [...library.elements, ...recordedFields];
    if (/^(metric|rule):/.test(input?.metric ?? "") && !fields.some((field) => field.id === input.metric))
      throw new ConflictException("Configured definition changed or is unavailable; select it again");
    const definition = validateAnalytics(input, fields);
    const metric = fields.find((field) => field.id === definition.metric)!;
    const [health] = await database.query<Array<{ observed_at: Date; oldest_backlog_age_seconds: string | null;
      persistent_failure_count: number; retrying_count: number; stale_run_count: number; last_run_status: string | null;
      is_read_only_replica: boolean; replay_lag_seconds: string | null }>>(`select h.*,r.is_read_only_replica,r.replay_lag_seconds
        from operations.projection_health h cross join operations.reporting_replica_health r`);
    if (!health) throw new ConflictException("Analytical freshness is unavailable; retry after projection completes");
    const backlog = health.oldest_backlog_age_seconds === null ? null : Number(health.oldest_backlog_age_seconds);
    const lag = health.replay_lag_seconds === null ? null : Number(health.replay_lag_seconds);
    if (Number(health.persistent_failure_count) || Number(health.retrying_count) || Number(health.stale_run_count) ||
      ["failed", "partial"].includes(health.last_run_status ?? "") || backlog !== null && backlog > 300 ||
      process.env.REVIEW_REPORTING_REPLICA_DATABASE_URL && (!health.is_read_only_replica || lag === null || lag > 300))
      throw new ConflictException("Analytical data is stale; retry after projection completes");
    const [region] = await database.query<Array<{ time_zone: string; start: Date; end_exclusive: Date }>>(`
      select coalesce(s.time_zone,o.deployment_timezone,'UTC') time_zone,
        $2::date::timestamp at time zone coalesce(s.time_zone,o.deployment_timezone,'UTC') start,
        ($3::date+1)::timestamp at time zone coalesce(s.time_zone,o.deployment_timezone,'UTC') end_exclusive
      from app_identity.organization o left join app_identity.agency_settings s on s.organization_id=o.id where o.id=$1`,
    [scope.organizationId, definition.from, definition.through]);
    if (!region) throw new BadRequestException("Agency reporting timezone is unavailable");
    const reports = await loadAnalyticsReports(database, scope, definition, fields, additionalElements);
    return { library, fields, definition, metric, health, backlog, lag, region, reports };
  }
  private async calculate(token: string, input: AnalyticsDefinition) {
    const scope = reviewScope(await this.sessions.get(token));
    const reporting = await this.review.analyticsDatabase();
    return reporting.transaction("REPEATABLE READ", async (database) => {
      const { library, fields, definition, metric, health, backlog, lag, region, reports: availableReports } = await this.prepareQuery(database, scope, input);
      // Apply clinical filters before evaluating configured metrics/rules or
      // resolving labels, as picker counts already do. Excluded reports cannot
      // contribute to a graph and must not consume its clinical-input budget.
      const reports = matchingAnalyticsReports(availableReports, definition);
      await contributeConfiguredDefinition(database, scope, reports, metric, library);
      const labels = await catalogSelectedLabels(database, scope, [
        ...definition.filters.flatMap((filter) => filter.values.map((identity) => ({ element: filter.element, identity }))),
        // Standard codes can have a recorded display without a value-set option.
        // Resolve them through the same scoped label lookup as the value picker.
        ...reports.flatMap((report) => report.values.flatMap((value) => value.value && (value.value.type === "code" || value.element.startsWith("custom:"))
          ? [{ element: value.element, identity: value.value }] : [])),
      ]);
      for (const report of reports) for (const value of report.values) if (value.value)
        value.label = labels.get(catalogLabelKey(value.element, value.value)) ?? value.label;
      const { contributions, ...aggregate } = aggregateAnalytics(reports, definition, metric);
      const filters = [];
      for (const filter of definition.filters) {
        const element = fields.find((field) => field.id === filter.element)!;
        // Selected identities may have disappeared since discovery. They remain a
        // valid empty population, with their original typed code as fallback label.
        const values = filter.values.map((identity) => ({ identity,
          label: labels.get(catalogLabelKey(filter.element, identity)) ?? String(identity.value) }));
        filters.push({ element, values });
      }
      const result: AnalyticsResult = { definition, metric, group: fields.find((field) => field.id === definition.groupBy) ?? null, filters,
        population: { unit: "patient-report", scope: scope.reports, organizationId: scope.organizationId, signedOnly: true, dataset: scope.defaultDataset },
        timeZone: region.time_zone, interval: { start: new Date(region.start).toISOString(), endExclusive: new Date(region.end_exclusive).toISOString() },
        freshness: { status: "current", observedAt: new Date(health.observed_at).toISOString(), targetSeconds: 300,
          oldestBacklogSeconds: backlog, replicaLagSeconds: lag },
        ...aggregate, unit: definition.aggregation === "percentage" ? "%" : metric.kind === "numeric" ? definition.unit ?? metric.unit : null,
        ...(metric.configured ? { evidence: contributions.flatMap((row) => row.occurrences.flatMap((occurrence) => occurrence.evidence ? [{
          reportId: row.reportId, reportingDate: row.date, evaluation: occurrence.evidence,
        }] : [])) } : {}),
        exportRevision: "" };
      // Observation wall-clock changes alone do not invalidate a coherent source.
      // Every contributing value, selected source revision and authorization scope does.
      result.exportRevision = createHash("sha256").update(JSON.stringify({ ...result, freshness: { status: result.freshness.status },
        scope, reports: reports.map((report) => [report.id, report.revision]), contributions })).digest("hex");
      return { result, contributions };
    });
  }
  async export(token: string, command: { definition: AnalyticsDefinition; expectedRevision: string; kind: "aggregate" | "records" }) {
    if (!command || !["aggregate", "records"].includes(command.kind) || !/^[a-f0-9]{64}$/.test(command.expectedRevision ?? ""))
      throw new BadRequestException("Invalid analytics export request");
    const { result, contributions } = await this.calculate(token, command.definition);
    if (result.exportRevision !== command.expectedRevision)
      throw new ConflictException({ message: "Analytical source changed; review the refreshed result before exporting", result });
    return unifiedAnalyticsCsv(result, contributions, command.kind);
  }
}
