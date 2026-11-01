import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DestinationEntry, DestinationPage, SaveDestinationCommand } from '@open-triage/contracts';
import { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { mutationRows } from '../database/mutation-result.js';
const columns=`id,group_id as "groupId",revision,local_code as "localCode",display_name as "displayName",hsa_id as "hsaId",active`;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function validateDestination(input:unknown,editing:boolean):SaveDestinationCommand {
 const invalid=()=>{throw new UnprocessableEntityException({code:'hospital.destinationInvalid'});};
 if(!input||typeof input!=='object'||Array.isArray(input))return invalid();
 const body=input as Record<string,unknown>;
 if(Object.keys(body).some(key=>!['localCode','displayName','hsaId','active',...(editing?['expectedRevision']:[])].includes(key)))return invalid();
 const text=(key:string,max:number,optional=false)=>{const value=body[key];if(optional&&value===null)return null;
  if(typeof value!=='string'||value.trim().length<(optional?1:2)||value.length>max||/[\p{Cc}\p{Cf}]/u.test(value))return invalid();return value.trim();};
 if(typeof body.active!=='boolean'||editing&&(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<1))return invalid();
 return {localCode:text('localCode',50)!,displayName:text('displayName',100)!,hsaId:text('hsaId',128,true),active:body.active,
  ...(editing?{expectedRevision:Number(body.expectedRevision)}:{})};
}
@Injectable()
export class DestinationService {
 constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService){}
 async list(token:string,search='',cursor?:string,admin=false):Promise<DestinationPage>{
  const actor=admin?await this.sessions.requireCapability(token,'settings:read'):await this.sessions.requireCapability(token,'clinical:document');
  if(cursor&&!uuid.test(cursor)||search.length>100)throw new UnprocessableEntityException({code:'hospital.destinationInvalid'});
  const rows=await this.database.query<DestinationEntry[]>(`select ${columns} from app_identity.destination_directory
   where group_id=app_identity.organization_group($1) and ($2::boolean or active)
    and ($3::uuid is null or id>$3) and ($4='' or strpos(lower(display_name),lower($4))>0 or strpos(lower(local_code),lower($4))>0)
   order by id limit 51`,[actor.organization.id,admin,cursor??null,search.trim()]);
  return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.id:null};
 }
 async save(token:string,id:string|null,input:unknown):Promise<DestinationEntry>{
  const body=validateDestination(input,!!id);
  try{return await this.database.transaction(async manager=>{
   const actor=await this.sessions.requireCapability(token,'settings:write',manager);
   const [group]=await manager.query<Array<{id:string}>>('select app_identity.organization_group($1) id',[actor.organization.id]);
   if(id){const [before]=await manager.query<DestinationEntry[]>(`select ${columns} from app_identity.destination_directory where group_id=$1 and id=$2 for update`,[group!.id,id]);
    if(!before)throw new NotFoundException({code:'hospital.destinationMissing'});
    if(before.revision!==body.expectedRevision)throw new ConflictException({code:'hospital.destinationStale'});
   }
   const rows=id?mutationRows<DestinationEntry>(await manager.query(`update app_identity.destination_directory set local_code=$3,display_name=$4,hsa_id=$5,active=$6,revision=revision+1 where group_id=$1 and id=$2 returning ${columns}`,[group!.id,id,body.localCode,body.displayName,body.hsaId,body.active])):
    mutationRows<DestinationEntry>(await manager.query(`insert into app_identity.destination_directory(group_id,id,local_code,display_name,hsa_id,active) values($1,$2,$3,$4,$5,$6) returning ${columns}`,[group!.id,randomUUID(),body.localCode,body.displayName,body.hsaId,body.active]));
   const entry=rows[0]!;
   await manager.query(`insert into app_identity.destination_revision(group_id,destination_id,revision,local_code,display_name,hsa_id,active,actor_id) values($1,$2,$3,$4,$5,$6,$7,$8)`,[group!.id,entry.id,entry.revision,entry.localCode,entry.displayName,entry.hsaId,entry.active,actor.user.id]);
   return entry;
  });}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')throw new ConflictException({code:'hospital.destinationDuplicate'});throw error;}
 }
}
