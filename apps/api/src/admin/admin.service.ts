import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AdminContext } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type ActiveConfigurationRow = {
  form_version_id: string;
  form_id: string;
  form_name: string;
  form_version: number;
  catalog_release_id: string;
  catalog_standard: string;
  catalog_version: string;
};

type DashboardRow = {
  available_calls: string | number;
  ongoing_reports: string | number;
  signed_reports: string | number;
  signed_last_24_hours: string | number;
  reports_with_errors: string | number;
  active_users: string | number;
  active_units: string | number;
  database_size_bytes: string | number;
  database_connections: string | number;
  max_database_connections: string | number;
};

@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async context(sessionToken: string): Promise<AdminContext> {
    const session = await this.sessions.requireCapability(sessionToken, "installation:administer");
    const rows = await this.dataSource.query<ActiveConfigurationRow[]>(`
      select fv.id as form_version_id, f.id as form_id, f.name as form_name,
             fv.version as form_version, cr.id as catalog_release_id,
             cr.standard as catalog_standard, cr.version as catalog_version
      from forms.form f
      join forms.form_version fv on fv.form_id = f.id and fv.status = 'published'
      join forms.agency_stationary_default active on active.organization_id = f.organization_id
        and active.form_version_id = fv.id
      join catalog.release cr on cr.id = fv.catalog_release_id
      where f.organization_id = $1
      limit 1
    `, [session.organization.id]);
    const active = rows[0];
    const dashboardRows = await this.dataSource.query<DashboardRow[]>(`
      with report_stats as (
        select count(*) filter (where status = 'draft') as ongoing_reports,
               count(*) filter (where status = 'signed') as signed_reports,
               count(*) filter (where status = 'signed' and updated_at >= now() - interval '24 hours') as signed_last_24_hours
        from clinical.report where organization_id = $1
      ), error_stats as (
        select count(*) as reports_with_errors from clinical.report report
        where report.organization_id = $1 and report.status = 'draft' and exists (
          select 1 from clinical.validation_finding finding
          where finding.report_id = report.id and finding.revision = report.revision and finding.severity = 'error'
        )
      )
      select (select count(*) from clinical.call_assignment where organization_id = $1 and status = 'assigned') as available_calls,
             report_stats.ongoing_reports, report_stats.signed_reports, report_stats.signed_last_24_hours,
             error_stats.reports_with_errors,
             (select count(*) from app_identity.app_user where organization_id = $1 and active) as active_users,
             (select count(*) from app_identity.operational_unit where organization_id = $1 and active) as active_units,
             pg_database_size(current_database()) as database_size_bytes,
             (select count(*) from pg_stat_activity where datname = current_database()) as database_connections,
             current_setting('max_connections')::integer as max_database_connections
      from report_stats cross join error_stats
    `, [session.organization.id]);
    const dashboard = dashboardRows[0]!;
    return {
      owner: session.user,
      organization: session.organization,
      activeConfiguration: active ? {
        catalog: {
          id: active.catalog_release_id,
          standard: active.catalog_standard,
          version: active.catalog_version
        },
        stationaryForm: {
          id: active.form_version_id,
          formId: active.form_id,
          name: active.form_name,
          version: active.form_version
        }
      } : null,
      dashboard: {
        availableCalls: Number(dashboard.available_calls),
        ongoingReports: Number(dashboard.ongoing_reports),
        signedReports: Number(dashboard.signed_reports),
        signedLast24Hours: Number(dashboard.signed_last_24_hours),
        reportsWithErrors: Number(dashboard.reports_with_errors),
        activeUsers: Number(dashboard.active_users),
        activeUnits: Number(dashboard.active_units),
        databaseSizeBytes: Number(dashboard.database_size_bytes),
        databaseConnections: Number(dashboard.database_connections),
        maxDatabaseConnections: Number(dashboard.max_database_connections),
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
