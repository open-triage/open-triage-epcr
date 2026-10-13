import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { randomUUID } from "node:crypto";
import { UserRoleAssignmentService } from "../admin/user-role-assignment.service.js";
import { validateReplaceAdminUserRoles } from "../admin/user-role-assignment.validation.js";
import { validateUpdateAdminUser } from "../admin/user-lifecycle.validation.js";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import type { OidcDraft } from "./oidc-draft.service.js";

export type ValidatedRegionalIdentity = { issuer: string; subject: string; displayName: string | null; email: string | null };
type RequestRow = { id:string;group_id:string;provider_id:string;first_revision:string;issuer:string;subject:string;display_name:string|null;email:string|null;created_at:Date;linked_user_id:string|null;linked_at:Date|null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const conflict = () => new ConflictException({code:"admin.regionalIdentityConflict"});
function view(row:RequestRow){return {id:row.id,providerId:row.provider_id,revision:Number(row.first_revision),issuer:row.issuer,subject:row.subject,
  displayName:row.display_name,email:row.email,createdAt:row.created_at.toISOString(),status:row.linked_user_id?"linked":"pending",linkedUserId:row.linked_user_id,linkedAt:row.linked_at?.toISOString()??null};}
/** The validated keys never pass through profile mapping, trimming or case folding. */
export function regionalIdentity(claims:Record<string,unknown>,mappings:OidcDraft["mappings"]):ValidatedRegionalIdentity {
  const issuer=claims.iss,subject=claims.sub;
  if(typeof issuer!=="string"||!issuer||Buffer.byteLength(issuer)>2048||typeof subject!=="string"||!subject||Buffer.byteLength(subject)>255||/[\u0000-\u001f\u007f]/.test(subject))throw new Error("Invalid regional identity");
  const hint=(key:string,limit:number)=>{const value=Object.hasOwn(claims,key)?claims[key]:null;return typeof value==="string"&&!/[\u0000-\u001f\u007f]/.test(value)&&value.length<=limit?value:null;};
  return {issuer,subject,displayName:hint(mappings.displayName,256),email:hint(mappings.email,320)};
}
@Injectable()
export class RegionalIdentityService {
  constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService, private readonly roles:UserRoleAssignmentService=new UserRoleAssignmentService(database,sessions)){}
  /** Called only after code/signature validation and final transaction binding checks. */
  async record(manager:EntityManager,scope:{groupId:string;providerId:string;revision:number;organizationId:string},identity:ValidatedRegionalIdentity){
    const params=[scope.groupId,scope.providerId,scope.revision,scope.organizationId,identity.issuer,identity.subject,identity.displayName,identity.email];
    const rows=mutationRows<RequestRow>(await manager.query(`insert into app_identity.regional_identity_request
      (group_id,provider_id,first_revision,organization_id,issuer,subject,display_name,email)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(group_id,provider_id,issuer,subject) do nothing returning *`,params));
    const row=rows[0]??(await manager.query<RequestRow[]>(`select * from app_identity.regional_identity_request
      where group_id=$1 and provider_id=$2 and issuer=$3 and subject=$4`,[scope.groupId,scope.providerId,identity.issuer,identity.subject]))[0];
    if(!row)throw conflict();
    return {requestId:row.id,status:row.linked_user_id?"linked":"pending",ordinaryAccess:false};
  }
  private async authority(token:string,write:boolean,manager:EntityManager=this.database.manager){
    const actor=await this.sessions.requireCapability(token,"settings:read",manager);
    if(!actor.capabilities?.includes("users:read")||write&&(!actor.capabilities.includes("settings:write")||!actor.capabilities.includes("users:write")))throw new ForbiddenException({code:"admin.regionalIdentityForbidden"});
    if(write)await this.sessions.requireRecentReauthentication(token,manager);
    const [group]=await manager.query<Array<{id:string}>>("select app_identity.organization_group($1) id",[actor.organization.id]);
    return {actor,groupId:group!.id};
  }
  async list(token:string,input:Record<string,unknown>){
    const {groupId}=await this.authority(token,false);
    if(Object.keys(input).some(key=>!['cursor','limit'].includes(key)))throw new BadRequestException("Invalid request query");
    const limit=input.limit===undefined?25:Number(input.limit);
    if(!Number.isInteger(limit)||limit<1||limit>50||input.cursor!==undefined&&(typeof input.cursor!=="string"||!uuid.test(input.cursor)))throw new BadRequestException("Invalid request pagination");
    const rows=await this.database.query<RequestRow[]>(`select r.* from app_identity.regional_identity_request r
      where r.group_id=$1 and ($2::uuid is null or (r.created_at,r.id)<(select created_at,id from app_identity.regional_identity_request where id=$2 and group_id=$1))
      order by r.created_at desc,r.id desc limit $3`,[groupId,input.cursor??null,limit+1]);
    const visible=rows.slice(0,limit);
    const providers=await this.database.query<Array<{source:"draft"|"active";revision:string;provider_id:string;issuer:string}>>(`
      select 'draft' as source,v.revision,v.provider_id,v.configuration->>'issuer' issuer
      from app_identity.oidc_provider_state s join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=s.draft_revision where s.group_id=$1
      union all select 'active',v.revision,v.provider_id,v.configuration->>'issuer'
      from app_identity.oidc_provider_state s join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=s.active_revision where s.group_id=$1`,[groupId]);
    return {groupId,items:visible.map(row=>({...view(row),reviewProviders:providers.filter(provider=>provider.provider_id===row.provider_id&&provider.issuer===row.issuer).map(provider=>({source:provider.source,revision:Number(provider.revision)}))})),nextCursor:rows.length>limit?visible.at(-1)!.id:null};
  }
  async approve(token:string,requestId:string,input:unknown){
    if(!uuid.test(requestId)||!input||typeof input!=="object"||Array.isArray(input))throw new BadRequestException("New regional user details are required");
    const command=input as Record<string,unknown>;
    if(Object.keys(command).some(key=>!["displayName","roleIds","note","providerSource","expectedProviderRevision"].includes(key))||
      typeof command.providerSource!=="string"||!["draft","active"].includes(command.providerSource)||command.note!==undefined&&typeof command.note!=="string"||!Number.isSafeInteger(command.expectedProviderRevision)||Number(command.expectedProviderRevision)<1)
      throw new BadRequestException("An explicit current provider version is required");
    const profile=validateUpdateAdminUser({expectedRevision:1,username:null,displayName:command.displayName,active:true,note:command.note});
    const assignments=validateReplaceAdminUserRoles({expectedRevision:1,roleIds:command.roleIds,note:command.note});
    try{return await this.database.transaction(async manager=>{
      await this.authority(token,true,manager);
      await this.sessions.requireCapability(token,"roles:assign",manager);
      await manager.query("select user_id from app_identity.installation_owner for update");
      const {actor,groupId}=await this.authority(token,true,manager);
      const [request]=await manager.query<RequestRow[]>("select * from app_identity.regional_identity_request where id=$1 and group_id=$2 for update",[requestId,groupId]);
      if(!request)throw new NotFoundException({code:"admin.regionalIdentityMissing"});
      if(request.linked_user_id)throw conflict();
      // A draft test is evidence for its immutable provider keys, never active login evidence.
      // Bind the administrator's explicit choice to the current draft or active revision.
      const [provider]=await manager.query<Array<{revision:string;provider_id:string;issuer:string}>>(`
        select v.revision,v.provider_id,v.configuration->>'issuer' issuer
        from app_identity.oidc_provider_state s join app_identity.oidc_provider_version v
          on v.group_id=s.group_id and v.revision=case when $2='active' then s.active_revision else s.draft_revision end
        where s.group_id=$1 for update of s`,[groupId,command.providerSource]);
      if(!provider||Number(provider.revision)!==command.expectedProviderRevision||provider.provider_id!==request.provider_id||provider.issuer!==request.issuer)throw conflict();
      const userId=randomUUID();
      await manager.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,$3)",[userId,groupId,profile.displayName]);
      await this.roles.replaceInTransaction(manager,token,userId,assignments);
      const final=await this.authority(token,true,manager);
      if(final.groupId!==groupId||final.actor.user.id!==actor.user.id||final.actor.organization.id!==actor.organization.id)throw new ForbiddenException({code:"admin.regionalIdentityForbidden"});
      const [linked]=mutationRows<RequestRow>(await manager.query(`update app_identity.regional_identity_request set linked_user_id=$2,linked_by=$3,linked_at=now() where id=$1 and linked_user_id is null returning *`,[requestId,userId,actor.user.id]));
      if(!linked)throw conflict();
      await manager.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result,target_user_id,note,details)
        values($1,$2,'account.provision','succeeded',$3,$4,$5::jsonb)`,[actor.organization.id,actor.user.id,userId,profile.note??null,
        JSON.stringify({kind:"regional_identity",operation:"approved",requestId,revision:Number(request.first_revision),providerSource:command.providerSource,providerRevision:provider.revision,roleIds:assignments.roleIds})]);
      return {...view(linked),ordinaryAccess:false};
    });}catch(error){if(error&&typeof error==='object'&&'code' in error&&['23505','23514'].includes(String(error.code)))throw conflict();throw error;}
  }
  async link(token:string,requestId:string,input:unknown){
    const command=input as Record<string,unknown>;
    if(!uuid.test(requestId)||!command||typeof command!=="object"||Array.isArray(command)||Object.keys(command).some(key=>key!=="userId")||typeof command.userId!=="string"||!uuid.test(command.userId))throw new BadRequestException("An existing user is required");
    try{return await this.database.transaction(async manager=>{
      await this.authority(token,true,manager);
      // Keep the protected-owner lock order shared with account lifecycle changes.
      await manager.query("select user_id from app_identity.installation_owner for update");
      const {actor,groupId}=await this.authority(token,true,manager);
      const [request]=await manager.query<RequestRow[]>("select * from app_identity.regional_identity_request where id=$1 and group_id=$2 for update",[requestId,groupId]);
      if(!request)throw new NotFoundException({code:"admin.regionalIdentityMissing"});
      if(request.linked_user_id){if(request.linked_user_id===command.userId)return view(request);throw conflict();}
      const [current]=await manager.query<Array<{provider_id:string;issuer:string}>>(`select v.provider_id,v.configuration->>'issuer' issuer from app_identity.oidc_provider_state s join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=s.draft_revision where s.group_id=$1 for update of s`,[groupId]);
      if(current?.provider_id!==request.provider_id||current.issuer!==request.issuer)throw conflict();
      const [target]=await manager.query<Array<{id:string}>>(`select u.id from app_identity.app_user u
        where u.id=$1 and u.active and u.account_scope='agency' and app_identity.organization_group(u.organization_id)=$2
        and not exists(select 1 from app_identity.installation_owner where user_id=u.id)
        and not exists(select 1 from app_identity.installation_superadmin where user_id=u.id) for update of u`,[command.userId,groupId]);
      if(!target)throw new ForbiddenException({code:"admin.regionalIdentityTarget"});
      // Role authoring updates the role row; assignment/lifecycle changes share
      // the owner and user locks. Hold assigned roles through the final checks.
      await manager.query(`select r.id from app_identity.user_role_assignment a
        join app_identity.role r on r.id=a.role_id and r.organization_id=a.organization_id
        where a.user_id=any($1::uuid[]) and a.ended_at is null order by r.organization_id,r.id for share of r`,[[target.id,actor.user.id]]);
      const currentAuthority=await this.authority(token,true,manager);
      if(currentAuthority.groupId!==groupId||currentAuthority.actor.user.id!==actor.user.id||currentAuthority.actor.organization.id!==actor.organization.id)throw new ForbiddenException({code:"admin.regionalIdentityForbidden"});
      const stronger=await manager.query(`select 1 from app_identity.user_role_assignment a
        join app_identity.role r on r.id=a.role_id and r.organization_id=a.organization_id and r.active and r.assignable
        join app_identity.role_version_capability c on c.role_version_id=r.current_version_id
        join app_identity.capability d on d.key=c.capability_key and d.administrative
        where a.user_id=$1 and a.ended_at is null and not(c.capability_key=any($2::text[])) limit 1`,[target.id,currentAuthority.actor.capabilities??[]]);
      if(stronger.length)throw new ForbiddenException({code:"admin.regionalIdentityTarget"});
      const [linked]=mutationRows<RequestRow>(await manager.query(`update app_identity.regional_identity_request set linked_user_id=$2,linked_by=$3,linked_at=now() where id=$1 and linked_user_id is null returning *`,[requestId,target.id,actor.user.id]));
      if(!linked)throw conflict();
      await manager.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result,target_user_id,details)
        values($1,$2,'authentication.policy_update','succeeded',$3,$4::jsonb)`,[actor.organization.id,actor.user.id,target.id,JSON.stringify({kind:"regional_identity",operation:"linked",requestId,revision:Number(request.first_revision)})]);
      return view(linked);
    });}catch(error){if(error&&typeof error==='object'&&'code' in error&&['23505','23514'].includes(String(error.code)))throw conflict();throw error;}
  }
}
