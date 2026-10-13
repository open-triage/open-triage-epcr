import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
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
  constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService){}
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
    return {groupId,items:visible.map(view),nextCursor:rows.length>limit?visible.at(-1)!.id:null};
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
