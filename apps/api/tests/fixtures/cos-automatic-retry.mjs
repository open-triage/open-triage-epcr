import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {processCosWork} from '../../dist/hospital/cos-worker.js';
import {scheduleDueCosRetries,cosRetryDelayMilliseconds,cosRetryStatus} from '../../dist/hospital/cos-automatic-retry.js';
import {CosRejected} from '../../dist/hospital/cos-simulator.js';
import {retryCosReview} from '../../dist/hospital/cos-retry.js';
export async function automaticRetryFixture({db,draft,sign,simulator,group,recoveryReview,recoverySessions,retryInput,config,next,settings}){
 const report=await draft();await sign(report);let now=new Date();const clock=()=>new Date(now);
 const failing={contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)};
 const requestStarted=new Date(now);
 await processCosWork(db,100,{...failing,contact:async()=>{now=new Date(now.getTime()+7*60000);throw new CosRejected('outage');}},clock);
 assert.equal(now-requestStarted,7*60000,'controlled receiver consumes seven minutes before definite failure');
 const [delivery]=await db.query('select * from clinical.cos_delivery where report_id=$1',[report]);
 const [payload]=await db.query('select * from clinical.cos_payload where delivery_id=$1',[delivery.id]);
 const [item]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[report]);
 const schedule=[1,5,15,30,60];
 for(let ordinal=1;ordinal<=5;ordinal++){
  const status=await cosRetryStatus(db,delivery.id);
  assert.deepEqual(status.scheduleMinutes,schedule);assert.equal(status.reserved,ordinal-1);assert.equal(status.attempts,ordinal-1);
  const due=new Date(status.nextDue);const delay=due-now;assert.equal(delay,cosRetryDelayMilliseconds(delivery.id,ordinal,schedule[ordinal-1]));
  assert.ok(delay>=schedule[ordinal-1]*60000*0.9&&delay<=schedule[ordinal-1]*60000*1.1);
  await scheduleDueCosRetries(db,1,new Date(due.getTime()-1));assert.equal((await cosRetryStatus(db,delivery.id)).reserved,ordinal-1);
  // Independent workers reserve each ordinal once and a restarted ordinary worker consumes it.
  now=due;await Promise.all([scheduleDueCosRetries(db,100,now),scheduleDueCosRetries(db,100,now)]);
  assert.equal((await cosRetryStatus(db,delivery.id)).reserved,ordinal);assert.equal((await cosRetryStatus(db,delivery.id)).attempts,ordinal-1);
  await processCosWork(db,100,failing,clock);
  assert.equal((await cosRetryStatus(db,delivery.id)).attempts,ordinal);
  assert.equal((await recoveryReview.item('fixture',item.id,'synthetic')).activeMatch,true);
 }
 let status=await cosRetryStatus(db,delivery.id);assert.equal(status.exhausted,true);assert.equal(status.nextDue,null);
 now=new Date(now.getTime()+10*86400000);await processCosWork(db,100,failing,clock);
 assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where delivery_id=$1',[delivery.id]))[0].n,6);
 assert.deepEqual((await db.query('select * from clinical.cos_payload where delivery_id=$1',[delivery.id]))[0],payload);
 // Deliberate recovery remains possible; exhaustion can never be reset by a manual command.
 const detail=await recoveryReview.item('fixture',item.id,'synthetic');await recoveryReview.claim('fixture',item.id,{commandId:randomUUID(),expectedVersion:detail.version,dataset:'synthetic'});
 await retryCosReview(db,recoverySessions,'fixture',item.id,await retryInput(item.id));await processCosWork(db,100,failing,clock);
 status=await cosRetryStatus(db,delivery.id);assert.equal(status.reserved,5);assert.equal(status.nextDue,null);
 await retryCosReview(db,recoverySessions,'fixture',item.id,await retryInput(item.id));await processCosWork(db,100,simulator,clock);
 assert.equal((await recoveryReview.item('fixture',item.id,'synthetic')).activeMatch,false);
 // Permanent and uncertain outcomes never schedule; deactivation preserves the pinned due time.
 for(const code of ['credentials','payload','identityConflict']){
  const id=await draft();await sign(id);await processCosWork(db,100,{...failing,contact:async()=>{throw new CosRejected(code);}},clock);
  const [d]=await db.query('select id from clinical.cos_delivery where report_id=$1',[id]);assert.equal((await cosRetryStatus(db,d.id)).nextDue,null);
 }
 const paused=await draft();await sign(paused);await processCosWork(db,100,failing,clock);
 const [pd]=await db.query('select id from clinical.cos_delivery where report_id=$1',[paused]);const before=await cosRetryStatus(db,pd.id);
 const [state]=await db.query('select active_revision from app_identity.hospital_cos_state where group_id=$1',[group]);
 await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
 now=new Date(before.nextDue);await scheduleDueCosRetries(db,1,now);assert.equal((await cosRetryStatus(db,pd.id)).reserved,0);assert.equal((await cosRetryStatus(db,pd.id)).paused,true);
 await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,state.active_revision]);
 await processCosWork(db,100,simulator,clock);assert.equal((await recoveryReview.item('fixture',(await db.query("select id from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[paused]))[0].id,'synthetic')).activeMatch,false);
 // A manual/automatic race has exactly one durable command and one receiver attempt.
 const racing=await draft();await sign(racing);await processCosWork(db,100,failing,clock);
 const [rd]=await db.query('select id from clinical.cos_delivery where report_id=$1',[racing]);
 const [ri]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[racing]);
 await recoveryReview.claim('fixture',ri.id,{commandId:randomUUID(),expectedVersion:Number(ri.version),dataset:'synthetic'});
 const command=await retryInput(ri.id);now=new Date((await cosRetryStatus(db,rd.id)).nextDue);
 await Promise.allSettled([retryCosReview(db,recoverySessions,'fixture',ri.id,command),scheduleDueCosRetries(db,100,now)]);
 assert.equal((await db.query('select count(*)::int n from clinical.cos_recovery_command where delivery_id=$1',[rd.id]))[0].n,1);
 await processCosWork(db,100,simulator,clock);
 assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where delivery_id=$1',[rd.id]))[0].n,2);
 // One-item due batches bypass older paused policies, obsolete versions and uncertain barriers.
 const policyPaused=await draft();await sign(policyPaused);await processCosWork(db,100,failing,clock);
 const [old]=await db.query('select * from clinical.cos_delivery where report_id=$1',[policyPaused]);
 const originalPolicy=await cosRetryStatus(db,old.id);
 settings.retryScheduleMinutes=[2,10];await config(next+50);delete settings.retryScheduleMinutes;
 const blockers=[];
 for(const kind of ['uncertain','superseded']){
  const id=await draft();await sign(id);await processCosWork(db,100,failing,clock);
  const [d]=await db.query('select * from clinical.cos_delivery where report_id=$1',[id]);blockers.push(d.id);
  await db.query(`insert into clinical.cos_delivery(id,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,pdf_language,amendment_sequence,lineage_parent_id,queued_by,state,finding)
   select $2,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,pdf_language,amendment_sequence+1,id,queued_by,$3,$4 from clinical.cos_delivery where id=$1`,[d.id,randomUUID(),kind,kind==='uncertain'?'outcomeUnknown':null]);
 }
 const independent=await draft();await sign(independent);await processCosWork(db,100,failing,clock);
 const [eligible]=await db.query('select id from clinical.cos_delivery where report_id=$1',[independent]);
 now=new Date(now.getTime()+86400000);await scheduleDueCosRetries(db,1,now);
 assert.equal((await cosRetryStatus(db,eligible.id)).reserved,1);
 for(const id of [old.id,...blockers])assert.equal((await cosRetryStatus(db,id)).reserved,0);
 assert.equal((await cosRetryStatus(db,old.id)).paused,true);
 assert.deepEqual((await cosRetryStatus(db,old.id)).scheduleMinutes,originalPolicy.scheduleMinutes);
 assert.equal((await cosRetryStatus(db,old.id)).configurationRevision,originalPolicy.configurationRevision);
 await processCosWork(db,100,simulator,clock);
 const superseded=await draft();await sign(superseded);await processCosWork(db,100,failing,clock);
 const [sd]=await db.query('select id from clinical.cos_delivery where report_id=$1',[superseded]);now=new Date((await cosRetryStatus(db,sd.id)).nextDue);
 await scheduleDueCosRetries(db,100,now);
 await db.query(`insert into clinical.cos_delivery(id,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,pdf_language,amendment_sequence,lineage_parent_id,queued_by,state)
  select $2,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,pdf_language,amendment_sequence+1,id,queued_by,'superseded' from clinical.cos_delivery where id=$1`,[sd.id,randomUUID()]);
 await processCosWork(db,100,simulator,clock);
 assert.equal((await cosRetryStatus(db,sd.id)).reserved,1);assert.equal((await cosRetryStatus(db,sd.id)).attempts,0,'superseded reservation is not a receiver attempt');
 // Ordinary synthetic retention owns cleanup of the policy, mutable due state and recovery command.
 const expiring=await draft({},true);await sign(expiring);await processCosWork(db,100,failing,clock);
 const [ed]=await db.query('select id from clinical.cos_delivery where report_id=$1',[expiring]);now=new Date((await cosRetryStatus(db,ed.id)).nextDue);await scheduleDueCosRetries(db,100,now);
 const [expiry]=await db.query('select expires_at from clinical.report where id=$1',[expiring]);assert.ok(expiry.expires_at);
 const rollback=new Error('rollback ordinary retry retention');
 await assert.rejects(db.transaction(async manager=>{
  await manager.query("select retention.purge_expired_synthetic_records($1::timestamptz+interval '1 minute')",[expiry.expires_at]);
  for(const table of ['cos_retry_policy','cos_retry_state','cos_recovery_command'])assert.equal((await manager.query(`select 1 from clinical.${table} where delivery_id=$1`,[ed.id])).length,0,table);
  assert.equal((await manager.query('select 1 from clinical.report where id=$1',[expiring])).length,0);throw rollback;
 }),error=>error===rollback);
 await processCosWork(db,100,simulator,clock);
 const queuedPause=await draft();await sign(queuedPause);await processCosWork(db,100,failing,clock);
 const [qd]=await db.query('select id from clinical.cos_delivery where report_id=$1',[queuedPause]);now=new Date((await cosRetryStatus(db,qd.id)).nextDue);await scheduleDueCosRetries(db,100,now);
 await config(next+51);await processCosWork(db,1,simulator,clock);
 assert.equal((await cosRetryStatus(db,qd.id)).attempts,0);assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[qd.id]))[0].state,'pending','reserved retry pauses across configuration changes');
 await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,next+50]);await processCosWork(db,100,simulator,clock);
 await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,state.active_revision]);
 // Finish the old definite failure before returning to the rest of the fixture.
 await processCosWork(db,100,simulator,clock);

}
