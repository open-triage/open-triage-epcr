import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type { ShiftCheckpoint, UnitSchedulePreview, WeeklySchedule, WeeklyScheduleVersion } from "@open-triage/contracts";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { validateSchedule } from "./schedule-validation.js";
import { evaluateSchedule } from "./schedule-evaluation.js";
type Selection={revision:number;schedule_id:string|null;effective_at:Date|string;fallback_checkpoint:ShiftCheckpoint|null};
@Injectable()
export class SchedulesService {
  constructor(@InjectDataSource() private readonly database:DataSource, private readonly sessions:ClinicianSessionService) {}
  private async now(manager:EntityManager) { const [row]=await manager.query<Array<{now:Date}>>("select clock_timestamp() as now");return new Date(row!.now).getTime(); }
  private async schedule(manager:EntityManager, id:string, organizationId:string):Promise<WeeklySchedule> {
    const [row]=await manager.query<Array<Omit<WeeklySchedule,'versions'>>>(`select id,group_id as "groupId",name,revision from app_identity.weekly_schedule
      where id=$1 and group_id=app_identity.organization_group($2)`,[id,organizationId]);
    if(!row) throw new NotFoundException("Schedule not found in this agency group");
    const versions=await manager.query<Array<{revision:number;effective_at:Date|string;breakpoints:WeeklyScheduleVersion['breakpoints']}>>(`select revision,effective_at,breakpoints from app_identity.weekly_schedule_version where schedule_id=$1 order by revision`,[id]);
    return {...row,versions:versions.map(version=>({revision:version.revision,effectiveAt:new Date(version.effective_at).toISOString(),breakpoints:version.breakpoints}))};
  }
  async list(token:string) {
    const actor=await this.sessions.requireCapability(token,"settings:read");
    const rows=await this.database.query<WeeklySchedule[]>(`select schedule.id,schedule.group_id as "groupId",schedule.name,schedule.revision,
      coalesce(jsonb_agg(jsonb_build_object('revision',version.revision,'effectiveAt',version.effective_at,'breakpoints',version.breakpoints)
        order by version.revision) filter(where version.schedule_id is not null),'[]'::jsonb) as versions
      from app_identity.weekly_schedule schedule left join app_identity.weekly_schedule_version version on version.schedule_id=schedule.id
      where schedule.group_id=app_identity.organization_group($1) group by schedule.id order by schedule.name,schedule.id limit 501`,[actor.organization.id]);
    if(rows.length>500) throw new UnprocessableEntityException("Schedule directory exceeds 500 entries");
    return {items:rows.map(row=>({...row,versions:row.versions.map(version=>({...version,effectiveAt:new Date(version.effectiveAt).toISOString()}))}))};
  }
  async save(token:string,id:string|null,input:unknown) {
    const body=validateSchedule(input,!!id);
    return this.database.transaction(async manager=>{
      const actor=await this.sessions.requireCapability(token,"settings:write",manager);
      let now=0,effectiveAt=0,revision=1;
      if(id) {
        await manager.query("select id from app_identity.weekly_schedule where id=$1 and group_id=app_identity.organization_group($2) for update",[id,actor.organization.id]);
        now=await this.now(manager);effectiveAt=now;
        const prior=await this.schedule(manager,id,actor.organization.id);
        if(prior.revision!==body.expectedRevision) throw new ConflictException("Schedule changed; reload before saving");
        if(Date.parse(prior.versions.at(-1)!.effectiveAt)>now) throw new ConflictException("A schedule change is already pending");
        const zones=await manager.query<Array<{time_zone:string}>>(`select distinct agency.deployment_timezone as time_zone
          from app_identity.unit_schedule_selection selection join app_identity.organization agency on agency.id=selection.organization_id
          where selection.schedule_id=$1 and (selection.revision=(select max(latest.revision) from app_identity.unit_schedule_selection latest where latest.unit_id=selection.unit_id)
          or selection.revision=(select max(active.revision) from app_identity.unit_schedule_selection active where active.unit_id=selection.unit_id and active.effective_at<=$2))`,[id,new Date(now)]);
        if(!zones.length) {
          const [agency]=await manager.query<Array<{time_zone:string}>>("select deployment_timezone as time_zone from app_identity.organization where id=$1",[actor.organization.id]);zones.push(agency!);
        }
        for(const zone of zones) {const next=evaluateSchedule(prior.versions,zone.time_zone,now).nextCheckpoint;if(next)effectiveAt=Math.max(effectiveAt,Date.parse(next.at));}
        revision=prior.revision+1;
        await manager.query("update app_identity.weekly_schedule set name=$2,revision=$3 where id=$1",[id,body.name,revision]);
      } else {
        // The directory cap is serialized per group so concurrent authors cannot create an unreadable directory.
        await manager.query("select id from app_identity.organization where id=app_identity.organization_group($1) for update",[actor.organization.id]);
        const [capacity]=await manager.query<Array<{count:string}>>("select count(*) as count from app_identity.weekly_schedule where group_id=app_identity.organization_group($1)",[actor.organization.id]);
        if(Number(capacity!.count)>=500)throw new UnprocessableEntityException("This agency group has reached the 500-schedule limit; reuse or edit an existing schedule");
        now=await this.now(manager);effectiveAt=now;id=randomUUID();
        await manager.query(`insert into app_identity.weekly_schedule(id,group_id,name) values($1,app_identity.organization_group($2),$3)`,[id,actor.organization.id,body.name]);
      }
      await manager.query(`insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id)
        values($1,$2,$3,$4::jsonb,$5)`,[id,revision,new Date(effectiveAt),JSON.stringify(body.breakpoints),actor.user.id]);
      return this.schedule(manager,id!,actor.organization.id);
    });
  }
  private async preview(manager:EntityManager, organizationId:string, unitId:string, now:number):Promise<UnitSchedulePreview> {
    const [unit]=await manager.query<Array<{time_zone:string}>>(`select agency.deployment_timezone as time_zone from app_identity.operational_unit unit
      join app_identity.organization agency on agency.id=unit.organization_id where unit.id=$1 and unit.organization_id=$2`,[unitId,organizationId]);
    if(!unit)throw new NotFoundException("Unit not found in this agency");
    const selections=await manager.query<Selection[]>(`select revision,schedule_id,effective_at,fallback_checkpoint from app_identity.unit_schedule_selection
      where organization_id=$1 and unit_id=$2 order by revision desc limit 2`,[organizationId,unitId]);
    const pending=selections.find(selection=>new Date(selection.effective_at).getTime()>now);
    const selection=selections.find(selection=>new Date(selection.effective_at).getTime()<=now);
    const schedule=selection?.schedule_id?await this.schedule(manager,selection.schedule_id,organizationId):null;
    const [prior]=await manager.query<Array<{time_zone:string;context_started_at:Date|string;selection_revision:number;fallback_checkpoint:ShiftCheckpoint|null;details:UnitSchedulePreview}>>(
      "select time_zone,context_started_at,selection_revision,fallback_checkpoint,details from app_identity.unit_schedule_evaluation where organization_id=$1 and unit_id=$2",[organizationId,unitId]);
    let contextStartedAt=selection?new Date(selection.effective_at).getTime():now;
    let fallback=selection?.fallback_checkpoint??null;
    if(prior && prior.selection_revision===(selection?.revision??0)) {
      if(prior.time_zone!==unit.time_zone){
        contextStartedAt=now;
        fallback=schedule?evaluateSchedule(schedule.versions,prior.time_zone,now,new Date(prior.context_started_at).getTime(),prior.fallback_checkpoint).activeCheckpoint:null;
      }
      else {contextStartedAt=new Date(prior.context_started_at).getTime();fallback=prior.fallback_checkpoint;}
    }
    const result=schedule?evaluateSchedule(schedule.versions,unit.time_zone,now,contextStartedAt,fallback):null;
    const preview:UnitSchedulePreview={unitId,timeZone:unit.time_zone,evaluatedAt:new Date(now).toISOString(),selectionRevision:selections[0]?.revision??0,
      scheduleId:schedule?.id??null,scheduleName:schedule?.name??null,effectiveAt:selection?new Date(selection.effective_at).toISOString():null,
      pending:pending?{scheduleId:pending.schedule_id,effectiveAt:new Date(pending.effective_at).toISOString()}:null,
      state:!schedule?'missing':result!.blank?'blank':'scheduled',activeCheckpoint:result?.blank?null:result?.activeCheckpoint??null,
      nextCheckpoint:result?.nextCheckpoint??null,graceCheckpoints:result?.graceCheckpoints??[]};
    await manager.query(`insert into app_identity.unit_schedule_evaluation(organization_id,unit_id,evaluated_at,details,time_zone,context_started_at,selection_revision,fallback_checkpoint)
      values($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb) on conflict(organization_id,unit_id) do update set evaluated_at=excluded.evaluated_at,details=excluded.details,
      time_zone=excluded.time_zone,context_started_at=excluded.context_started_at,selection_revision=excluded.selection_revision,fallback_checkpoint=excluded.fallback_checkpoint
      where app_identity.unit_schedule_evaluation.evaluated_at<=excluded.evaluated_at`,[organizationId,unitId,new Date(now),JSON.stringify(preview),unit.time_zone,new Date(contextStartedAt),selection?.revision??0,JSON.stringify(fallback)]);
    return preview;
  }
  async getPreview(token:string,unitId:string) {
    const actor=await this.sessions.requireCapability(token,"settings:read");return this.preview(this.database.manager,actor.organization.id,unitId,await this.now(this.database.manager));
  }
  async select(token:string,unitId:string,input:unknown) {
    if(!input||typeof input!=="object"||Array.isArray(input))throw new UnprocessableEntityException("Invalid schedule selection");
    const body=input as {scheduleId:unknown;expectedRevision:unknown};
    if(Object.keys(body).some(key=>!["scheduleId","expectedRevision"].includes(key)) ||
      !(body.scheduleId===null||typeof body.scheduleId==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(body.scheduleId)) ||
      !Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new UnprocessableEntityException("Invalid schedule selection");
    return this.database.transaction(async manager=>{
      const actor=await this.sessions.requireCapability(token,"settings:write",manager);
      await manager.query("select id from app_identity.operational_unit where organization_id=$1 and id=$2 for update",[actor.organization.id,unitId]);
      // Serialize relevant schedule edits with selection without locking unrelated agencies' units.
      await manager.query(`select schedule.id from app_identity.weekly_schedule schedule
        where schedule.group_id=app_identity.organization_group($3) and (schedule.id=$1::uuid
        or schedule.id in (select selection.schedule_id from app_identity.unit_schedule_selection selection where selection.unit_id=$2 order by selection.revision desc limit 2))
        order by schedule.id for share`,[body.scheduleId,unitId,actor.organization.id]);
      const now=await this.now(manager),before=await this.preview(manager,actor.organization.id,unitId,now);
      if(before.selectionRevision!==body.expectedRevision||before.pending)throw new ConflictException("Selection changed or pending; reload before saving");
      if(body.scheduleId)await this.schedule(manager,body.scheduleId as string,actor.organization.id);
      const effectiveAt=before.nextCheckpoint?.at??new Date(now).toISOString();
      await manager.query(`insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,fallback_checkpoint,actor_id)
        values($1,$2,$3,$4,$5,$6::jsonb,$7)`,[actor.organization.id,unitId,before.selectionRevision+1,body.scheduleId,effectiveAt,JSON.stringify(before.activeCheckpoint),actor.user.id]);
      return this.preview(manager,actor.organization.id,unitId,now);
    });
  }
}
