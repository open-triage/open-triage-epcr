import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
/** Exercises the same snapshot cascade used by synthetic expiry, with durable
 * report lineage on all append-only receipts, while a second report remains live. */
export async function hospitalRetentionFixture(db,reportId){
 const [delivery]=await db.query('select * from clinical.cos_delivery where report_id=$1',[reportId]);
 assert.ok(delivery);
 const [version]=await db.query(`insert into app_identity.hospital_eps_version(group_id,revision,credential_id,endpoint,canonical_mapping,catalog_release_id,form_version_id,created_by)
 select $2,coalesce((select max(revision) from app_identity.hospital_eps_version where group_id=$2),0)+1,$3,'https://example.invalid','{}',catalog_release_id,form_version_id,documenting_user_id from clinical.report where id=$1 returning revision`,[reportId,delivery.group_id,randomUUID()]);
 const submission=randomUUID(),attempt=randomUUID();
 await db.query(`insert into clinical.eps_submission(id,report_id,snapshot_id,amendment_sequence,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,destination,bundle,validation,payload_sha256,source_sha256,amendment_hashes,prepared_by)
 values($1,$2,$3,0,$4,$5,$6,'retention',1,$7,'https://example.invalid','{}','{}',$7,$7,'[]',$8)`,[submission,reportId,delivery.snapshot_id,delivery.organization_id,delivery.group_id,version.revision,'a'.repeat(64),delivery.queued_by]);
 await db.transaction(async manager=>{
  await manager.query('set local role open_triage_api_runtime');
  await manager.query('insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id) values($1,$2,$3,$4)',[attempt,submission,randomUUID(),delivery.queued_by]);
  await manager.query("insert into clinical.eps_submission_result(attempt_id,state,evidence) values($1,'accepted','{}')",[attempt]);
 });
 for(const table of ['eps_submission_attempt','eps_submission_result'])assert.equal((await db.query(`select report_id from clinical.${table} where report_id=$1`,[reportId]))[0].report_id,reportId);
 await assert.rejects(db.query('insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id,report_id) values($1,$2,$3,$4,$5)',[randomUUID(),submission,randomUUID(),delivery.queued_by,randomUUID()]),/report must match/);
 await assert.rejects(db.query("insert into clinical.eps_submission_result(attempt_id,state,evidence,report_id) values($1,'accepted','{}',$2)",[attempt,randomUUID()]),/report must match/);
 await db.query("insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,content_sha256,resource) values($1,$2,'retention','context',$3,'{}')",[delivery.id,reportId,'b'.repeat(64)]);
 await db.query("insert into clinical.cos_artifact_event(delivery_id,report_id,artifact_key,state) values($1,$2,'retention','verified')",[delivery.id,reportId]);
 const tables=['eps_submission','eps_submission_attempt','eps_submission_result','cos_artifact','cos_artifact_event'];
 for(const table of tables){
  await assert.rejects(db.query(`delete from clinical.${table} where report_id=$1`,[reportId]),/append-only/);
  await assert.rejects(db.query(`update clinical.${table} set report_id=report_id where report_id=$1`,[reportId]),/append-only/);
 }
 // A spoofed purge setting without this report's durable tombstone is insufficient.
 await assert.rejects(db.transaction(async manager=>{
  await manager.query("select set_config('open_triage.synthetic_purge_report',$1,true)",[reportId]);
  await manager.query('delete from clinical.eps_submission_attempt where id=$1',[attempt]);
 }),/append-only/);
 await assert.rejects(db.transaction(async manager=>{
  const unrelated=randomUUID();
  await manager.query(`insert into clinical_audit.synthetic_purge_tombstone(record_type,record_id,organization_id,server_created_at,expired_at,purged_at) values('report',$1,$2,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',clock_timestamp())`,[unrelated,delivery.organization_id]);
  await manager.query("select set_config('open_triage.synthetic_purge_report',$1,true)",[unrelated]);
  await manager.query('delete from clinical.eps_submission_result where attempt_id=$1',[attempt]);
 }),/append-only/);
 await db.query('select retention.purge_expired_synthetic_records(clock_timestamp())');
 for(const table of tables)assert.ok((await db.query(`select 1 from clinical.${table} where report_id=$1`,[reportId])).length,`${table} remains before expiry`);
 return async()=>{
  for(const table of tables)assert.equal((await db.query(`select 1 from clinical.${table} where report_id=$1`,[reportId])).length,0,`${table} follows authorized report expiry`);
  await assert.rejects(db.query('insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id) values($1,$2,$3,$4)',[randomUUID(),submission,randomUUID(),delivery.queued_by]),/report must match/);
  await assert.rejects(db.query("insert into clinical.eps_submission_result(attempt_id,state,evidence) values($1,'accepted','{}')",[attempt]),/report must match/);
 };
}
