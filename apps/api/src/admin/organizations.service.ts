import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type { AgencyDirectory, AgencyConfigurationOption, AgencySummary, CreateAgencyCommand, UpdateAgencyCommand } from "@open-triage/contracts";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { agencySummary, type AgencyRow } from "../sessions/agency-directory.service.js";
import { AgencySettingsService } from "./agency-settings.service.js";
import { validateUpdateAgencyMediaSettings } from "./agency-settings.validation.js";
import { agencyCatalogEligibility } from "./agency-catalog.js";
import { agencyHostnameSuffix } from "./organizations.validation.js";
import { installStartingConfiguration } from "./agency-starting-configuration.js";
import { mutationRows } from "../database/mutation-result.js";

@Injectable()
export class OrganizationsService {
  constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService) {}

  private async owner(token: string, manager = this.database.manager) {
    const session = await this.sessions.get(token, new Date(), false, manager);
    if (!(session.installationOwner || session.installationSuperadmin)) throw new ForbiddenException("Only the installation owner or a superadmin can manage agencies");
    return session;
  }

  async list(token: string): Promise<AgencyDirectory> {
    await this.owner(token);
    const agencies = await this.database.query<AgencyRow[]>(`select * from app_identity.organization
      order by coalesce(parent_organization_id, id), parent_organization_id nulls first, name, id`);
    // Installation owners can explicitly reuse published agency configurations.
    const catalogs = await this.database.query<AgencyDirectory["catalogs"]>(`select release.id,
      coalesce(release.display_name, release.standard || ' ' || release.version) as name,
      coalesce((select jsonb_agg(jsonb_build_object('id',agency.id,'name',agency.name) order by agency.name,agency.id)
        from app_identity.active_configuration_bundle active
        join app_identity.organization agency on agency.id=active.organization_id
        where active.catalog_release_id=release.id), '[]'::jsonb) as "activatedByAgencies"
      from catalog.release release where ${agencyCatalogEligibility}
      order by exists(select 1 from app_identity.active_configuration_bundle active
        where active.catalog_release_id=release.id) desc, release.loaded_at desc, release.id`);
    const configurations = await this.database.query<Array<AgencyConfigurationOption & { kind: "form" | "validation" }>>(`
      with options as (
        select fv.id, coalesce(fv.display_name,f.name) || ' · v' || fv.version as name,
          fv.catalog_release_id, f.organization_id, 'form' as kind
        from forms.form_version fv join forms.form f on f.id=fv.form_id where fv.status='published'
        union all
        select id,display_name || ' · v' || version,catalog_release_id,organization_id,'validation'
        from validation.version where status='published'
      )
      select option.id,option.name,option.catalog_release_id as "catalogReleaseId",
        option.organization_id as "organizationId",option.kind,
        coalesce((select jsonb_agg(jsonb_build_object('id',agency.id,'name',agency.name) order by agency.name,agency.id)
          from app_identity.active_configuration_bundle active
          join app_identity.organization agency on agency.id=active.organization_id
          where (option.kind='form' and active.form_version_id=option.id)
            or (option.kind='validation' and active.validation_version_id=option.id)
            or exists (select 1 from app_identity.organization_event event
              where event.organization_id=agency.id and event.action='agency.create' and (
                (option.kind='form' and event.details->>'startingFormVersionId'=option.id::text
                  and event.details->>'destinationFormVersionId'=active.form_version_id::text) or
                (option.kind='validation' and event.details->>'startingValidationVersionId'=option.id::text
                  and event.details->>'destinationValidationVersionId'=active.validation_version_id::text)
              ))), '[]'::jsonb) as "activatedByAgencies"
      from options option where option.catalog_release_id=any($1::uuid[])
      order by option.name,option.id`, [catalogs.map(({ id }) => id)]);
    const activeConfigurations = await this.database.query<AgencyDirectory["activeConfigurations"]>(`
      select active.organization_id as "organizationId",
        coalesce(cr.display_name,cr.standard || ' ' || cr.version) as "catalogName",
        coalesce(fv.display_name,f.name) || ' · v' || fv.version as "formName",
        vv.display_name || ' · v' || vv.version as "validationName"
      from app_identity.active_configuration_bundle active
      join catalog.release cr on cr.id=active.catalog_release_id
      join forms.form_version fv on fv.id=active.form_version_id join forms.form f on f.id=fv.form_id
      join validation.version vv on vv.id=active.validation_version_id`);
    return { hostnameSuffix: agencyHostnameSuffix(), agencies: agencies.map(agencySummary), catalogs, activeConfigurations,
      forms: configurations.filter(({ kind }) => kind === "form"), validations: configurations.filter(({ kind }) => kind === "validation") };
  }

  async create(token: string, command: CreateAgencyCommand): Promise<AgencySummary> {
    const settings = command.settings ? validateUpdateAgencyMediaSettings({ ...command.settings, expectedRevision: 1 }) : undefined;
    try {
      return await this.database.transaction(async (manager) => {
        const actor = await this.owner(token, manager);
        await manager.query("select pg_advisory_xact_lock(691631722)");
        if (command.parentOrganizationId) {
          const roots = await manager.query(`select id from app_identity.organization
            where id=$1 and parent_organization_id is null and active for share`, [command.parentOrganizationId]);
          if (!roots[0]) throw new UnprocessableEntityException("Choose an active parent agency");
        }
        const catalogs = await manager.query(`select id from catalog.release release where id=$1 and ${agencyCatalogEligibility}`, [command.catalogReleaseId]);
        if (!catalogs[0]) throw new UnprocessableEntityException("Choose an available published catalog");
        const rows = mutationRows<AgencyRow>(await manager.query(`insert into app_identity.organization
          (name, parent_organization_id, hostname, deployment_timezone) values ($1,$2,$3,$4) returning *`,
        [command.name, command.parentOrganizationId, command.hostname, command.timeZone]));
        const agency = rows[0]!;
        const definition = { dagency01: command.agencyUniqueStateId, dagency02: command.agencyNumber,
          dagency04: command.stateCode, dagency04Display: settings?.demographics.stateDisplay ?? null,
          dagency04System: settings?.demographics.stateCodeSystem ?? null, dagency04TerminologyVersion: settings?.demographics.stateTerminologyVersion ?? null };
        const hash = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
        await manager.query(`insert into app_identity.agency_demographic_version
          (organization_id, catalog_release_id, version, dagency_01, dagency_02, dagency_04, definition_sha256, effective_from, created_by,
           dagency_04_display,dagency_04_system,dagency_04_terminology_version)
          values ($1,$2,1,$3,$4,$5,$6,now(),$7,$8,$9,$10)`, [agency.id, command.catalogReleaseId, command.agencyUniqueStateId,
          command.agencyNumber, command.stateCode, hash, actor.user.id, definition.dagency04Display, definition.dagency04System, definition.dagency04TerminologyVersion]);
        await manager.query(`update app_identity.agency_settings set brand_text=$2, pwa_name=$2,
          pwa_short_name=left($2,12), time_zone=$3 where organization_id=$1`, [agency.id, command.name, command.timeZone]);
        if (settings) await new AgencySettingsService(this.database, this.sessions)
          .updateInTransaction(manager, agency.id, actor.user.id, settings);
        const startingConfiguration = await installStartingConfiguration(this.database, manager, actor, token, agency, command);
        await this.audit(manager, actor.user.id, agency.id, "agency.create", { ...startingConfiguration, name: command.name,
          parentOrganizationId: command.parentOrganizationId, hostname: command.hostname });
        return agencySummary(agency);
      });
    } catch (error) { this.rethrowConflict(error); }
  }

  async update(token: string, id: string, command: UpdateAgencyCommand): Promise<AgencySummary> {
    try {
      return await this.database.transaction(async (manager) => {
        const actor = await this.owner(token, manager);
        const [current] = await manager.query<AgencyRow[]>("select * from app_identity.organization where id=$1 for update", [id]);
        if (!current) throw new NotFoundException("Agency not found");
        if (Number(current.revision) !== command.expectedRevision) throw new ConflictException("Agency changed; reload before saving");
        if (!command.active && actor.homeOrganizationId === id) throw new ConflictException("The owner's home agency must remain active");
        const rows = mutationRows<AgencyRow>(await manager.query(`update app_identity.organization
          set name=$2,hostname=$3,active=$4,revision=revision+1,updated_at=now() where id=$1 returning *`,
        [id, command.name, command.hostname, command.active]));
        if (current.hostname !== command.hostname || !command.active) {
          await manager.query(`update app_identity.app_session set revoked_at=now(),revocation_reason='agency_configuration_changed'
            where revoked_at is null and (organization_id=$1 or organization_id in (
              select id from app_identity.organization where parent_organization_id=$1)
              or browser_origin in ('https://' || $2::text, 'http://' || $2::text)
              or browser_origin in (select 'https://' || hostname from app_identity.organization
                where parent_organization_id=$1 and not $3::boolean))`, [id, current.hostname, command.active]);
        }
        await this.audit(manager, actor.user.id, id, "agency.update", { before: agencySummary(current), after: agencySummary(rows[0]!) });
        return agencySummary(rows[0]!);
      });
    } catch (error) { this.rethrowConflict(error); }
  }

  private audit(manager: EntityManager, actor: string, organization: string, action: string, details: unknown) {
    return manager.query(`insert into app_identity.organization_event(organization_id,actor_id,action,details)
      values ($1,$2,$3,$4::jsonb)`, [organization, actor, action, JSON.stringify(details)]);
  }
  private rethrowConflict(error: unknown): never {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new ConflictException("That hostname is already assigned to an agency");
    }
    throw error;
  }
}
