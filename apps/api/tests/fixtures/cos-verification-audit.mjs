import assert from 'node:assert/strict';
import {auditSources} from '../../dist/admin/audit.service.js';

export async function cosVerificationAudit(manager,deliveryId){
 await manager.query('savepoint cos_verification_audit_fixture');
 try{
 const [sample]=await manager.query('select report_id,organization_id from clinical.cos_delivery where id=$1',[deliveryId]);
 sample.artifact_key='audit-verification-fixture';
 await manager.query("insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,content_sha256,resource) values($1,$2,$3,'note',$4,'{}')",[deliveryId,sample.report_id,sample.artifact_key,'a'.repeat(64)]);
  await manager.query('set local role open_triage_api_runtime');
  await manager.query("select set_config('open_triage.audit_organization_id',$1,true)",[sample.organization_id]);
  for(const [state,verificationOutcome] of [['verified','verified'],['unresolved','unresolved'],['accepted','skipped']]){
   const evidence={verificationOutcome,reason:'readBackDisabled',httpStatus:201,request:{secret:'DO NOT RETAIN'},patientIdentifier:'DO NOT RETAIN',responseEvidence:{correlation:{'x-request-id':'test-request'}}};
   await manager.query(`insert into clinical.cos_artifact_event(delivery_id,report_id,artifact_key,state,evidence) values($1,$2,$3,$4,$5::jsonb)`,[deliveryId,sample.report_id,sample.artifact_key,state,JSON.stringify(evidence)]);
   const [entry]=await manager.query(`select * from clinical_audit.hospital_operational_event where source_id=$1 and action='cos.verification' order by occurred_at desc limit 1`,[deliveryId]);
   assert.equal(entry.state,state);assert.equal(entry.verification_details.verificationOutcome,verificationOutcome);
   assert.equal(entry.verification_details.verificationHttpStatus,201);
   assert.equal(entry.verification_details.verificationRequestId,'test-request');
   assert.equal(JSON.stringify(entry).includes('DO NOT RETAIN'),false);
  }
  const rows=await manager.query(`select * from (${auditSources.integrations[0]}) events where integration->>'verificationRequestId'='test-request'`,[sample.organization_id]);
  assert.equal(rows.length,3);
  await manager.query("select set_config('open_triage.audit_organization_id','00000000-0000-4000-8000-000000000000',true)");
  assert.equal((await manager.query(`select id from clinical_audit.hospital_operational_event where source_id=$1`,[deliveryId])).length,0);
 }finally{
  await manager.query('rollback to savepoint cos_verification_audit_fixture');
  await manager.query('release savepoint cos_verification_audit_fixture');
 }
}
