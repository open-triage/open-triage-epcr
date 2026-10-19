import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { CosConnectionSettings } from '@open-triage/contracts';
import { reconcileCosFailure } from './cos-recovery-review.js';
export const DEFAULT_COS_RETRIES = [1,5,15,30,60];
/** Stable bounded jitter makes restart explanations reproducible without storing random state. */
export function cosRetryDelayMilliseconds(deliveryId:string,ordinal:number,minutes:number){
 const sample=createHash('sha256').update(`${deliveryId}:${ordinal}`).digest().readUInt32BE(0)/0xffffffff;
 return Math.round(minutes*60000*(0.9+sample*0.2));
}
export async function pinCosRetryPolicy(manager:EntityManager,deliveryId:string,revision:string,settings:CosConnectionSettings){
 await manager.query(`insert into clinical.cos_retry_policy(delivery_id,report_id,configuration_revision,schedule_minutes) select id,report_id,$2,$3::jsonb from clinical.cos_delivery where id=$1 on conflict do nothing`,[deliveryId,revision,JSON.stringify(settings.retryScheduleMinutes??DEFAULT_COS_RETRIES)]);
 await manager.query('insert into clinical.cos_retry_state(delivery_id) values($1) on conflict do nothing',[deliveryId]);
}
/** Caller holds the report lock; only proven definite outages create durable due work. */
export async function updateCosRetryDue(manager:EntityManager,deliveryId:string,state:string,finding:string|null,now:Date){
 const [policy]=await manager.query<Array<{schedule_minutes:number[];retries_used:number}>>(`select p.schedule_minutes,s.retries_used from clinical.cos_retry_policy p join clinical.cos_retry_state s using(delivery_id) where delivery_id=$1 for update of s`,[deliveryId]);
 if(!policy)return;
 const minutes=policy.schedule_minutes[policy.retries_used];
 const due=state==='failed'&&finding==='outage'&&minutes!==undefined?new Date(now.getTime()+cosRetryDelayMilliseconds(deliveryId,policy.retries_used+1,minutes)):null;
 await manager.query('update clinical.cos_retry_state set next_due=$2 where delivery_id=$1',[deliveryId,due]);
}
/** Append through the same immutable recovery-command journal consumed by the ordinary worker. */
export async function scheduleDueCosRetries(database:DataSource,limit:number,now:Date){
 const candidates=await database.query<Array<{delivery_id:string;report_id:string}>>(`select s.delivery_id,d.report_id from clinical.cos_retry_state s join clinical.cos_delivery d on d.id=s.delivery_id join clinical.cos_retry_policy p on p.delivery_id=d.id join app_identity.hospital_cos_state c on c.group_id=d.group_id join clinical.report r on r.id=d.report_id
 where s.next_due<=$1 and s.retries_used<jsonb_array_length(p.schedule_minutes) and d.state='failed' and d.finding='outage' and c.active_revision=d.configuration_revision
 and (r.expires_at is null or r.expires_at>clock_timestamp())
 and exists(select 1 from clinical.review_item i where i.report_id=d.report_id and i.kind='cos-delivery-failed' and i.active_match)
 and not exists(select 1 from clinical.cos_delivery b where b.report_id=d.report_id and (b.state='uncertain' or b.amendment_sequence>d.amendment_sequence or (b.amendment_sequence=d.amendment_sequence and b.created_at>d.created_at)))
 and not exists(select 1 from clinical.amendment a where a.report_id=d.report_id and a.sequence>d.amendment_sequence)
 order by s.next_due,s.delivery_id limit $2`,[now,limit]);
 for(const candidate of candidates)await database.transaction(async manager=>{
  const [lock]=await manager.query<Array<{locked:boolean}>>('select pg_try_advisory_xact_lock(731013,hashtext($1)) locked',[candidate.report_id]);
  if(!lock?.locked)return;
  await manager.query('select id from clinical.report where id=$1 for update',[candidate.report_id]);
  const [due]=await manager.query<Array<{id:string;report_id:string;amendment_sequence:number;configuration_revision:string;mapping_sha256:string;retries_used:number;next_due:Date;item_id:string;item_version:string}>>(`select d.*,s.retries_used,s.next_due,i.id item_id,i.version item_version from clinical.cos_delivery d
   join clinical.cos_retry_state s on s.delivery_id=d.id join clinical.cos_retry_policy p on p.delivery_id=d.id
   join app_identity.hospital_cos_state c on c.group_id=d.group_id
   join clinical.report r on r.id=d.report_id
   join clinical.review_item i on i.report_id=d.report_id and i.kind='cos-delivery-failed' and i.active_match
   where d.id=$1 and s.next_due<=$2 and s.retries_used<jsonb_array_length(p.schedule_minutes)
    and d.state='failed' and d.finding='outage' and c.active_revision=d.configuration_revision
    and (r.expires_at is null or r.expires_at>clock_timestamp())
    and not exists(select 1 from clinical.cos_delivery barrier where barrier.report_id=d.report_id and (barrier.state='uncertain' or barrier.amendment_sequence>d.amendment_sequence or (barrier.amendment_sequence=d.amendment_sequence and barrier.created_at>d.created_at)))
    and not exists(select 1 from clinical.amendment a where a.report_id=d.report_id and a.sequence>d.amendment_sequence)
    for update of d,s for share of c`,[candidate.delivery_id,now]);
  if(!due)return;
  const command=randomUUID(),ordinal=due.retries_used+1;
  await manager.query(`insert into clinical.cos_recovery_command(id,command_sha256,report_id,item_id,delivery_id,actor_id,item_version,amendment_sequence,configuration_revision,mapping_sha256,automatic_ordinal) values($1,$2,$3,$4,$5,null,$6,$7,$8,$9,$10)`,[command,createHash('sha256').update(`automatic:${due.id}:${ordinal}`).digest('hex'),due.report_id,due.item_id,due.id,due.item_version,due.amendment_sequence,due.configuration_revision,due.mapping_sha256,ordinal]);
  await manager.query('update clinical.cos_retry_state set retries_used=$2,next_due=null where delivery_id=$1',[due.id,ordinal]);
  await manager.query("update clinical.cos_delivery set state='pending',finding=null,updated_at=clock_timestamp() where id=$1",[due.id]);
  await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,worker_id,state,evidence) values($1,$2,$3,'pending',$4::jsonb)`,[due.id,due.report_id,command,JSON.stringify({action:'automatic-retry',commandId:command,ordinal,policyRevision:Number(due.configuration_revision),dueAt:due.next_due.toISOString(),reservedAt:now.toISOString()})]);
  await reconcileCosFailure(manager,due.report_id);
 });
}
/** Live operational projection; original policy stays immutable alongside attempt lineage. */
export async function cosRetryStatus(manager:Pick<EntityManager,'query'>,deliveryId:string){
 const [row]=await manager.query<Array<{schedule_minutes:number[];configuration_revision:string;retries_used:number;next_due:Date|null;active_revision:string|null;attempts:number}>>(`select p.*,s.retries_used,s.next_due,c.active_revision,(select count(*)::integer from clinical.cos_attempt a join clinical.cos_recovery_command command on command.id=a.recovery_command_id where command.delivery_id=p.delivery_id and command.automatic_ordinal is not null) attempts from clinical.cos_retry_policy p join clinical.cos_retry_state s using(delivery_id) join clinical.cos_delivery d on d.id=p.delivery_id join app_identity.hospital_cos_state c on c.group_id=d.group_id where p.delivery_id=$1`,[deliveryId]);
 return row?{scheduleMinutes:row.schedule_minutes,configurationRevision:Number(row.configuration_revision),reserved:row.retries_used,attempts:row.attempts,nextDue:row.next_due?.toISOString()??null,exhausted:row.retries_used>=row.schedule_minutes.length,paused:Number(row.active_revision)!==Number(row.configuration_revision)}:undefined;
}
