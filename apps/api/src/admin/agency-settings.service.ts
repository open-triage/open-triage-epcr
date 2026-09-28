import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  DEFAULT_AGENCY_APPEARANCE,
  DEFAULT_IMAGE_MEDIA_LIMIT_BYTES,
  DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
  type AgencyAppearance,
  type AgencyDemographics,
  type AgencyMediaSettings,
  type PublicInstallationConfiguration,
  type UpdateAgencyMediaSettingsCommand,
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { selectedInstallationSettings } from "../config/installation-settings.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { mutationRows } from "../database/mutation-result.js";

type SettingsRow = {
  organization_id: string;
  language: "en" | "sv";
  regional_format: "en-US" | "sv-SE" | null;
  report_media_allowance_bytes: string | number;
  image_media_limit_bytes: string | number;
  brand_text: string;
  helper_text: string;
  logo_png_data_url: string | null;
  accent_color: string;
  accent_dark_color: string;
  browser_theme_color: string;
  pwa_background_color: string;
  pwa_name: string;
  pwa_short_name: string;
  revision: string | number;
  updated_at: Date | string;
};

type DemographicRow = {
  id: string;
  catalog_release_id: string;
  version: string | number;
  dagency_01: string;
  dagency_02: string;
  dagency_04: string;
  dagency_04_display: string | null;
  dagency_04_system: string | null;
  dagency_04_terminology_version: string | null;
  definition_sha256: string;
  effective_from: Date | string;
};

@Injectable()
export class AgencySettingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService,
  ) {}

  async publicConfiguration(): Promise<PublicInstallationConfiguration> {
    const rows = await this.dataSource.query<SettingsRow[]>(`
      select settings.* from app_identity.agency_settings settings
      join app_identity.organization organization on organization.id = settings.organization_id
      order by organization.created_at, organization.id limit 1
    `);
    const appearance = rows[0] ? this.appearance(rows[0]) : { ...DEFAULT_AGENCY_APPEARANCE };
    const settings = selectedInstallationSettings();
    return { settings: { ...settings, language: rows[0]?.language ?? "en", regionalFormat: rows[0]?.regional_format ?? null, signIn: {
      brandText: appearance.brandText, helperText: appearance.helperText,
    } }, appearance };
  }

  async get(sessionToken: string): Promise<AgencyMediaSettings> {
    const session = await this.sessions.requireCapability(sessionToken, "settings:read");
    const settings = await this.settings(this.dataSource, session.organization.id);
    const demographic = await this.demographic(this.dataSource, session.organization.id);
    if (!settings || !demographic) throw new NotFoundException("Agency Settings were not found");
    return this.present(settings, demographic);
  }

  async update(sessionToken: string, command: UpdateAgencyMediaSettingsCommand): Promise<AgencyMediaSettings> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.sessions.requireCapability(sessionToken, "settings:write", manager);
      await manager.query(`insert into app_identity.agency_settings (organization_id)
        values ($1) on conflict (organization_id) do nothing`, [session.organization.id]);
      const currentSettings = await this.settings(manager, session.organization.id, true);
      const currentDemographic = await this.demographic(manager, session.organization.id);
      if (!currentSettings || !currentDemographic) throw new NotFoundException("Agency Settings were not found");
      const actualRevision = Number(currentSettings.revision);
      if (actualRevision !== command.expectedRevision) {
        throw new ConflictException({ message: "Agency Settings revision is stale",
          expectedRevision: command.expectedRevision, actualRevision });
      }
      const appearanceChanged = JSON.stringify(this.appearance(currentSettings)) !== JSON.stringify(command.appearance);
      const demographicChanged = !this.sameDemographic(currentDemographic, command.demographics);
      if (Number(currentSettings.report_media_allowance_bytes) === command.reportMediaAllowanceBytes &&
          Number(currentSettings.image_media_limit_bytes) === command.imageMediaLimitBytes &&
          currentSettings.language === command.language &&
          currentSettings.regional_format === (command.regionalFormat === undefined ? currentSettings.regional_format : command.regionalFormat) && !appearanceChanged && !demographicChanged) return this.present(currentSettings, currentDemographic);

      const updatedRows = mutationRows<SettingsRow>(await manager.query(`
        update app_identity.agency_settings set
          report_media_allowance_bytes = $3, image_media_limit_bytes = $4,
          brand_text = $5, helper_text = $6, language = $15, regional_format = $16,
          logo_png_data_url = $7, accent_color = $8, accent_dark_color = $9,
          browser_theme_color = $10, pwa_background_color = $11, pwa_name = $12,
          pwa_short_name = $13, revision = revision + 1,
          updated_at = clock_timestamp(), updated_by = $14
        where organization_id = $1 and revision = $2 returning *
      `, [session.organization.id, command.expectedRevision, command.reportMediaAllowanceBytes,
        command.imageMediaLimitBytes,
        command.appearance.brandText, command.appearance.helperText, command.appearance.logoPngDataUrl,
        command.appearance.accentColor, command.appearance.accentDarkColor,
        command.appearance.browserThemeColor, command.appearance.pwaBackgroundColor,
        command.appearance.pwaName, command.appearance.pwaShortName, session.user.id, command.language, command.regionalFormat === undefined ? currentSettings.regional_format : command.regionalFormat]));
      const updated = updatedRows[0];
      if (!updated) throw new ConflictException("Agency Settings revision is stale");
      const updatedDemographic = demographicChanged
        ? await this.appendDemographic(manager, session.organization.id, session.user.id, Number(updated.revision),
            currentDemographic, command.demographics)
        : currentDemographic;
      await this.audit(manager, session.organization.id, session.user.id, currentSettings, updated);
      return this.present(updated, updatedDemographic);
    });
  }

  private settings(source: Pick<DataSource, "query"> | Pick<EntityManager, "query">, organizationId: string,
    lock = false): Promise<SettingsRow | undefined> {
    return source.query<SettingsRow[]>(`select * from app_identity.agency_settings
      where organization_id = $1${lock ? " for update" : ""}`, [organizationId]).then((rows) => rows[0]);
  }

  private demographic(source: Pick<DataSource, "query"> | Pick<EntityManager, "query">,
    organizationId: string): Promise<DemographicRow | undefined> {
    return source.query<DemographicRow[]>(`select * from app_identity.agency_demographic_version
      where organization_id = $1 and effective_from <= clock_timestamp()
      order by effective_from desc, version desc limit 1`, [organizationId]).then((rows) => rows[0]);
  }

  private async appendDemographic(manager: Pick<EntityManager, "query">, organizationId: string, actorId: string,
    settingsRevision: number, prior: DemographicRow,
    candidate: UpdateAgencyMediaSettingsCommand["demographics"]): Promise<DemographicRow> {
    const id = randomUUID();
    const version = Number(prior.version) + 1;
    const definition = { dagency01: candidate.agencyUniqueStateId, dagency02: candidate.agencyNumber,
      dagency04: candidate.stateCode, dagency04Display: candidate.stateDisplay,
      dagency04System: candidate.stateCodeSystem, dagency04TerminologyVersion: candidate.stateTerminologyVersion };
    const definitionSha256 = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
    const rows = mutationRows<DemographicRow>(await manager.query(`insert into app_identity.agency_demographic_version
      (id, organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04,
       dagency_04_display, dagency_04_system, dagency_04_terminology_version,
       definition_sha256, effective_from, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp(),$12) returning *`,
    [id, organizationId, prior.catalog_release_id, version,
      candidate.agencyUniqueStateId, candidate.agencyNumber, candidate.stateCode, candidate.stateDisplay,
      candidate.stateCodeSystem, candidate.stateTerminologyVersion, definitionSha256, actorId]));
    const inserted = rows[0];
    if (!inserted) throw new Error("The agency demographic version could not be created");
    await manager.query(`insert into app_identity.agency_demographic_change_event
      (organization_id,actor_id,settings_revision,prior_version_id,version_id,catalog_release_id,
       old_definition_sha256,new_definition_sha256,old_dagency_01,new_dagency_01,
       old_dagency_02,new_dagency_02,old_dagency_04,new_dagency_04,
       old_dagency_04_display,new_dagency_04_display,old_dagency_04_system,new_dagency_04_system,
       old_dagency_04_terminology_version,new_dagency_04_terminology_version)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [organizationId, actorId, settingsRevision, prior.id, inserted.id, prior.catalog_release_id,
      prior.definition_sha256, inserted.definition_sha256, prior.dagency_01, inserted.dagency_01,
      prior.dagency_02, inserted.dagency_02, prior.dagency_04, inserted.dagency_04,
      prior.dagency_04_display, inserted.dagency_04_display, prior.dagency_04_system,
      inserted.dagency_04_system, prior.dagency_04_terminology_version,
      inserted.dagency_04_terminology_version]);
    return inserted;
  }

  private async audit(manager: Pick<EntityManager, "query">, organizationId: string, actorId: string,
    prior: SettingsRow, updated: SettingsRow): Promise<void> {
    const oldAppearance = this.appearance(prior);
    const newAppearance = this.appearance(updated);
    await manager.query(`insert into app_identity.agency_settings_change_event
      (organization_id,actor_id,prior_revision,revision,
       old_report_media_allowance_bytes,new_report_media_allowance_bytes,
       old_image_media_limit_bytes,new_image_media_limit_bytes,
       old_brand_text,new_brand_text,old_helper_text,new_helper_text,
       old_logo_sha256,new_logo_sha256,old_accent_color,new_accent_color,
       old_accent_dark_color,new_accent_dark_color,old_browser_theme_color,new_browser_theme_color,
       old_pwa_background_color,new_pwa_background_color,old_pwa_name,new_pwa_name,
       old_pwa_short_name,new_pwa_short_name,old_language,new_language,old_regional_format,new_regional_format)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
    [organizationId, actorId, prior.revision, updated.revision,
      prior.report_media_allowance_bytes, updated.report_media_allowance_bytes,
      prior.image_media_limit_bytes, updated.image_media_limit_bytes,
      oldAppearance.brandText, newAppearance.brandText, oldAppearance.helperText, newAppearance.helperText,
      this.logoSha256(oldAppearance.logoPngDataUrl), this.logoSha256(newAppearance.logoPngDataUrl),
      oldAppearance.accentColor, newAppearance.accentColor,
      oldAppearance.accentDarkColor, newAppearance.accentDarkColor,
      oldAppearance.browserThemeColor, newAppearance.browserThemeColor,
      oldAppearance.pwaBackgroundColor, newAppearance.pwaBackgroundColor,
      oldAppearance.pwaName, newAppearance.pwaName,
      oldAppearance.pwaShortName, newAppearance.pwaShortName, prior.language, updated.language,
      prior.regional_format, updated.regional_format]);
  }

  private logoSha256(value: string | null): string | null {
    return value ? createHash("sha256").update(value).digest("hex") : null;
  }

  private appearance(row: SettingsRow): AgencyAppearance {
    return { brandText: row.brand_text, helperText: row.helper_text, logoPngDataUrl: row.logo_png_data_url,
      accentColor: row.accent_color, accentDarkColor: row.accent_dark_color,
      browserThemeColor: row.browser_theme_color, pwaBackgroundColor: row.pwa_background_color,
      pwaName: row.pwa_name, pwaShortName: row.pwa_short_name };
  }

  private sameDemographic(row: DemographicRow, candidate: UpdateAgencyMediaSettingsCommand["demographics"]): boolean {
    return row.dagency_01 === candidate.agencyUniqueStateId && row.dagency_02 === candidate.agencyNumber &&
      row.dagency_04 === candidate.stateCode && row.dagency_04_display === candidate.stateDisplay &&
      row.dagency_04_system === candidate.stateCodeSystem &&
      row.dagency_04_terminology_version === candidate.stateTerminologyVersion;
  }

  private present(row: SettingsRow, demographic: DemographicRow): AgencyMediaSettings {
    const reportMediaAllowanceBytes = Number(row.report_media_allowance_bytes);
    const demographics: AgencyDemographics = {
      versionId: demographic.id, version: Number(demographic.version), catalogReleaseId: demographic.catalog_release_id,
      agencyUniqueStateId: demographic.dagency_01, agencyNumber: demographic.dagency_02,
      stateCode: demographic.dagency_04, stateDisplay: demographic.dagency_04_display,
      stateCodeSystem: demographic.dagency_04_system,
      stateTerminologyVersion: demographic.dagency_04_terminology_version,
      effectiveFrom: new Date(demographic.effective_from).toISOString(),
    };
    return { organizationId: row.organization_id, language: row.language, regionalFormat: row.regional_format, reportMediaAllowanceBytes,
      imageMediaLimitBytes: Number(row.image_media_limit_bytes),
      appearance: this.appearance(row), demographics, revision: Number(row.revision),
      defaultReportMediaAllowanceBytes: DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
      defaultImageMediaLimitBytes: DEFAULT_IMAGE_MEDIA_LIMIT_BYTES,
      storageGrowthWarning: reportMediaAllowanceBytes > DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES,
      updatedAt: new Date(row.updated_at).toISOString() };
  }
}
