import { Controller, Get } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  SYNTHETIC_DEMO_FIXTURE,
  type PublicInstallationConfiguration,
} from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { selectedInstallationSettings } from "./installation-settings.js";

type ActiveFixtureRow = {
  id: string;
  version: number;
  definition_sha256: string;
  section_count: string;
  field_count: string;
};

@Controller("installation")
export class InstallationController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async get(): Promise<PublicInstallationConfiguration> {
    const settings = selectedInstallationSettings();
    if (!settings.syntheticFixtures.enabled) return { profile: "production", settings };

    const rows = await this.dataSource.query<ActiveFixtureRow[]>(`
      select fv.id, fv.version, fv.definition_sha256,
        (select count(*) from forms.form_section fs where fs.form_version_id = fv.id) as section_count,
        (select count(*) from forms.form_field ff where ff.form_version_id = fv.id) as field_count
      from forms.agency_stationary_default active
      join forms.form_version fv on fv.id = active.form_version_id
      join forms.form f on f.id = fv.form_id
      where active.organization_id = $1 and fv.id = $2
      limit 1
    `, [SYNTHETIC_DEMO_FIXTURE.organizationId, SYNTHETIC_DEMO_FIXTURE.formVersionId]);
    const active = rows[0];
    return {
      profile: "synthetic-demo",
      settings,
      demoLogin: {
        username: SYNTHETIC_DEMO_FIXTURE.administratorUsername,
        password: SYNTHETIC_DEMO_FIXTURE.password,
      },
      fixture: {
        id: SYNTHETIC_DEMO_FIXTURE.id,
        revision: SYNTHETIC_DEMO_FIXTURE.revision,
        activeFormVersionId: active?.id ?? null,
        activeFormVersion: active?.version ?? null,
        activeFormDefinitionSha256: active?.definition_sha256 ?? null,
        sectionCount: Number(active?.section_count ?? 0),
        fieldCount: Number(active?.field_count ?? 0),
      },
    };
  }
}
