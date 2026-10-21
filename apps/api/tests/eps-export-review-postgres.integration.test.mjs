import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hospitalFixtureBaseline} from './fixtures/hospital-baseline.mjs';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {DraftReportService} from '../dist/reports/draft-report.service.js';
import {SignReportService} from '../dist/reports/sign-report.service.js';
import {FormPublicationService} from '../dist/forms/form-publication.service.js';
import {ValidationAuthoringService} from '../dist/admin/validation-authoring.service.js';
import {canonicalDefinitionSha256} from '../dist/forms/form-publication.validation.js';
import pg from 'pg';
import {ReviewService} from '../dist/review/review.service.js';
import {queueEpsExportReview,resolveEpsExportReview} from '../dist/hospital/eps-export-review.js';
import {savepointDataSource} from './fixtures/savepoint-data-source.mjs';

if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
process.env.PATIENT_KEY_INSTALLATION_ID??='91000000-0000-4000-8000-000000000001';
process.env.PATIENT_KEY_VERSION??='1';
process.env.PATIENT_KEY_SECRET_BASE64??=Buffer.alloc(32,0x31).toString('base64');

test('EPS export intent persists, is idempotent, and only confirmed acceptance clears Review',{skip:!process.env.DATABASE_URL},async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{
  await client.query('begin');
  const database=savepointDataSource(client);
  const {manager,transaction,query}=database;
  // Own the report fixture: other suites roll back their signed reports.
  const baseline=await hospitalFixtureBaseline(query),sessions=new ClinicianSessionService(database);
  const username=`eps-review-${randomUUID()}`,password='Fictional EPS review password 42!';
  const admin=await new AccountService(database).provision({organizationId:baseline.organization_id,username,displayName:'EPS review fixture',role:'administrator',temporaryPassword:password});
  await query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[admin.userId]);
  const adminToken=(await sessions.create({username,password})).sessionToken;
  const definition={schemaVersion:1,sections:[{key:'narrative',fields:[{key:'narrative',source:{kind:'nemsis',elementId:'eNarrative.01'}}]}]};
  const formId=randomUUID(),versionId=randomUUID(),digest=canonicalDefinitionSha256(definition);
  await query("insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'EPS review fixture')",[formId,baseline.organization_id,`eps-review-${formId}`]);
  await query('insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by) values($1,$2,$3,1,$4::jsonb,$5,$6)',[versionId,formId,baseline.catalog_release_id,JSON.stringify(definition),digest,admin.userId]);
  await new FormPublicationService(database).publish(versionId,{publishedBy:admin.userId,definitionSha256:digest,changeNote:'EPS review fixture'},baseline.organization_id);
  const validations=new ValidationAuthoringService(database,sessions);
  const policy=await validations.create(adminToken,{catalogReleaseId:baseline.catalog_release_id,displayName:'EPS review fixture'}, {importedRules:[{id:randomUUID(),name:'Fixture',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'eNarrative.01',message:'Fixture',source:'require present("eNarrative.01")'}]});
  const published=await validations.publish(adminToken,policy.id,{expectedRevision:policy.revision,displayName:policy.displayName,changeNote:'EPS review fixture'});
  await validations.activate(adminToken,published.id,{formVersionId:versionId,catalogReleaseId:baseline.catalog_release_id,changeNote:'EPS review fixture'});
  const {session:actor,sessionToken:token}=await sessions.create({username:'demo',password:'opentriagedemo'});
  const draft=await new DraftReportService(database,sessions).create(token,{commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID(),organizationId:actor.organization.id,documentingUserId:actor.user.id,patientIdentityState:'unknown'});
  const signed=await new SignReportService(database,sessions).sign(token,draft.id,{commandId:randomUUID(),expectedRevision:draft.revision,signerId:actor.user.id,attestation:{accepted:true}});
  const report={id:draft.id,organization_id:actor.organization.id,documenting_user_id:actor.user.id,snapshot:signed.signedSnapshotId};
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
