import { ConflictException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createPublicKey, randomUUID } from "node:crypto";
import type { ServerMetadata } from "openid-client";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { encryptCredential } from "./oidc-credentials.js";
import { checkedAddress, providerJson, providerUrl } from "./oidc-network.js";
import { oidcConfiguration } from "./oidc-library.js";

export type OidcDraft = { name: string; issuer: string; discoveryUrl: string; clientId: string; scopes: string[];
  mappings: { displayName: string; email: string }; clientAuthentication: "client_secret_post" };
type Version = { revision: string | number; provider_id: string; configuration: OidcDraft; credential_configured: boolean;
  discovery: unknown; discovery_health: string; discovered_at: Date | null; created_at: Date; created_by: string };
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
    const actor = await this.sessions.requireCapability(token,capability,manager);
    const [group] = await manager.query<Array<{group_id:string}>>("select app_identity.organization_group($1) as group_id",[actor.organization.id]);
    if (!group) throw new Error("Select an agency group");
    return { actor, groupId:group.group_id };
  }
  async get(token: string) {
    const {groupId} = await this.group(token,"settings:read");
    const [state] = await this.database.query<Array<{draft_revision:string;active_revision:string|null}>>("select draft_revision,active_revision from app_identity.oidc_provider_state where group_id=$1",[groupId]);
    const rows = await this.database.query<Version[]>(`select ${columns} from app_identity.oidc_provider_version where group_id=$1 order by revision desc limit 20`,[groupId]);
    const draft = rows.find(row => Number(row.revision)===Number(state?.draft_revision));
    const [active] = state?.active_revision ? await this.database.query<Version[]>(`select ${columns} from app_identity.oidc_provider_version where group_id=$1 and revision=$2`,[groupId,state.active_revision]) : [];
    const agencies = await this.database.query<Array<{hostname:string}>>("select hostname from app_identity.organization where app_identity.organization_group(id)=$1 and active and hostname is not null order by hostname",[groupId]);
    return { groupId, draft:view(draft),active:view(active), registration: {flow:"authorization_code",clientAuthentication:"client_secret_post",
      requiredClaims:["iss","sub","aud","exp","iat","nonce"], pkce:"S256; confirm AD FS v6 registration support",
      hosts:agencies.map(({hostname}) => ({origin:`https://${hostname}`,callbackUrl:`https://${hostname}/api/sessions/oidc/callback`,
        logoutCallbackUrl:`https://${hostname}/api/sessions/oidc/logout-callback`})), globalLogout:false },
      history:rows.map(row => ({revision:Number(row.revision),createdAt:row.created_at.toISOString(),actorId:row.created_by,credentialConfigured:row.credential_configured,discoveryHealth:row.discovery_health})) };
  }
  async save(token: string, input: unknown) {
    const command = validateOidcDraft(input);
    try { await this.database.transaction(async manager => {
      const {actor,groupId} = await this.group(token,"settings:write",manager);
      await this.sessions.requireRecentReauthentication(token,manager);
      await manager.query("select group_id from app_identity.group_authentication_policy where group_id=$1 for update",[groupId]);
      const [state] = await manager.query<Array<{draft_revision:string}>>("select draft_revision from app_identity.oidc_provider_state where group_id=$1",[groupId]);
      if (Number(state?.draft_revision ?? 0)!==command.expectedRevision) throw new ConflictException({code:"admin.oidcStale"});
      const [prior] = state ? await manager.query<Array<{provider_id:string;configuration:OidcDraft;encrypted_credential:unknown}>>("select provider_id,configuration,encrypted_credential from app_identity.oidc_provider_version where group_id=$1 and revision=$2",[groupId,state.draft_revision]) : [];
      const sameProvider = prior && prior.configuration.issuer===command.configuration.issuer && prior.configuration.clientId===command.configuration.clientId;
      const providerId = sameProvider ? prior.provider_id : randomUUID();
      const credential = command.replacementSecret ? encryptCredential(command.replacementSecret,groupId,providerId) : sameProvider ? prior.encrypted_credential : null;
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
      if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length>100) throw new Error("Invalid keys");
      const signingKeyIds = jwks.keys.filter(value => value && typeof value === "object" && value.use!=="enc" && ["RSA","EC","OKP"].includes(value.kty))
        .map(value => {
          if (Object.hasOwn(value,"d") || (value.key_ops!==undefined && (!Array.isArray(value.key_ops) || !value.key_ops.includes("verify")))) throw new Error("Invalid public signing key");
          createPublicKey({key:value,format:"jwk"});
          return typeof value.kid === "string" && value.kid.length>0 && value.kid.length<=200 && !/[\u0000-\u001f]/.test(value.kid) ? value.kid : "(no kid)";
        });
      if (!signingKeyIds.length) throw new Error("Missing signing keys");
      discovery = {issuer:config.issuer,...endpoints,signingKeyIds,pkceS256:Array.isArray(metadata.code_challenge_methods_supported) && metadata.code_challenge_methods_supported.includes("S256")}; healthy=true;
    } catch { /* Provider bodies and error details never enter diagnostics or audit. */ }
    // Network requests complete before opening the short write transaction.
    await this.database.transaction(async manager => {
      const {actor,groupId:currentGroup} = await this.group(token,"settings:write",manager);
      await this.sessions.requireRecentReauthentication(token,manager);
      if (currentGroup!==groupId) throw new ConflictException({code:"admin.oidcStale"});
      const [state] = await manager.query<Array<{draft_revision:string}>>("select draft_revision from app_identity.oidc_provider_state where group_id=$1 for update",[groupId]);
      if (Number(state?.draft_revision)!==expectedRevision) throw new ConflictException({code:"admin.oidcStale"});
      await manager.query("update app_identity.oidc_provider_version set discovery=case when $4='healthy' then $3::jsonb else discovery end,discovery_health=$4,discovered_at=now() where group_id=$1 and revision=$2",[groupId,expectedRevision,discovery?JSON.stringify(discovery):null,healthy?"healthy":"failed"]);
      await this.audit(manager,groupId,actor.user.id,Number(expectedRevision),healthy?"discovery_healthy":"discovery_failed");
    });
    return this.get(token);
  }
  private audit(manager: EntityManager,groupId: string,actorId: string,revision: number,operation: string) {
    return manager.query("insert into app_identity.authentication_event(organization_id,actor_id,action,result,details) values ($1,$2,'authentication.policy_update','succeeded',$3::jsonb)",[groupId,actorId,JSON.stringify({kind:"oidc",revision,operation})]);
  }
}
