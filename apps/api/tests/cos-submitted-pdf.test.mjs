import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ReviewService} from '../dist/review/review.service.js';
const reportId='11111111-1111-4111-8111-111111111111',deliveryId='22222222-2222-4222-8222-222222222222';
function fixture({capabilities=['review:self'],author='viewer',visible=true,corrupt=false,available=true}={}){
 const bytes=Buffer.from('%PDF-1.4 exact original bytes'),queries=[],audit=[];
 const manager={query:async(sql,args)=>{
  queries.push(sql);
  if(sql.includes('from clinical.report r join clinical.signed_snapshot')){
   assert.deepEqual(args,[reportId,'agency',false,capabilities.includes('review:all'),'viewer']);
   return visible?[{documenting_user_id:author}]:[];
  }
  if(sql.includes('from clinical.cos_payload')){
   assert.deepEqual(args,[deliveryId,reportId,'agency']);assert.match(sql,/artifact_key='note'/);assert.match(sql,/e.state in/);
   return available?[{pdf:bytes,pdf_sha256:corrupt?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex')}]:[];
  }
  if(sql.includes('with recorded_access')){audit.push(args);return [{recorded:1}];}
  throw Error('Unexpected query: '+sql);
 }};
 const service=new ReviewService({transaction:async(level,run)=>{assert.equal(level,'REPEATABLE READ');return run(manager);}},{get:async()=>({user:{id:'viewer'},organization:{id:'agency'},capabilities})});
 return {bytes,queries,audit,call:()=>service.submittedCosPdf('token',reportId,deliveryId,'real')};
}
test('submitted COS PDF returns immutable bytes with patient-access audit, without regeneration',async()=>{
 const f=fixture();assert.deepEqual(await f.call(),f.bytes);assert.equal(f.audit.length,1);
 assert.equal(f.audit[0][4],'review.report');assert.equal(f.audit[0][6],null);
 assert.equal(f.queries.some(sql=>/clinical\.amendment|from catalog\.|from forms\./.test(sql)),false);
});
for(const [name,options,status] of [
 ['administration does not grant patient access',{capabilities:['settings:read']},403],
 ['other author requires identifying permission',{capabilities:['review:all'],author:'other'},403],
 ['cross-agency or hidden report',{visible:false},404],
 ['missing prepared artifact',{available:false},404],
 ['changed stored bytes',{corrupt:true},422],
])test(`submitted COS PDF rejects ${name}`,async()=>{
 const f=fixture(options);await assert.rejects(f.call(),error=>error.getStatus()===status);assert.equal(f.audit.length,0);
 if(status===403||options.visible===false)assert.equal(f.queries.some(sql=>sql.includes('from clinical.cos_payload')),false);
});
