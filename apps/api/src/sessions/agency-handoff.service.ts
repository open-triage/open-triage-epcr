import {Injectable,ForbiddenException,UnauthorizedException,BadRequestException} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import {DataSource,type EntityManager} from 'typeorm';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {SYNTHETIC_DEMO_FIXTURE} from '@open-triage/contracts';
import {ClinicianSessionService,type CreatedSession} from './clinician-session.service.js';
import {AgencyDirectoryService,registeredAgencyOrigin} from './agency-directory.service.js';
import {agencyRequest} from './agency-context.js';
import {mutationRows} from '../database/mutation-result.js';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid=()=>new UnauthorizedException({code:'auth.agencyHandoffInvalid'});
function command(value:unknown,keys:string[]):Record<string,string>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>typeof (value as Record<string,unknown>)[k]!=='string'||String((value as Record<string,unknown>)[k]).length>128))throw new BadRequestException({code:'auth.agencyHandoffInvalid'});
 return value as Record<string,string>;
}
type Handoff={id:string;source_session_id:string;target_organization_id:string;source_origin:string;target_origin:string;verifier_sha256:string;challenge_sha256:string|null;code_sha256:string|null;issued_at:Date|null;consumed_at:Date|null;expires_at:Date;user_id:string};
function destination(origin:string,stage:string,values:Record<string,string>){
 const url=new URL('/',origin);url.hash=new URLSearchParams({agencyHandoff:stage,...values}).toString();return url.href;
}
@Injectable()
export class AgencyHandoffService {
 constructor(@InjectDataSource()private readonly database:DataSource,private readonly sessions:ClinicianSessionService,private readonly agencies:AgencyDirectoryService){}
 private origin(){const origin=agencyRequest.getStore()?.origin;if(!origin)throw invalid();return origin;}
 private async eligible(manager:EntityManager,userId:string){
  const [row]=await manager.query<Array<{eligible:boolean}>>(`select active and account_scope='installation' and organization_id is null and app_identity.is_installation_superadmin(id) eligible from app_identity.app_user where id=$1`,[userId]);
  if(!row?.eligible)throw new ForbiddenException({code:'auth.agencyHandoffRestricted'});
 }
 private async target(manager:EntityManager,row:Handoff){
  await this.eligible(manager,row.user_id);
  const agencies=await this.agencies.accessible(row.user_id,manager);
  if(!agencies.some(a=>a.id===row.target_organization_id)||!await this.agencies.allowsOrigin(row.target_origin,manager))throw invalid();
  const hostAgency=await agencyRequest.run({origin:row.target_origin},()=>this.agencies.forLogin(manager));
  if(hostAgency?.id!==row.target_organization_id)throw invalid();
 }
 private async row(manager:EntityManager,id:string,lock=false):Promise<Handoff>{
  if(!uuid.test(id))throw invalid();
  const [row]=await manager.query<Handoff[]>(`select h.*,s.user_id from app_identity.agency_session_handoff h join app_identity.app_session s on s.id=h.source_session_id
   where h.id=$1 and h.expires_at>clock_timestamp() and h.consumed_at is null ${lock?'for update of h':''}`,[id]);
  if(!row)throw invalid();return row;
 }
 private async sameTargetUser(manager:EntityManager,row:Handoff,targetToken?:string){
  if(!targetToken)return;
  // Inspect the host's live cookie directly: a stale workspace header or an
  // unavailable OIDC decryption key must not hide another signed-in person.
  const [current]=await manager.query<Array<{user_id:string}>>('select user_id from app_identity.app_session where token_sha256=$1 and revoked_at is null and expires_at>clock_timestamp()',[digest(targetToken)]);
  if(current&&current.user_id!==row.user_id)throw new ForbiddenException({code:'auth.agencyHandoffOtherUser'});
 }
 async start(token:string,input:unknown){
  const body=command(input,['organizationId','verifierHash']);if(!uuid.test(body.organizationId!)||!/^[a-f0-9]{64}$/.test(body.verifierHash!))throw invalid();
  const origin=this.origin();if(!await this.agencies.allowsOrigin(origin))throw invalid();
  return this.database.transaction(async manager=>{
   const session=await this.sessions.getAuthenticated(token,new Date(),false,manager);await this.eligible(manager,session.user.id);
   if(session.authenticationSource==='oidc')throw invalid();
   const agency=(await this.agencies.accessible(session.user.id,manager)).find(a=>a.id===body.organizationId);
   if(!agency)throw new ForbiddenException({code:'auth.agencyUnavailable'});
   const hostname=agency.hostname??(process.env.NODE_ENV!=='production'&&agency.id===SYNTHETIC_DEMO_FIXTURE.organizationId?'demo.localhost':null);
   if(!hostname)return {targetUrl:null};
   const targetOrigin=registeredAgencyOrigin(hostname);if(targetOrigin===origin)return {targetUrl:null};
   const transactionId=randomUUID();
   const inserted=mutationRows<{id:string}>(await manager.query(`insert into app_identity.agency_session_handoff(id,source_session_id,target_organization_id,source_origin,target_origin,verifier_sha256,expires_at)
    select $1,id,$2,$3,$4,$5,least(expires_at,clock_timestamp()+interval '90 seconds') from app_identity.app_session where token_sha256=$6 and revoked_at is null and expires_at>clock_timestamp() returning id`,[transactionId,agency.id,origin,targetOrigin,body.verifierHash,digest(token)]));
   if(!inserted.length)throw invalid();
   return {transactionId,targetUrl:destination(targetOrigin,'prepare',{transactionId}),targetOrigin};
  });
 }
 async challenge(input:unknown,targetToken?:string){
  const body=command(input,['transactionId']),origin=this.origin(),correlation=secret();
  const result=await this.database.transaction(async manager=>{
   const row=await this.row(manager,body.transactionId!,true);if(row.target_origin!==origin||row.issued_at)throw invalid();
   await this.target(manager,row);await this.sameTargetUser(manager,row,targetToken);
   await manager.query('update app_identity.agency_session_handoff set challenge_sha256=$2 where id=$1',[row.id,digest(correlation)]);
   return {sourceUrl:destination(row.source_origin,'issue',{transactionId:row.id,challengeHash:digest(correlation)})};
  });return {...result,correlation};
 }
 async issue(token:string,input:unknown){
  const body=command(input,['transactionId','verifier','challengeHash']),origin=this.origin(),code=secret();
  if(!await this.agencies.allowsOrigin(origin))throw invalid();
  if(!/^[A-Za-z0-9_-]{43}$/.test(body.verifier!)||!/^[a-f0-9]{64}$/.test(body.challengeHash!))throw invalid();
  return this.database.transaction(async manager=>{
   await this.sessions.lockPersonalAuthenticationContext(manager,null,token);
   const session=await this.sessions.getAuthenticated(token,new Date(),false,manager);
   const row=await this.row(manager,body.transactionId!,true);
   if(row.source_origin!==origin||row.user_id!==session.user.id||row.verifier_sha256!==digest(body.verifier!)||row.challenge_sha256!==body.challengeHash||row.issued_at)throw invalid();
   const [source]=await manager.query<Array<{id:string}>>('select id from app_identity.app_session where token_sha256=$1 and id=$2 and revoked_at is null',[digest(token),row.source_session_id]);if(!source)throw invalid();
   await this.target(manager,row);
   await manager.query('update app_identity.agency_session_handoff set code_sha256=$2,issued_at=clock_timestamp() where id=$1',[row.id,digest(code)]);
   await manager.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='agency_handoff' where id=$1",[row.source_session_id]);
   return {targetUrl:destination(row.target_origin,'consume',{transactionId:row.id,code})};
  });
 }
 async consume(input:unknown,correlation:string,targetToken?:string):Promise<CreatedSession>{
  const body=command(input,['transactionId','code']),origin=this.origin();if(!/^[A-Za-z0-9_-]{43}$/.test(body.code!)||!/^[A-Za-z0-9_-]{43}$/.test(correlation))throw invalid();
  return this.database.transaction(async manager=>{
   const before=await this.row(manager,body.transactionId!);
   await manager.query('select id from app_identity.app_user where id=$1 for share',[before.user_id]);
   const row=await this.row(manager,body.transactionId!,true);
   if(row.target_origin!==origin||!row.issued_at||row.code_sha256!==digest(body.code!)||row.challenge_sha256!==digest(correlation))throw invalid();
   await this.target(manager,row);await this.sameTargetUser(manager,row,targetToken);
   const source=await manager.query(`select s.id from app_identity.app_session s join app_identity.local_credential c on c.user_id=s.user_id
    where s.id=$1 and s.authentication_source='local' and s.revoked_at is not null and s.revocation_reason='agency_handoff'
     and s.expires_at>clock_timestamp() and c.credential_version=s.credential_version and not c.must_change_password for update of s`,[row.source_session_id]);if(!source.length)throw invalid();
   if(targetToken)await manager.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='agency_handoff' where token_sha256=$1 and user_id=$2 and revoked_at is null",[digest(targetToken),row.user_id]);
   const token=secret(),csrf=secret();
   await manager.query(`insert into app_identity.app_session select (jsonb_populate_record(null::app_identity.app_session,to_jsonb(s)||jsonb_build_object(
    'id',gen_random_uuid(),'token_sha256',$2::text,'csrf_sha256',$3::text,'organization_id',$4::uuid,'browser_origin',$5::text,
    'revoked_at',null,'revocation_reason',null,'last_activity_at',clock_timestamp(),'installation_registration_id',null))).*
    from app_identity.app_session s where s.id=$1`,[row.source_session_id,digest(token),digest(csrf),row.target_organization_id,origin]);
   await manager.query('update app_identity.agency_session_handoff set consumed_at=clock_timestamp() where id=$1',[row.id]);
   await manager.query(`insert into app_identity.organization_event(organization_id,actor_id,action,details) values($1,$2,'agency.switch',jsonb_build_object('handoff',true))`,[row.target_organization_id,row.user_id]);
   const session=await this.sessions.getAuthenticated(token,new Date(),false,manager);
   return {sessionToken:token,session:{...session,csrfToken:csrf}};
  });
 }
}
