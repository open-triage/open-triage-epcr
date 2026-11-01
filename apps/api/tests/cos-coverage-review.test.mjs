import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCosFailure} from '../dist/hospital/cos-recovery-review.js';

test('confirmed delivery retains review for incomplete coverage but resolves a complete export',async()=>{
 for(const finding of ['clinicalProjectionIncomplete',null]){
  const mutations=[];
  const db={query:async(sql,params)=>{
   if(sql.includes('select d.*,exists'))return [{id:'delivery',state:'confirmed',finding,failed:true,uncertain:false,rebuilt:false,compatible:true,state_revision:'1',configuration_revision:'1',amendment_sequence:0}];
   if(sql.startsWith('select organization_id'))return [{organization_id:'org',documenting_user_id:'author'}];
   if(sql.startsWith('select id from app_identity.organization'))return [];
   if(sql.startsWith('select clinical.review_cos_criterion_id'))return [{id:'criterion'}];
   if(sql.startsWith('select id,version,active_match,status'))return [{id:'item',version:'1',active_match:true,status:'new'}];
   if(sql.startsWith('select evidence,active'))return [];
   if(sql.startsWith('update clinical.review_item')){mutations.push(params);return [];}
   if(sql.startsWith('insert into clinical.review_transmission_history')){const evidence=JSON.parse(params[5]);assert.equal(evidence.deliveryState,'confirmed');assert.equal(evidence.retryable,false);assert.equal(evidence.finding,finding);return [];}
   throw new Error('Unexpected query');
  }};
  await reconcileCosFailure(db,'report');
  assert.equal(mutations[0][2],finding!==null);
 }
});
