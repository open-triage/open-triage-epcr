import { ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type { ProductionWorkflowReadiness } from "@open-triage/contracts";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { activePersonalProofPolicy } from "./active-personal-provider.js";
import { decryptCredential } from "./oidc-credentials.js";
import { lockProductionWorkflowAuthority, productionWorkflow } from "./production-workflow.js";

@Injectable()
export class ProductionWorkflowService {
  constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService) {}
  private async readiness(manager: EntityManager, organizationId: string, offset = 0): Promise<ProductionWorkflowReadiness> {
    const rollout = await productionWorkflow(manager, organizationId);
    const [policy] = await manager.query<Array<{mode: string; provider_id: string; configuration: {issuer: string; clientId: string};
      active_discovery: {issuer?: string; pkceS256?: boolean} | null; encrypted_credential: Parameters<typeof decryptCredential>[0]}>>(`
      select p.mode,v.provider_id,v.configuration,s.active_discovery,v.encrypted_credential
      from app_identity.group_authentication_policy p left join app_identity.oidc_provider_state s on s.group_id=p.group_id
      left join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=s.active_revision where p.group_id=$1`, [rollout.groupId]);
    let providerReady = policy?.mode === "local";
    if (policy?.mode === "oidc") {
      try {
        activePersonalProofPolicy({group_id:rollout.groupId,provider_id:policy.provider_id,
          configuration:policy.configuration,discovery:policy.active_discovery,
          discovery_health:policy.active_discovery?"healthy":"unchecked",encrypted_credential:policy.encrypted_credential});
        if (!decryptCredential(policy.encrypted_credential,rollout.groupId,policy.provider_id)) throw new Error();
        providerReady = true;
      } catch { providerReady = false; }
    }
    const [directory] = await manager.query<Array<{units: ProductionWorkflowReadiness["units"]; total: number; missing_schedules: number; unenrolled_units: number}>>(`with units as (select u.id,u.organization_id as "organizationId",
      a.name as "agencyName",u.call_sign as "callSign",
      exists(select 1 from app_identity.unit_schedule_selection x where x.unit_id=u.id
        and x.organization_id=u.organization_id and x.effective_at<=clock_timestamp()
        and x.revision=(select max(y.revision) from app_identity.unit_schedule_selection y
          where y.unit_id=u.id and y.effective_at<=clock_timestamp()) and x.schedule_id is not null) as "scheduleSelected",
      exists(select 1 from app_identity.installation_registration r where r.unit_id=u.id
        and r.organization_id=u.organization_id and r.revoked_at is null) as enrolled
      from app_identity.operational_unit u join app_identity.organization a on a.id=u.organization_id
      where (a.id=$1 or a.parent_organization_id=$1) and a.active and u.active ), page as (select * from units order by "agencyName","callSign",id limit 50 offset $2)
      select coalesce((select jsonb_agg(page order by "agencyName","callSign",id) from page),'[]'::jsonb) units,
        count(*)::integer total, count(*) filter(where not "scheduleSelected")::integer missing_schedules,
        count(*) filter(where not enrolled)::integer unenrolled_units from units`, [rollout.groupId, offset]);
    return { ...rollout, providerReady, units: directory!.units, totalUnits: directory!.total, offset,
      missingSchedules: directory!.missing_schedules, unenrolledUnits: directory!.unenrolled_units,
      canEnable: rollout.state === "preparation" && providerReady && directory!.missing_schedules === 0 && directory!.unenrolled_units === 0 };
  }
  async get(token: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new UnprocessableEntityException({code: "admin.workflowInvalid"});
    const actor = await this.sessions.requireCapability(token, "settings:read");
    return this.readiness(this.database.manager, actor.organization.id, offset);
  }
  async enable(token: string, input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["expectedRevision", "confirm"].includes(key)) ||
      (input as {confirm?: unknown}).confirm !== true || !Number.isSafeInteger((input as {expectedRevision?: number}).expectedRevision)) {
      throw new UnprocessableEntityException({ code: "admin.workflowInvalid" });
    }
    const expectedRevision = (input as {expectedRevision: number}).expectedRevision;
    const initial = await this.sessions.requireCapability(token, "settings:write");
    await this.database.transaction(async manager => {
      // Take rollout before the session, including same-token enable/create races.
      await lockProductionWorkflowAuthority(manager, initial.user.id);
      const rollout = await productionWorkflow(manager, initial.organization.id, "update");
      await this.sessions.lockPersonalAuthenticationContext(manager, null, token, rollout.groupId);
      const actor = await this.sessions.requireCapability(token, "settings:write", manager);
      await this.sessions.requireRecentReauthentication(token, manager);
      if (actor.organization.id !== initial.organization.id || rollout.revision !== expectedRevision || rollout.state !== "preparation") {
        throw new ConflictException({ code: "admin.workflowStale" });
      }
      await manager.query("select group_id from app_identity.group_authentication_policy where group_id=$1 for share", [rollout.groupId]);
      await manager.query("select group_id from app_identity.oidc_provider_state where group_id=$1 for share", [rollout.groupId]);
      const ready = await this.readiness(manager, actor.organization.id);
      if (!ready.canEnable) throw new ConflictException({ code: "admin.workflowPreparationRequired" });
      const [clock] = await manager.query<Array<{now: Date}>>("select clock_timestamp() as now");
      await this.sessions.requireRecentReauthentication(token, manager, new Date(clock!.now));
      await manager.query(`update app_identity.production_workflow_rollout set enabled_at=clock_timestamp(),enabled_by=$2,revision=revision+1 where group_id=$1`, [rollout.groupId, actor.user.id]);
      await manager.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result,details)
        values($1,$2,'authentication.policy_update','succeeded',$3::jsonb)`,
        [rollout.groupId,actor.user.id,JSON.stringify({kind:"production-workflow-enabled",revision:rollout.revision+1})]);
    });
    return this.get(token);
  }
}
