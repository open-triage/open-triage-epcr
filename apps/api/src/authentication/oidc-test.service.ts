import { ConflictException, Injectable, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash,randomBytes } from "node:crypto";
import type { ServerMetadata } from "openid-client";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { agencyRequest } from "../sessions/agency-context.js";
import { AgencyDirectoryService } from "../sessions/agency-directory.service.js";
import { decryptCredential,encryptCredential } from "./oidc-credentials.js";
import { type OidcDraft } from "./oidc-draft.service.js";
import { testAuthorization,testCodeExchange,type TestBinding } from "./oidc-test-protocol.js";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
type Envelope=ReturnType<typeof encryptCredential>;
type Version={provider_id:string;configuration:OidcDraft;encrypted_credential:Envelope;discovery:ServerMetadata & {pkceS256:boolean};discovery_health:string};
type Attempt={state_sha256:string;group_id:string;revision:string;organization_id:string;actor_id:string;origin:string;return_path:string;encrypted_binding:Envelope;pkce_s256:boolean;action:string;provider_id:string;configuration:OidcDraft;encrypted_credential:Envelope;discovery:Version["discovery"]};
@Injectable()
export class OidcTestService {
 constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService,private readonly agencies:AgencyDirectoryService){}
 private async authority(token:string,manager:EntityManager=this.database.manager){
  const actor=await this.sessions.requireCapability(token,"settings:write",manager);
  await this.sessions.requireRecentReauthentication(token,manager);
  const [group]=await manager.query<Array<{id:string}>>("select app_identity.organization_group($1) id",[actor.organization.id]);
  return {actor,groupId:group!.id};
 }
 async begin(token:string,input:unknown){
  const body=input as Record<string,unknown>;
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>key!=="expectedRevision")||!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<1)throw new UnprocessableEntityException("A saved draft revision is required");
  const revision=Number(body.expectedRevision),origin=agencyRequest.getStore()?.origin;
  if(!origin||!await this.agencies.allowsOrigin(origin))throw new UnauthorizedException("A registered agency origin is required");
  const {actor,groupId}=await this.authority(token);
  const agency=await this.agencies.forLogin();
  if(!agency||agency.id!==actor.organization.id)throw new UnauthorizedException("Open the selected agency address");
  const [version]=await this.database.query<Version[]>("select v.* from app_identity.oidc_provider_version v join app_identity.oidc_provider_state s using(group_id) where v.group_id=$1 and v.revision=$2 and s.draft_revision=v.revision",[groupId,revision]);
  if(!version)throw new ConflictException("The provider draft changed");
  if(version.discovery_health!=="healthy"||!version.discovery||!version.encrypted_credential)throw new UnprocessableEntityException("Inspect the complete provider draft first");
  const binding:TestBinding={state:random(),nonce:random(),verifier:random(),callback:`${origin}/api/sessions/oidc/callback`,pkce:version.discovery.pkceS256===true};
  const correlation=random();
  const authorizationUrl=await testAuthorization(version.discovery,version.configuration.clientId,decryptCredential(version.encrypted_credential,groupId,version.provider_id),version.configuration.scopes,binding);
  await this.database.transaction(async manager=>{
   const current=await this.authority(token,manager);
   const [state]=await manager.query<Array<{draft_revision:string}>>("select draft_revision from app_identity.oidc_provider_state where group_id=$1 for update",[groupId]);
   if(current.groupId!==groupId||current.actor.organization.id!==agency.id||Number(state?.draft_revision)!==revision)throw new ConflictException("The provider draft changed");
   await manager.query("insert into app_identity.oidc_test_transaction(state_sha256,correlation_sha256,group_id,revision,organization_id,actor_id,origin,action,return_path,encrypted_binding,expires_at,pkce_s256) values($1,$2,$3,$4,$5,$6,$7,'draft_test','/',$8::jsonb,now()+interval '5 minutes',$9)",[digest(binding.state),digest(correlation),groupId,revision,agency.id,actor.user.id,origin,JSON.stringify(encryptCredential(JSON.stringify({binding,token,metadata:version.discovery}),groupId,`test:${binding.state}`)),binding.pkce]);
  });
  return {authorizationUrl,correlation};
 }
 async callback(url:URL,correlation:string){
  const state=url.searchParams.get("state");
  if(["state","code","error","iss"].some(key=>url.searchParams.getAll(key).length>1)||url.searchParams.has("code")&&url.searchParams.has("error"))throw new UnauthorizedException("Ambiguous provider callback");
  if(!state||!correlation||state.length>200||correlation.length>200)throw new UnauthorizedException("Invalid or expired provider test");
  const origin=agencyRequest.getStore()?.origin;
  // Consume before network I/O. All attempts, including a failed exchange, are one-time.
  const rows=await this.database.query<Attempt[]>(`with consumed as (
   update app_identity.oidc_test_transaction set consumed_at=now()
   where state_sha256=$1 and correlation_sha256=$2 and origin=$3 and action='draft_test' and return_path='/' and consumed_at is null and expires_at>now() returning *)
   select t.*,v.provider_id,v.configuration,v.encrypted_credential,v.discovery from consumed t join app_identity.oidc_provider_version v on v.group_id=t.group_id and v.revision=t.revision`,[digest(state),digest(correlation),origin]);
  const attempt=rows[0];if(!attempt)throw new UnauthorizedException("Invalid or expired provider test");
  let result="failed";
  let failureCode:string|null="transaction_invalid";
  try{
   failureCode="origin_changed";
   if(!origin||url.origin!==origin||url.pathname!=="/api/sessions/oidc/callback"||!await this.agencies.allowsOrigin(origin))throw new Error("Invalid origin");
   failureCode="transaction_invalid";
   const {binding,token,metadata}=JSON.parse(decryptCredential(attempt.encrypted_binding,attempt.group_id,`test:${state}`)) as {binding:TestBinding;token:string;metadata:Version["discovery"]};
   failureCode="authority_changed";
   const authority=await this.authority(token);
   if(authority.groupId!==attempt.group_id||authority.actor.organization.id!==attempt.organization_id||authority.actor.user.id!==attempt.actor_id)throw new Error("Authority changed");
   if(url.searchParams.has("error")){result="canceled";failureCode="canceled";}
   else {
    failureCode="provider_validation";
    await testCodeExchange(metadata,attempt.configuration.clientId,decryptCredential(attempt.encrypted_credential,attempt.group_id,attempt.provider_id),binding,url);
    await this.database.transaction(async manager=>{
     failureCode="authority_changed";
     const fresh=await this.authority(token,manager);
     if(fresh.groupId!==attempt.group_id||fresh.actor.organization.id!==attempt.organization_id||fresh.actor.user.id!==attempt.actor_id)throw new Error("Authority changed");
     failureCode="origin_changed";
     if(!await this.agencies.allowsOrigin(origin))throw new Error("Agency origin withdrawn");
     failureCode="draft_changed";
     const [current]=await manager.query<Array<{draft_revision:string;discovery:unknown;discovery_health:string}>>("select s.draft_revision,v.discovery,v.discovery_health from app_identity.oidc_provider_state s join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=s.draft_revision where s.group_id=$1 for update of s",[attempt.group_id]);
     if(Number(current?.draft_revision)!==Number(attempt.revision)||current?.discovery_health!=="healthy"||JSON.stringify(current.discovery)!==JSON.stringify(metadata))throw new ConflictException("Draft changed");
     failureCode="expired";
     const completed=mutationRows<{state_sha256:string}>(await manager.query("update app_identity.oidc_test_transaction set result='succeeded',completed_at=now() where state_sha256=$1 and expires_at>now() and result is null returning state_sha256",[attempt.state_sha256]));
     if(!completed.length)throw new Error("Provider test expired");
     await this.audit(manager,attempt,"succeeded",null);
    });result="succeeded";failureCode=null;
   }
  }catch { /* Never persist token, claims, code, provider bodies or library diagnostics. */ }
  if(result!=="succeeded")await this.database.transaction(async manager=>{await manager.query("update app_identity.oidc_test_transaction set result=$2,failure_code=$3,completed_at=now() where state_sha256=$1",[attempt.state_sha256,result,failureCode]);await this.audit(manager,attempt,"failed",failureCode);});
  return `${attempt.origin}${attempt.return_path}`;
 }
 private audit(manager:EntityManager,attempt:Attempt,result:"succeeded"|"failed",failureCode:string|null){
  return manager.query("insert into app_identity.authentication_event(organization_id,actor_id,action,result,details) values($1,$2,'authentication.policy_update',$3,$4::jsonb)",[attempt.organization_id,attempt.actor_id,result,JSON.stringify({kind:"oidc_test",revision:Number(attempt.revision),operation:"draft_test",failureCode,pkceS256:attempt.pkce_s256,freshPersonalAuthentication:false})]);
 }
}
