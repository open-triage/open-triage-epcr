import test from 'node:test';
import assert from 'node:assert/strict';
import {EpsSubmissionService} from '../dist/hospital/eps-submission.service.js';
function fixture({active=true,allowed=true}={}){
 const session={organization:{id:'parent'},user:{id:'user'},capabilities:['review:all','review:identifying'],agencies:[{id:'parent'},{id:'child',parentOrganizationId:'parent'}]};
 const queries=[];
 const manager={query:async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes('organization_id=any'))return [{organization_id:'child'}];
  if(sql.startsWith('select id,documenting_user_id'))return allowed?[{id:'report',documenting_user_id:'other'}]:[];
  if(sql.includes('select exists')){assert.deepEqual(args,['child']);return [{active}];}
  throw new Error('Unexpected query');
 }};
 return {queries,service:new EpsSubmissionService({transaction:async(_,run)=>run(manager)},{get:async()=>session})};
}
test('submission activation uses the authorized report agency, including inactive integrations',async()=>{
 for(const active of [true,false]){
  const {service}=fixture({active});
  assert.deepEqual(await service.availability('token','report','synthetic'),{active});
 }
});
test('submission activation does not disclose configuration without report access',async()=>{
 const {service,queries}=fixture({allowed:false});
 await assert.rejects(service.availability('token','report','synthetic'));
 assert.equal(queries.some(q=>q.sql.includes('select exists')),false);
});
