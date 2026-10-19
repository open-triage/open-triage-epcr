import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {ReviewService} from '../dist/review/review.service.js';
import {queueEpsExportReview,resolveEpsExportReview} from '../dist/hospital/eps-export-review.js';
import {savepointDataSource} from './fixtures/savepoint-data-source.mjs';

test('EPS export intent persists, is idempotent, and only confirmed acceptance clears Review',{skip:!process.env.DATABASE_URL},async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{
  await client.query('begin');
  // Allows an additive migration to be verified against a developer DB without applying it.
  const column=await client.query("select 1 from information_schema.columns where table_schema='clinical' and table_name='review_item' and column_name='eps_snapshot_id'");
  if(!column.rows.length)await client.query(await readFile(new URL('../../../supabase/migrations/20261019193903_eps_export_review_queue.sql',import.meta.url),'utf8'));
  const database=savepointDataSource(client);
  const {manager,transaction,query}=database;
  const [report]=await query("select r.id,r.organization_id,r.documenting_user_id,s.id snapshot from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id where r.synthetic and r.status='signed' order by s.signed_at desc limit 1");
  assert.ok(report,'A fictional signed report is required');
  await query('set local role open_triage_api_runtime');
  await queueEpsExportReview(manager,report.id,report.snapshot);
  const [item]=await query("select * from clinical.review_item where report_id=$1 and kind='eps-export'",[report.id]);
  const reviews=new ReviewService(database,{get:async()=>({organization:{id:report.organization_id},user:{id:report.documenting_user_id},capabilities:['review:self','clinical:demo']})});
  assert.ok((await reviews.queue('fixture',{dataset:'synthetic',criterion:item.criterion_id})).items.some(row=>row.id===item.id&&row.kind==='eps-export'));
  assert.equal((await reviews.item('fixture',item.id,'synthetic')).kind,'eps-export');
  assert.equal(item.active_match,true);assert.equal(item.eps_snapshot_id,report.snapshot);
  await queueEpsExportReview(manager,report.id,report.snapshot);
  assert.equal((await query("select count(*)::int n from clinical.review_item where report_id=$1 and kind='eps-export'",[report.id]))[0].n,1);
  // A generic completion cannot conceal a failed or never-started export.
  await assert.rejects(transaction(m=>m.query("update clinical.review_item set status='completed' where id=$1",[item.id])),/Unresolved transmission/);
  await resolveEpsExportReview(manager,report.id,'00000000-0000-4000-8000-000000000000');
  assert.equal((await query('select active_match from clinical.review_item where id=$1',[item.id]))[0].active_match,true);
  await resolveEpsExportReview(manager,report.id,report.snapshot);
  await resolveEpsExportReview(manager,report.id,report.snapshot);
  const [resolved]=await query('select active_match,status,closure_reason from clinical.review_item where id=$1',[item.id]);
  assert.equal((await reviews.queue('fixture',{dataset:'synthetic',criterion:item.criterion_id,status:'incomplete'})).items.length,0);
  assert.deepEqual(resolved,{active_match:false,status:'completed',closure_reason:'eps-export-accepted'});
  assert.equal((await query("select count(*)::int n from clinical.review_progress_history where item_id=$1 and reason='eps-export-accepted'",[item.id]))[0].n,1);
  await queueEpsExportReview(manager,report.id,report.snapshot,1);
  await resolveEpsExportReview(manager,report.id,report.snapshot,0);
  assert.equal((await query('select active_match from clinical.review_item where id=$1',[item.id]))[0].active_match,true);
  await resolveEpsExportReview(manager,report.id,report.snapshot,1);
  assert.equal((await query('select active_match from clinical.review_item where id=$1',[item.id]))[0].active_match,false);
 }finally{await client.query('rollback');await client.end();}
});
