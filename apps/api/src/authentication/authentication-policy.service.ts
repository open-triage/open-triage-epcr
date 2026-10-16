import { Injectable, ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { localPolicy, type LocalPolicy } from "./local-policy.js";

export function validateLocalPolicy(body: unknown): Omit<LocalPolicy, "groupId" | "revision"> & { expectedRevision: number } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new UnprocessableEntityException({ code: "admin.authenticationPolicyInvalid" });
  const value = body as Record<string, unknown>;
  const bounds = { expectedRevision: [1, Number.MAX_SAFE_INTEGER], maximumSessionHours: [1, 168],
    temporaryPasswordHours: [1, 168], accountAttemptsPer15Minutes: [1, 1000], networkAttemptsPer5Minutes: [1, 1000] };
  if (Object.keys(value).some(key => !Object.hasOwn(bounds, key))) throw new UnprocessableEntityException({ code: "admin.authenticationPolicyInvalid" });
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < minimum! || Number(value[key]) > maximum!) {
      throw new UnprocessableEntityException({ code: "admin.authenticationPolicyInvalid", params: { field: key, minimum, maximum } });
    }
  }
  return value as ReturnType<typeof validateLocalPolicy>;
}

@Injectable()
export class AuthenticationPolicyService {
  constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService) {}
  async get(token: string) {
    const actor = await this.sessions.requireCapability(token, "settings:read");
    const policy = await localPolicy(this.database.manager, actor.organization.id);
    if (!policy) throw new Error("Select an agency group");
    const history = await this.database.query<Array<{actor_id: string; display_name: string | null; occurred_at: Date | string; details: unknown}>>(`select event.actor_id, account.display_name, event.occurred_at, event.details
      from app_identity.authentication_event event left join app_identity.app_user account on account.id=event.actor_id
      where event.organization_id=$1 and event.action='authentication.policy_update' and jsonb_typeof(event.details->'prior')='object' and jsonb_typeof(event.details->'policy')='object'
      order by event.occurred_at desc, event.id desc limit 20`, [policy.groupId]);
    const [group] = await this.database.query<Array<{ name: string }>>("select name from app_identity.organization where id=$1", [policy.groupId]);
    return { ...policy, groupName: group?.name ?? actor.organization.name, organizationId: actor.organization.id, inherited: actor.organization.id !== policy.groupId,
      minimumPasswordLength: 12, mode: (await this.database.query<Array<{mode:"local"|"oidc"}>>("select mode from app_identity.group_authentication_policy where group_id=$1",[policy.groupId]))[0]?.mode ?? "local", history: history.map(event => ({ actorId: event.actor_id, displayName: event.display_name, occurredAt: new Date(event.occurred_at).toISOString(), details: event.details })) };
  }
  async update(token: string, body: unknown) {
    const command = validateLocalPolicy(body);
    await this.database.transaction(async manager => {
      if(manager.queryRunner?.isTransactionActive)await this.sessions.lockPersonalAuthenticationContext(manager,null,token);
      const actor = await this.sessions.requireCapability(token, "settings:write", manager);
      await updateLocalPolicy(manager,actor.organization.id,actor.user.id,command);
    });
    return this.get(token);
  }
}

/** Caller supplies settings-write authority and the encompassing transaction. */
export async function updateLocalPolicy(manager:EntityManager,organizationId:string,actorId:string,command:ReturnType<typeof validateLocalPolicy>):Promise<LocalPolicy>{
      await manager.query("select group_id from app_identity.group_authentication_policy where group_id=app_identity.organization_group($1) for update", [organizationId]);
      const prior = await localPolicy(manager, organizationId);
      if (!prior || prior.revision !== command.expectedRevision) throw new ConflictException({ code: "admin.authenticationPolicyStale" });
      if (prior.maximumSessionHours===command.maximumSessionHours && prior.temporaryPasswordHours===command.temporaryPasswordHours &&
          prior.accountAttemptsPer15Minutes===command.accountAttemptsPer15Minutes && prior.networkAttemptsPer5Minutes===command.networkAttemptsPer5Minutes) return prior;
      const groupId = prior.groupId;
      await manager.query(`update app_identity.group_authentication_policy set maximum_session_hours=$2,
        temporary_password_hours=$3, account_attempt_limit=$4, network_attempt_limit=$5, revision=revision+1
        where group_id=$1`, [groupId, command.maximumSessionHours, command.temporaryPasswordHours,
        command.accountAttemptsPer15Minutes, command.networkAttemptsPer5Minutes]);
      await manager.query(`insert into app_identity.authentication_event (organization_id,actor_id,action,result,details)
        values ($1,$2,'authentication.policy_update','succeeded',$3::jsonb)`,
      [groupId, actorId, JSON.stringify({ prior, policy: { ...command, groupId, revision: prior.revision + 1 } })]);
      return (await localPolicy(manager,organizationId))!;
}
