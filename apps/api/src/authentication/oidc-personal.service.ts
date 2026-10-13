import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException,HttpException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash, randomBytes } from "node:crypto";
import type { ServerMetadata } from "openid-client";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService, type CreatedSession } from "../sessions/clinician-session.service.js";
import { AgencyDirectoryService } from "../sessions/agency-directory.service.js";
import { agencyRequest } from "../sessions/agency-context.js";
import { mutationRows } from "../database/mutation-result.js";
import { encryptCredential, decryptCredential } from "./oidc-credentials.js";
import { RegionalIdentityService } from "./regional-identity.service.js";
import type { OidcDraft } from "./oidc-draft.service.js";
import { testAuthorization, personalCodeExchange, type TestBinding } from "./oidc-test-protocol.js";
import { approvedPersonalProofPolicy, personalProofPolicyDigest, type PersonalAuthenticationPurpose, type PersonalProofPolicy } from "./personal-proof.js";

const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
type Envelope=ReturnType<typeof encryptCredential>;
type Version={group_id:string;revision:string;provider_id:string;configuration:OidcDraft;encrypted_credential:Envelope;discovery:ServerMetadata & {pkceS256:boolean};discovery_health:string};
type Attempt={state_sha256:string;group_id:string;revision:string;organization_id:string;origin:string;purpose:PersonalAuthenticationPurpose;encrypted_binding:Envelope;created_at:Date};
type Binding={binding:TestBinding;previousToken?:string;installationCredential?:string;userAgent?:string;policy:PersonalProofPolicy;metadata:Version["discovery"]};

@Injectable()
export class OidcPersonalService {
 constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService,
  private readonly agencies:AgencyDirectoryService,private readonly identities:RegionalIdentityService){}
 private async active(groupId:string,manager:EntityManager=this.database.manager,lock=false):Promise<Version|undefined>{
  if(lock) {
   await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for share',[groupId]);
   await manager.query('select group_id from app_identity.oidc_provider_state where group_id=$1 for share',[groupId]);
  }
  return (await manager.query<Version[]>(`select v.*,s.active_discovery discovery,
   case when s.active_discovery is not null then 'healthy' else 'unchecked' end discovery_health from app_identity.oidc_provider_state s
   join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=s.active_revision
   join app_identity.group_authentication_policy p on p.group_id=s.group_id and p.mode='oidc'
   where s.group_id=$1 ${lock?'for share of v':''}`,[groupId]))[0];
 }
 private policy(version:Version){
  if(version.discovery_health!=="healthy"||!version.discovery||!version.encrypted_credential||version.discovery.pkceS256!==true||version.discovery.issuer!==version.configuration.issuer)
   throw new ServiceUnavailableException({code:"login.personalProofUnavailable"});
  return approvedPersonalProofPolicy({groupId:version.group_id,providerId:version.provider_id,issuer:version.configuration.issuer,clientId:version.configuration.clientId});
 }
 async options(){
  const agency=await this.agencies.forLogin();
  if(!agency)return {regional:false};
  const [group]=await this.database.query<Array<{id:string}>>('select app_identity.organization_group($1) id',[agency.id]);
  // A configured provider remains visible during an outage; no local fallback.
  const [policy]=await this.database.query<Array<{mode:string}>>('select mode from app_identity.group_authentication_policy where group_id=$1',[group!.id]);
  return {regional:policy?.mode==='oidc'};
 }
 async begin(input:unknown,previousToken?:string,csrfToken?:string,userAgent?:string){
  const body=input as Record<string,unknown>;
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>key!=="purpose")||
    typeof body.purpose!=="string"||!["login","switch","reauthenticate"].includes(body.purpose))throw new BadRequestException("A personal authentication purpose is required");
  const purpose=body.purpose as PersonalAuthenticationPurpose,context=agencyRequest.getStore(),origin=context?.origin;
  const agency=await this.agencies.forLogin();
  if(!agency||!origin||!await this.agencies.allowsOrigin(origin))throw new UnauthorizedException({code:"login.identityUnavailable"});
  if(purpose!=="login"){
   if(!previousToken)throw new UnauthorizedException({code:"login.identityUnavailable"});
   await this.sessions.assertCsrf(previousToken,csrfToken);
   const previous=await this.sessions.getAuthenticated(previousToken,new Date(),purpose==='reauthenticate');
   if(previous.organization?.id!==agency.id||purpose==='reauthenticate'&&(previous.nextAuthenticationSource ?? previous.authenticationSource)!=='oidc')throw new UnauthorizedException({code:"login.identityUnavailable"});
  }else if(previousToken){
   try {await this.sessions.getAuthenticated(previousToken);}catch{previousToken=undefined;}
  }
  let switchEnded=false;
  if(purpose==='switch'){
   // The browser has already settled its writers. A verified explicit handover
   // ends outgoing authority even if provider preparation itself is unavailable.
   await this.sessions.end(previousToken!,csrfToken,'user_switch');
   previousToken=undefined;switchEnded=true;
  }
  try{
  const [group]=await this.database.query<Array<{id:string}>>('select app_identity.organization_group($1) id',[agency.id]);
  const version=await this.active(group!.id);
  if(!version)throw new ServiceUnavailableException({code:"login.personalProofUnavailable"});
  const policy=this.policy(version),correlation=random();
  const binding:TestBinding={state:random(),nonce:random(),verifier:random(),callback:`${origin}/api/sessions/oidc/callback`,pkce:true};
  const authorizationUrl=await testAuthorization(version.discovery,version.configuration.clientId,decryptCredential(version.encrypted_credential,version.group_id,version.provider_id),version.configuration.scopes,binding,{policy,purpose});
  let proofNotBefore=0;
  await this.database.transaction(async manager=>{
   if(previousToken)await this.sessions.lockPersonalAuthenticationContext(manager,null,previousToken);
   const current=await this.active(group!.id,manager,true);
   if(!current||current.revision!==version.revision||personalProofPolicyDigest(this.policy(current))!==personalProofPolicyDigest(policy)||JSON.stringify(current.discovery)!==JSON.stringify(version.discovery))throw new ConflictException({code:"login.identityUnavailable"});
   if(!await this.agencies.allowsOrigin(origin,manager))throw new UnauthorizedException({code:"login.identityUnavailable"});
   if(previousToken){
    await this.sessions.getAuthenticated(previousToken,new Date(),purpose==='reauthenticate',manager);
    if(purpose!=='reauthenticate'){
     // Starting an explicit handover ends outgoing server authority, even if the
     // provider later cancels/fails or the new identity remains pending.
     await manager.query(`update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='user_switch'
      where token_sha256=$1 and revoked_at is null`,[digest(previousToken)]);
    }
   }
   const began=new Date();
   proofNotBefore=(Math.floor(began.getTime()/1000)+1)*1000;
   await manager.query(`insert into app_identity.oidc_personal_transaction
    (state_sha256,correlation_sha256,group_id,revision,organization_id,origin,purpose,encrypted_binding,created_at,expires_at)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9::timestamptz+interval '5 minutes')`,
    [digest(binding.state),digest(correlation),group!.id,version.revision,agency.id,origin,purpose,
     JSON.stringify(encryptCredential(JSON.stringify({binding,previousToken:purpose==='reauthenticate'?previousToken:undefined,installationCredential:context?.installationCredential,userAgent,policy,metadata:version.discovery}),group!.id,`personal:${binding.state}`)),began]);
  });
  // Signed auth_time has second precision. Do not deliver authorization until
  // its unambiguous lower bound, so an earlier authentication in the same second
  // cannot qualify. This short wait holds no database transaction or lock.
  if(proofNotBefore>Date.now())await new Promise(resolve=>setTimeout(resolve,proofNotBefore-Date.now()));
  return {authorizationUrl,correlation};
  }catch(error){
   if(!switchEnded)throw error;
   const body=error instanceof HttpException?error.getResponse():null;
   throw new HttpException({code:body&&typeof body==='object'&&'code' in body?body.code:'login.personalProofUnavailable',sessionEnded:true},error instanceof HttpException?error.getStatus():503);
  }
 }
 async callback(url:URL,correlation:string):Promise<{destination:string;created?:CreatedSession;clearSession?:boolean}>{
  const state=url.searchParams.get("state"),origin=agencyRequest.getStore()?.origin;
  if(["state","code","error","iss"].some(key=>url.searchParams.getAll(key).length>1)||url.searchParams.has('code')&&url.searchParams.has('error')||
    !state||state.length>200||!correlation||correlation.length>200)throw new UnauthorizedException({code:"login.identityUnavailable"});
  // Atomic one-time consumption precedes every code exchange, including failures.
  const [attempt]=mutationRows<Attempt>(await this.database.query(`update app_identity.oidc_personal_transaction set consumed_at=clock_timestamp()
   where state_sha256=$1 and correlation_sha256=$2 and origin=$3 and consumed_at is null and expires_at>clock_timestamp() returning *`,[digest(state),digest(correlation),origin]));
  if(!attempt)throw new UnauthorizedException({code:"login.identityUnavailable"});
  let result='failed';
  try{
   if(url.origin!==attempt.origin||url.pathname!=="/api/sessions/oidc/callback"||url.searchParams.has('error'))throw new Error();
   const saved=JSON.parse(decryptCredential(attempt.encrypted_binding,attempt.group_id,`personal:${state}`)) as Binding;
   return await agencyRequest.run({origin:attempt.origin,organizationId:attempt.organization_id,installationCredential:saved.installationCredential},async()=>{
    if(!await this.agencies.allowsOrigin(attempt.origin))throw new Error();
    const version=await this.active(attempt.group_id);
    if(!version||Number(version.revision)!==Number(attempt.revision)||personalProofPolicyDigest(this.policy(version))!==personalProofPolicyDigest(saved.policy))throw new Error();
    const validated=await personalCodeExchange(saved.metadata,version.configuration.clientId,decryptCredential(version.encrypted_credential,attempt.group_id,version.provider_id),saved.binding,url,version.configuration.mappings,saved.policy,attempt.purpose,new Date(attempt.created_at));
    const completed=await this.database.transaction(async manager=>{
     const identity=await this.identities.record(manager,{groupId:attempt.group_id,providerId:version.provider_id,revision:Number(version.revision),organizationId:attempt.organization_id},validated.identity);
     await this.sessions.lockPersonalAuthenticationContext(manager,identity.requestId,saved.previousToken);
     const current=await this.active(attempt.group_id,manager,true);
     if(!current||Number(current.revision)!==Number(attempt.revision)||JSON.stringify(current.discovery)!==JSON.stringify(saved.metadata)||
       personalProofPolicyDigest(this.policy(current))!==personalProofPolicyDigest(saved.policy)||!await this.agencies.allowsOrigin(attempt.origin,manager))throw new Error();
     const live=mutationRows(await manager.query(`update app_identity.oidc_personal_transaction set completed_at=clock_timestamp(),result='succeeded'
      where state_sha256=$1 and expires_at>clock_timestamp() and completed_at is null returning state_sha256`,[attempt.state_sha256]));
     if(!live.length)throw new Error();
     if(saved.previousToken)await this.sessions.getAuthenticated(saved.previousToken,new Date(),true,manager);
     if(identity.status==='pending'){
      // A validated identity that cannot resolve to the outgoing user is a safe
      // switch. Pending onboarding must never leave that user's cookie usable.
      if(saved.previousToken)await manager.query(`update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='user_switch'
       where token_sha256=$1 and revoked_at is null`,[digest(saved.previousToken)]);
      await manager.query("update app_identity.oidc_personal_transaction set result='pending' where state_sha256=$1",[attempt.state_sha256]);
      return {destination:`${attempt.origin}/?authentication=pending`,clearSession:true};
     }
     const created=await this.sessions.completePersonalAuthentication(manager,identity.requestId,Number(current.revision),validated.proof,saved.previousToken,new Date(),saved.userAgent);
     return {destination:`${attempt.origin}/?authentication=completed`,created};
    });
    result=completed.created?'succeeded':'pending';
    return completed;
   });
  }catch{
   // Bounded failure only. Do not expose provider bodies, claims, tokens or codes.
   await this.database.query("update app_identity.oidc_personal_transaction set completed_at=clock_timestamp(),result='failed' where state_sha256=$1",[attempt.state_sha256]);
   return {destination:`${attempt.origin}/?authentication=failed`};
  }finally{
   await this.database.query(`insert into app_identity.authentication_event(organization_id,action,result,details)
    values($1,'authentication.sign_in',$2,$3::jsonb)`,[attempt.organization_id,result==='succeeded'?'succeeded':'failed',JSON.stringify({kind:'oidc_personal',purpose:attempt.purpose,revision:Number(attempt.revision),outcome:result})]);
  }
 }
}
