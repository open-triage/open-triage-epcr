import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {EpsSubmissionService} from '../dist/hospital/eps-submission.service.js';
const require=createRequire(import.meta.url);
for(const scenario of ['pending','passed','failed','unavailable','mapping-error','unknown-outcome'])test(`submission with receiver validation: ${scenario}`,async(t)=>{
 t.mock.method(require('../dist/authentication/agency-oidc-keys.js'),'decryptAgencyCredential',async()=> 'fictional-test-secret');
 const row={id:randomUUID(),snapshot_id:randomUUID(),amendment_sequence:0,group_id:randomUUID(),configuration_revision:8,bundle:{resourceType:'Bundle'},validation:{profile:{state:['mapping-error','unknown-outcome'].includes(scenario)?'pending':scenario},findings:scenario==='mapping-error'?[{code:'outputMapping',severity:'error'}]:[]}};
 let published=0,intents=0;
 const manager={query:async(sql)=>{
  if(sql.startsWith('select pg_advisory'))return [];
  if(sql.startsWith('select * from clinical.eps_submission'))return [row];
  if(sql.startsWith('select submission_id'))return [];
  if(sql.startsWith('select result.state'))return scenario==='unknown-outcome'?[{state:'unknown'}]:[];
  if(sql.startsWith('select v.encrypted_credential'))return [{encrypted_credential:{},credential_id:randomUUID()}];
  if(sql.startsWith('insert into clinical.eps_submission_attempt')){intents++;return [];}
  if(sql.startsWith('insert into clinical.eps_submission_result'))return [];
  throw Error(sql);
 }};
 const database={transaction:async(...args)=>args.at(-1)(manager)};
 const service=new EpsSubmissionService(database,{assertCsrf:async()=>{}});
 service.authorize=async()=>({scope:{userId:randomUUID()}});service.audit=async()=>{};service.view=async()=>({state:'rejected'});
 service.publish=async()=>{published++;return {state:'rejected',issues:[{severity:'error',code:'structure',expression:[]}],headers:{'x-pass':'false'}};};
 const submit=()=>service.submit('token',randomUUID(),{submissionId:row.id,commandId:randomUUID(),dataset:'synthetic',confirmPublicFictional:true},'csrf');
 if(['pending','passed'].includes(scenario)){assert.equal((await submit()).state,'rejected');assert.equal(intents,1);assert.equal(published,1);}
 else {await assert.rejects(submit);assert.equal(intents,0);assert.equal(published,0);}
});
