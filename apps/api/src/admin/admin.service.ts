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
      } : null
    };
  }
}
