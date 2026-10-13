import { ConflictException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import type { ServerMetadata } from "openid-client";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { approvedPersonalProofPolicy } from "./personal-proof.js";
import { encryptCredential } from "./oidc-credentials.js";
import { checkedAddress, providerJson, providerUrl } from "./oidc-network.js";
import { publicSigningKeyIds } from "./oidc-signing-keys.js";
import { oidcConfiguration } from "./oidc-library.js";

export type OidcDraft = { name: string; issuer: string; discoveryUrl: string; clientId: string; scopes: string[];
  mappings: { displayName: string; email: string }; clientAuthentication: "client_secret_post" };
type Version = { revision: string | number; provider_id: string; configuration: OidcDraft; credential_configured: boolean;
  discovery: unknown; discovery_health: string; discovered_at: Date | null; created_at: Date; created_by: string;
  changed_fields?: string[]; credential_replaced?: boolean; actor_name?:string|null };
const columns = "revision,provider_id,configuration,(encrypted_credential is not null) as credential_configured,discovery,discovery_health,discovered_at,created_at,created_by";
function invalid(field: string): never { throw new UnprocessableEntityException({ code: "admin.oidcInvalid", params: { field } }); }
export function validateOidcDraft(input: unknown): { expectedRevision: number; configuration: OidcDraft; replacementSecret?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("draft");
  const body = input as Record<string, unknown>;
  const keys = ["expectedRevision","name","issuer","discoveryUrl","clientId","scopes","mappings","clientAuthentication","replacementSecret"];
  if (Object.keys(body).some(key => !keys.includes(key)) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) return invalid("draft");
  const text = (field: string, limit: number) => { const value = body[field]; if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) return invalid(field); return value.trim(); };
  const name = text("name",120), issuer = text("issuer",2048), discoveryUrl = text("discoveryUrl",2048), clientId = text("clientId",500);
  for (const [field,value] of [["issuer",issuer],["discoveryUrl",discoveryUrl]]) if (value) { try { providerUrl(value!); } catch { return invalid(field!); } }
  if (body.clientAuthentication !== "client_secret_post") return invalid("clientAuthentication");
  if (!Array.isArray(body.scopes) || body.scopes.length > 20 || body.scopes.some(scope => typeof scope !== "string" || !/^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/.test(scope))) return invalid("scopes");
  const mappings = body.mappings as Record<string,unknown> | undefined;
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings) || Object.keys(mappings).some(key => !["displayName","email"].includes(key)) ||
      ["displayName","email"].some(key => typeof mappings[key] !== "string" || !/^[^\s\u0000-\u001f\u007f]{0,256}$/.test(String(mappings[key])))) return invalid("mappings");
  let replacementSecret: string | undefined;
  if (body.replacementSecret !== undefined) {
    if (typeof body.replacementSecret !== "string" || body.replacementSecret.length < 1 || body.replacementSecret.length > 4096 || /[\u0000-\u001f\u007f]/.test(body.replacementSecret)) return invalid("replacementSecret");
    replacementSecret = body.replacementSecret;
  }
  return { expectedRevision: Number(body.expectedRevision), configuration: {name,issuer,discoveryUrl,clientId,
    scopes:[...new Set(body.scopes)] as string[],mappings:mappings as OidcDraft["mappings"],clientAuthentication:"client_secret_post"}, replacementSecret };
}
export function missingOidcFields(configuration: OidcDraft, hasCredential: boolean) {
  return [!configuration.name && "name", !configuration.issuer && "issuer", !configuration.clientId && "clientId",
    !configuration.scopes.includes("openid") && "openid", !configuration.mappings.displayName && "displayName", !hasCredential && "credential"].filter(Boolean);
}
function view(row?: Version) {
  return row ? { revision: Number(row.revision), ...row.configuration, credentialConfigured: row.credential_configured,
    requiredFields: missingOidcFields(row.configuration,row.credential_configured), discovery: row.discovery,
    discoveryHealth: row.discovery_health, discoveredAt: row.discovered_at?.toISOString() ?? null } : null;
}
@Injectable()
export class OidcDraftService {
  constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService) {}
  private async group(token: string, capability: "settings:read" | "settings:write", manager: EntityManager = this.database.manager) {
    if(capability==="settings:write" && manager.queryRunner?.isTransactionActive)
      await this.sessions.lockPersonalAuthenticationContext(manager,null,token);
    const actor = await this.sessions.requireCapability(token,capability,manager);
    const [group] = await manager.query<Array<{group_id:string}>>("select app_identity.organization_group($1) as group_id",[actor.organization.id]);
    if (!group) throw new Error("Select an agency group");
    return { actor, groupId:group.group_id };
  }
  async get(token: string) {
    const {groupId} = await this.group(token,"settings:read");
    const [state] = await this.database.query<Array<{draft_revision:string;active_revision:string|null;active_discovery:unknown}>>("select draft_revision,active_revision,active_discovery from app_identity.oidc_provider_state where group_id=$1",[groupId]);
    // Compare immutable revisions in SQL; encrypted envelopes and configuration
    // values never enter the history response. Include the predecessor of the
    // oldest visible version rather than comparing only the bounded page.
    const rows = await this.database.query<Version[]>(`select ${columns},
      (select u.display_name from app_identity.app_user u where u.id=v.created_by) actor_name,
      array(select field from unnest(array['name','issuer','discoveryUrl','clientId','scopes','mappings','clientAuthentication']) field
        where v.configuration->field is distinct from (select p.configuration->field from app_identity.oidc_provider_version p
          where p.group_id=v.group_id and p.revision=v.revision-1)) changed_fields,
      encrypted_credential is not null and encrypted_credential is distinct from
        (select p.encrypted_credential from app_identity.oidc_provider_version p where p.group_id=v.group_id and p.revision=v.revision-1) credential_replaced
      from app_identity.oidc_provider_version v where group_id=$1 order by revision desc limit 20`,[groupId]);
    const draft = rows.find(row => Number(row.revision)===Number(state?.draft_revision));
    const [active] = state?.active_revision ? await this.database.query<Version[]>(`select ${columns} from app_identity.oidc_provider_version where group_id=$1 and revision=$2`,[groupId,state.active_revision]) : [];
    const agencies = await this.database.query<Array<{hostname:string}>>("select hostname from app_identity.organization where app_identity.organization_group(id)=$1 and active and hostname is not null order by hostname",[groupId]);
    const [test] = state ? await this.database.query<Array<{state_sha256:string;revision:string;result:string;failure_code:string|null;completed_at:Date;pkce_s256:boolean;fresh_personal_authentication:boolean;identity_outcome:string|null}>>("select t.state_sha256,t.revision,t.result,t.failure_code,t.completed_at,t.pkce_s256,t.fresh_personal_authentication,case when r.id is null then null when r.linked_user_id is null then 'pending' else 'linked' end identity_outcome from app_identity.oidc_test_transaction t left join app_identity.regional_identity_request r on r.id=t.identity_request_id where t.group_id=$1 and t.revision=$2 and t.completed_at is not null order by t.completed_at desc,t.state_sha256 desc limit 1",[groupId,state.draft_revision]) : [];
    const activationHistory=await this.database.query<Array<{actor_id:string;actor_name:string|null;occurred_at:Date;result:string;details:{revision:number;previousRevision:number|null;failureCode:string|null}}>>(
      "select actor_id,(select u.display_name from app_identity.app_user u where u.id=e.actor_id) actor_name,occurred_at,result,details from app_identity.authentication_event e where organization_id=$1 and details->>'kind'='oidc' and details->>'operation'='activate' order by occurred_at desc,id desc limit 20",[groupId]);
    const integrationChanged=!!active && !!draft && active.provider_id!==draft.provider_id;
    const [links]=active ? await this.database.query<Array<{count:number}>>("select count(*)::int count from app_identity.regional_identity_request where group_id=$1 and provider_id=$2 and issuer=$3 and linked_user_id is not null",[groupId,active.provider_id,active.configuration.issuer]) : [];
    return { groupId, activeSnapshotReady:!!state?.active_discovery, identityImpact:{integrationChanged,activeRevision:active?Number(active.revision):null,draftRevision:draft?Number(draft.revision):null,linkedIdentities:links?.count??0}, activationHistory:activationHistory.map(event=>({actorId:event.actor_id,actorName:event.actor_name,occurredAt:event.occurred_at.toISOString(),result:event.result,revision:event.details.revision,previousRevision:event.details.previousRevision,failureCode:event.details.failureCode})), test:test ? {testId:test.state_sha256,revision:Number(test.revision),result:test.result,failureCode:test.failure_code,completedAt:test.completed_at.toISOString(),pkceS256:test.pkce_s256,freshPersonalAuthentication:test.fresh_personal_authentication,identityOutcome:test.identity_outcome,ordinaryAccess:false}:null, draft:view(draft),active:view(active?{...active,discovery:state?.active_discovery??null,discovery_health:state?.active_discovery?"healthy":"unchecked"}:undefined), registration: {flow:"authorization_code",clientAuthentication:"client_secret_post",
      requiredClaims:["iss","sub","aud","exp","iat","nonce"], pkce:"S256; confirm AD FS v6 registration support",
      hosts:agencies.map(({hostname}) => ({origin:`https://${hostname}`,callbackUrl:`https://${hostname}/api/sessions/oidc/callback`,
        logoutCallbackUrl:`https://${hostname}/api/sessions/oidc/logout-callback`})), globalLogout:false },
      history:rows.map(row => ({revision:Number(row.revision),createdAt:row.created_at.toISOString(),actorId:row.created_by,actorName:row.actor_name??null,credentialConfigured:row.credential_configured,discoveryHealth:row.discovery_health,
        status:Number(row.revision)===Number(state?.active_revision)?"active":Number(row.revision)===Number(state?.draft_revision)?"draft":"superseded",changedFields:row.changed_fields??[],credentialReplaced:row.credential_replaced??false})) };
  }
  async save(token: string, input: unknown) {
    const command = validateOidcDraft(input);
    try { await this.database.transaction(async manager => {
      const {actor,groupId} = await this.group(token,"settings:write",manager);
      await manager.query("select group_id from app_identity.group_authentication_policy where group_id=$1 for update",[groupId]);
      const [state] = await manager.query<Array<{draft_revision:string;active_revision:string|null}>>("select draft_revision,active_revision from app_identity.oidc_provider_state where group_id=$1 for update",[groupId]);
      const [clock]=await manager.query<Array<{now:Date}>>("select clock_timestamp() now");
      await this.sessions.requireRecentReauthentication(token,manager,clock!.now);
      if (Number(state?.draft_revision ?? 0)!==command.expectedRevision) throw new ConflictException({code:"admin.oidcStale"});
      const [prior] = state ? await manager.query<Array<{provider_id:string;configuration:OidcDraft;encrypted_credential:unknown}>>("select provider_id,configuration,encrypted_credential from app_identity.oidc_provider_version where group_id=$1 and revision=$2",[groupId,state.draft_revision]) : [];
      const matches=(version:typeof prior):version is NonNullable<typeof prior>=>!!version && version.configuration.issuer===command.configuration.issuer && version.configuration.clientId===command.configuration.clientId;
      const [active]=state?.active_revision ? await manager.query<Array<typeof prior>>("select provider_id,configuration,encrypted_credential from app_identity.oidc_provider_version where group_id=$1 and revision=$2",[groupId,state.active_revision]) : [];
      // Restoring the exact active integration after a rejected replacement draft
      // preserves its namespace, credential AAD and installed proof contract.
      const baseline=matches(active)
        ? matches(prior) && prior.provider_id===active.provider_id ? prior : active
        : matches(prior) ? prior : undefined;
      const providerId = baseline ? baseline.provider_id : randomUUID();
      const credential = command.replacementSecret ? encryptCredential(command.replacementSecret,groupId,providerId) : baseline?.encrypted_credential ?? null;
      const revision = command.expectedRevision+1;
      await manager.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,created_by) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6)",[groupId,revision,providerId,JSON.stringify(command.configuration),credential ? JSON.stringify(credential):null,actor.user.id]);
      await manager.query("insert into app_identity.oidc_provider_state(group_id,draft_revision) values ($1,$2) on conflict(group_id) do update set draft_revision=excluded.draft_revision",[groupId,revision]);
      await this.audit(manager,groupId,actor.user.id,revision,"draft_saved");
    }); } catch(error) {
      if (error instanceof ConflictException || error instanceof UnprocessableEntityException || (error instanceof Error && !error.message.startsWith("OIDC credential"))) throw error;
      throw new ServiceUnavailableException({code:"admin.oidcEncryptionUnavailable"});
    }
    return this.get(token);
  }
  async inspect(token: string,input: unknown) {
    const expectedRevision = input && typeof input === "object" ? (input as Record<string,unknown>).expectedRevision : undefined;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision)<1 || Object.keys(input as object).some(key => key!=="expectedRevision")) return invalid("expectedRevision");
    const {groupId} = await this.group(token,"settings:write");
    await this.sessions.requireRecentReauthentication(token);
    const [row] = await this.database.query<Version[]>(`select ${columns} from app_identity.oidc_provider_version where group_id=$1 and revision=$2 and exists(select 1 from app_identity.oidc_provider_state where group_id=$1 and draft_revision=$2)`,[groupId,expectedRevision]);
    if (!row) throw new ConflictException({code:"admin.oidcStale"});
    const missing = missingOidcFields(row.configuration,row.credential_configured);
    if (missing.length) throw new UnprocessableEntityException({code:"admin.oidcIncomplete",params:{field:missing.join(", ")}});
    let discovery: Record<string,unknown> | null = null;
    let healthy = false;
    try {
      const config = row.configuration;
      const metadata = await providerJson(config.discoveryUrl || `${config.issuer.replace(/\/$/,"")}/.well-known/openid-configuration`);
      if (metadata.issuer!==config.issuer || !Array.isArray(metadata.response_types_supported) || !metadata.response_types_supported.includes("code") ||
          !Array.isArray(metadata.token_endpoint_auth_methods_supported) || !metadata.token_endpoint_auth_methods_supported.includes("client_secret_post")) throw new Error("Unsupported provider");
      await oidcConfiguration(metadata as unknown as ServerMetadata,config.clientId,"discovery-only");
      const endpoints: Record<string,string> = {};
      for (const key of ["authorization_endpoint","token_endpoint","jwks_uri","userinfo_endpoint","end_session_endpoint"]) {
        const value = metadata[key];
        if (value===undefined && ["userinfo_endpoint","end_session_endpoint"].includes(key)) continue;
        if (typeof value!=="string") throw new Error("Missing endpoint");
        await checkedAddress(providerUrl(value)); endpoints[key]=value;
      }
      const jwks = await providerJson(endpoints.jwks_uri!);
      const signingKeyIds=publicSigningKeyIds(jwks);
      discovery = {issuer:config.issuer,id_token_signing_alg_values_supported:metadata.id_token_signing_alg_values_supported,...endpoints,signingKeyIds,pkceS256:Array.isArray(metadata.code_challenge_methods_supported) && metadata.code_challenge_methods_supported.includes("S256")}; healthy=true;
    } catch { /* Provider bodies and error details never enter diagnostics or audit. */ }
    // Network requests complete before opening the short write transaction.
    await this.database.transaction(async manager => {
      const {actor,groupId:currentGroup} = await this.group(token,"settings:write",manager);
      if (currentGroup!==groupId) throw new ConflictException({code:"admin.oidcStale"});
      await manager.query("select group_id from app_identity.group_authentication_policy where group_id=$1 for update",[groupId]);
      const [state] = await manager.query<Array<{draft_revision:string}>>("select draft_revision from app_identity.oidc_provider_state where group_id=$1 for update",[groupId]);
      const [clock]=await manager.query<Array<{now:Date}>>("select clock_timestamp() now");
      await this.sessions.requireRecentReauthentication(token,manager,clock!.now);
      if (Number(state?.draft_revision)!==expectedRevision) throw new ConflictException({code:"admin.oidcStale"});
      await manager.query("update app_identity.oidc_provider_version set discovery=case when $4='healthy' then $3::jsonb else discovery end,discovery_health=$4,discovered_at=now() where group_id=$1 and revision=$2",[groupId,expectedRevision,discovery?JSON.stringify(discovery):null,healthy?"healthy":"failed"]);
      await this.audit(manager,groupId,actor.user.id,Number(expectedRevision),healthy?"discovery_healthy":"discovery_failed");
    });
    return this.get(token);
  }
  async activate(token: string, input: unknown) {
    const body=input as Record<string,unknown>;
    if(!body || typeof body!=="object" || Array.isArray(body) || Object.keys(body).some(key=>!["expectedRevision","testId","identityChangeAcknowledgment"].includes(key))
      || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision)<1
      || typeof body.testId!=="string" || !/^[a-f0-9]{64}$/.test(body.testId)) return invalid("activation");
    const acknowledgment=body.identityChangeAcknowledgment as {activeRevision:number;draftRevision:number}|undefined;
    if(acknowledgment!==undefined && (!acknowledgment || typeof acknowledgment!=="object" || Array.isArray(acknowledgment)
      || Object.keys(acknowledgment).some(key=>!["activeRevision","draftRevision"].includes(key))
      || !Number.isSafeInteger(acknowledgment.activeRevision) || acknowledgment.activeRevision<1
      || !Number.isSafeInteger(acknowledgment.draftRevision) || acknowledgment.draftRevision<1))return invalid("activation");
    const revision=Number(body.expectedRevision);
    const failure=await this.database.transaction(async manager=>{
      const {actor,groupId}=await this.group(token,"settings:write",manager);
      await manager.query("select group_id from app_identity.group_authentication_policy where group_id=$1 for update",[groupId]);
      const [state]=await manager.query<Array<{draft_revision:string;active_revision:string|null}>>(
        "select draft_revision,active_revision from app_identity.oidc_provider_state where group_id=$1 for update",[groupId]);
      // Recheck freshness after waiting for concurrent writers, using database time.
      const [clock]=await manager.query<Array<{now:Date}>>("select clock_timestamp() now");
      await this.sessions.requireRecentReauthentication(token,manager,clock!.now);
      const live=await this.sessions.requireCapability(token,"settings:write",manager);
      if(live.user.id!==actor.user.id || live.organization.id!==actor.organization.id) throw new ConflictException({code:"admin.oidcStale"});
      let failureCode:string|undefined;
      const [version]=await manager.query<Array<Version>>( `select ${columns} from app_identity.oidc_provider_version where group_id=$1 and revision=$2 for share`,[groupId,revision]);
      const [tested]=await manager.query<Array<{state_sha256:string;result:string;tested_discovery:unknown;pkce_s256:boolean}>>(
        "select state_sha256,result,tested_discovery,pkce_s256 from app_identity.oidc_test_transaction where group_id=$1 and revision=$2 and completed_at is not null order by completed_at desc,state_sha256 desc limit 1",[groupId,revision]);
      const [active]=state?.active_revision ? await manager.query<Array<{provider_id:string}>>("select provider_id from app_identity.oidc_provider_version where group_id=$1 and revision=$2",[groupId,state.active_revision]) : [];
      if(Number(state?.draft_revision)!==revision || Number(state?.active_revision)===revision) failureCode="admin.oidcStale";
      else if(!version || missingOidcFields(version.configuration,version.credential_configured).length || version.discovery_health!=="healthy"
        || !tested || tested.state_sha256!==body.testId || tested.result!=="succeeded" || !tested.pkce_s256
        || JSON.stringify(tested.tested_discovery)!==JSON.stringify(version.discovery)) failureCode="admin.oidcActivationTestRequired";
      else if(active && active.provider_id!==version.provider_id && (acknowledgment?.activeRevision!==Number(state!.active_revision) || acknowledgment?.draftRevision!==revision))failureCode="admin.oidcIdentityAcknowledgmentRequired";
      else {
        try { approvedPersonalProofPolicy({groupId,providerId:version.provider_id,issuer:version.configuration.issuer,clientId:version.configuration.clientId}); }
        catch { failureCode="admin.oidcActivationProofRequired"; }
      }
      if(!failureCode) {
        await manager.query("update app_identity.oidc_provider_state set active_revision=$2,active_discovery=$3::jsonb where group_id=$1",[groupId,revision,JSON.stringify(version!.discovery)]);
        await manager.query("update app_identity.group_authentication_policy set mode='oidc',revision=revision+1 where group_id=$1",[groupId]);
      }
      await manager.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result,details)
        values($1,$2,'authentication.policy_update',$3,$4::jsonb)`,[groupId,actor.user.id,failureCode?'failed':'succeeded',
          JSON.stringify({kind:'oidc',operation:'activate',revision,previousRevision:state?.active_revision?Number(state.active_revision):null,failureCode:failureCode??null})]);
      return failureCode;
    });
    if(failure) throw new ConflictException({code:failure});
    return this.get(token);
  }

  private audit(manager: EntityManager,groupId: string,actorId: string,revision: number,operation: string) {
    return manager.query("insert into app_identity.authentication_event(organization_id,actor_id,action,result,details) values ($1,$2,'authentication.policy_update','succeeded',$3::jsonb)",[groupId,actorId,JSON.stringify({kind:"oidc",revision,operation})]);
  }
}
