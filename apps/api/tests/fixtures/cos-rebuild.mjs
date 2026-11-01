import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {processCosWork} from '../../dist/hospital/cos-worker.js';
import {CosRejected} from '../../dist/hospital/cos-simulator.js';
import {retryCosReview} from '../../dist/hospital/cos-retry.js';
import {rebuildCosReview} from '../../dist/hospital/cos-rebuild.js';
import {reconcileCosReview} from '../../dist/hospital/cos-reconcile.js';
export async function rebuildFixture({db,draft,sign,simulator,recoveryReview:review,recoverySessions:sessions,setAuthorHsa}){
 for(const stored of [true,false]){
  const report=await draft();await sign(report);
  await processCosWork(db,100,{contact:simulator.contact.bind(simulator),note:async(...args)=>{if(args[0]!==report)return simulator.note(...args);if(stored)await simulator.note(...args);throw new Error('Lost fictional receipt');}});
  const [parent]=await db.query('select * from clinical.cos_delivery where report_id=$1',[report]);assert.equal(parent.state,'uncertain');
  const [original]=await db.query('select * from clinical.cos_payload where delivery_id=$1',[parent.id]);
  const [item]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[report]);
  await assert.rejects(review.rebuildCosContext('fixture',item.id,'synthetic'),error=>error.getStatus?.()===403);
  await review.claim('fixture',item.id,{commandId:randomUUID(),expectedVersion:Number(item.version),dataset:'synthetic'});
  const context=await review.rebuildCosContext('fixture',item.id,'synthetic');assert.equal(context.available,true);assert.equal(context.blockedByUncertain,true);
  const {available,blockedByUncertain,reason,...selection}=context;const command={...selection,commandId:randomUUID(),dataset:'synthetic'};
  await assert.rejects(rebuildCosReview(db,{...sessions,assertCsrf:async()=>{throw new Error('Invalid CSRF');}},'fixture',item.id,command),/Invalid CSRF/);
  await assert.rejects(review.rebuildCos('fixture',item.id,{...command,expectedVersion:999}));
  await assert.rejects(review.rebuildCos('fixture',item.id,{...command,dataset:'real'}));
  if(stored){await setAuthorHsa('fictional-changed-author');await assert.rejects(review.rebuildCos('fixture',item.id,command),error=>error.getResponse?.().code==='hospital.cos.rebuildIdentityChanged');await setAuthorHsa('fictional-staff');}
  const contenders=await Promise.allSettled([review.rebuildCos('fixture',item.id,command),review.rebuildCos('fixture',item.id,command)]);
  assert.ok(contenders.some(result=>result.status==='fulfilled'));
  await review.rebuildCos('fixture',item.id,command);
  await assert.rejects(review.rebuildCos('fixture',item.id,{...command,amendmentSequence:999}));
  const rows=await db.query('select * from clinical.cos_delivery where report_id=$1 order by created_at',[report]);assert.equal(rows.length,2);
  const child=rows.find(row=>row.id!==parent.id);assert.equal(child.lineage_parent_id,parent.id);assert.equal(child.state,'pending');
  const [prepared]=await db.query('select * from clinical.cos_payload where delivery_id=$1',[child.id]);assert.ok(prepared);assert.notEqual(prepared.delivery_id,original.delivery_id);
  assert.deepEqual((await db.query('select * from clinical.cos_payload where delivery_id=$1',[parent.id]))[0],original);
  assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[parent.id]))[0].state,'uncertain');
  assert.equal((await review.rebuildCosContext('fixture',item.id,'synthetic')).available,false);
  let sends=0;const tracking={contact:async(...args)=>{sends++;return simulator.contact(...args);},note:async(...args)=>{sends++;return simulator.note(...args);}};
  await processCosWork(db,100,tracking);assert.equal(sends,0,'prepared child cannot bypass uncertain ancestor');
  assert.equal((await db.query('select 1 from clinical.cos_attempt where delivery_id=$1',[child.id])).length,0);
  const detail=await review.item('fixture',item.id,'synthetic');const target=detail.transmission.reconciliationTarget;
  assert.equal(target.deliveryId,parent.id,'uncertain original remains a reconciliation target');
  await assert.rejects(retryCosReview(db,sessions,'fixture',item.id,{commandId:randomUUID(),dataset:'synthetic',expectedVersion:detail.version,stateRevision:detail.transmission.stateRevision,...target}));
  await reconcileCosReview(db,sessions,'fixture',item.id,{commandId:randomUUID(),dataset:'synthetic',expectedVersion:detail.version,stateRevision:detail.transmission.stateRevision,...target});
  assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[parent.id]))[0].state,stored?'confirmed':'superseded');
  await processCosWork(db,100,tracking);
  assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[child.id]))[0].state,'confirmed');
  assert.deepEqual((await db.query('select * from clinical.cos_payload where delivery_id=$1',[child.id]))[0],prepared,'worker sends the exact prepared representation');
  assert.equal((await db.query('select 1 from clinical.cos_attempt where delivery_id=$1',[child.id])).length,1);
  assert.equal((await db.query('select * from clinical.cos_simulator_current where report_id=$1',[report]))[0].delivery_id,child.id);
  const after=sends;await processCosWork(db,100,tracking);assert.equal(sends,after);
 }
 const report=await draft();await sign(report);await processCosWork(db,100,{contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)});
 const [item]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[report]);
 await review.claim('fixture',item.id,{commandId:randomUUID(),expectedVersion:Number(item.version),dataset:'synthetic'});
 const context=await review.rebuildCosContext('fixture',item.id,'synthetic');assert.equal(context.blockedByUncertain,false);
 const {available,blockedByUncertain,reason,...selection}=context;
 await review.rebuildCos('fixture',item.id,{...selection,commandId:randomUUID(),dataset:'synthetic'});
 assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[context.deliveryId]))[0].state,'superseded');
 await processCosWork(db,100,simulator);
 const [child]=await db.query('select * from clinical.cos_delivery where lineage_parent_id=$1',[context.deliveryId]);assert.equal(child.state,'confirmed');

}
