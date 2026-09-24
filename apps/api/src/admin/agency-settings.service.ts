import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
  type AgencyMediaSettings,
  type UpdateAgencyMediaSettingsCommand,
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { mutationRows } from "../database/mutation-result.js";

type SettingsRow = {
  organization_id: string;
  report_media_allowance_bytes: string | number;
  revision: string | number;
  updated_at: Date | string;
};

@Injectable()
export class AgencySettingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService,
  ) {}

  async get(sessionToken: string): Promise<AgencyMediaSettings> {
    const session = await this.sessions.requireCapability(sessionToken, "settings:read");
    const rows = await this.dataSource.query<SettingsRow[]>(`
      select organization.id as organization_id,
             coalesce(settings.report_media_allowance_bytes, $2::bigint) as report_media_allowance_bytes,
             coalesce(settings.revision, 1) as revision,
             coalesce(settings.updated_at, organization.created_at) as updated_at
      from app_identity.organization organization
      left join app_identity.agency_settings settings on settings.organization_id = organization.id
      where organization.id = $1
    `, [session.organization.id, DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES]);
    if (!rows[0]) throw new NotFoundException("Agency Settings were not found");
    return this.present(rows[0]);
  }

  async update(sessionToken: string, command: UpdateAgencyMediaSettingsCommand): Promise<AgencyMediaSettings> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.sessions.requireCapability(sessionToken, "settings:write", manager);
      await manager.query(`
        insert into app_identity.agency_settings (organization_id)
        values ($1) on conflict (organization_id) do nothing
      `, [session.organization.id]);
      const currentRows = await manager.query<SettingsRow[]>(`
        select organization_id, report_media_allowance_bytes, revision, updated_at
        from app_identity.agency_settings where organization_id = $1 for update
      `, [session.organization.id]);
      const current = currentRows[0];
      if (!current) throw new NotFoundException("Agency Settings were not found");
      const actualRevision = Number(current.revision);
      if (actualRevision !== command.expectedRevision) {
        throw new ConflictException({
          message: "Agency Settings revision is stale",
          expectedRevision: command.expectedRevision,
          actualRevision,
        });
      }
      if (Number(current.report_media_allowance_bytes) === command.reportMediaAllowanceBytes) {
        return this.present(current);
      }
      const updatedRows = mutationRows<SettingsRow>(await manager.query(`
        update app_identity.agency_settings
        set report_media_allowance_bytes = $3, revision = revision + 1,
            updated_at = clock_timestamp(), updated_by = $4
        where organization_id = $1 and revision = $2
        returning organization_id, report_media_allowance_bytes, revision, updated_at
      `, [session.organization.id, command.expectedRevision, command.reportMediaAllowanceBytes, session.user.id]));
      const updated = updatedRows[0];
      if (!updated) throw new ConflictException("Agency Settings revision is stale");
      await this.audit(manager, session.organization.id, session.user.id, current, updated);
      return this.present(updated);
    });
  }

  private async audit(manager: Pick<EntityManager, "query">, organizationId: string, actorId: string,
    prior: SettingsRow, updated: SettingsRow): Promise<void> {
    await manager.query(`
      insert into app_identity.agency_settings_change_event
        (organization_id, actor_id, prior_revision, revision,
         old_report_media_allowance_bytes, new_report_media_allowance_bytes)
      values ($1, $2, $3, $4, $5, $6)
    `, [organizationId, actorId, prior.revision, updated.revision,
      prior.report_media_allowance_bytes, updated.report_media_allowance_bytes]);
  }

  private present(row: SettingsRow): AgencyMediaSettings {
    const reportMediaAllowanceBytes = Number(row.report_media_allowance_bytes);
    return {
      organizationId: row.organization_id,
      reportMediaAllowanceBytes,
      revision: Number(row.revision),
      defaultReportMediaAllowanceBytes: DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
      storageGrowthWarning: reportMediaAllowanceBytes > DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
