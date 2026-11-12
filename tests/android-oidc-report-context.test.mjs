import assert from 'node:assert/strict';
import test from 'node:test';
import {oidcReportContext,oidcInstrumentationContext} from '../scripts/android/oidc-report-context.mjs';
import {prepareOidcCall} from '../scripts/android/oidc-call-fixture.mjs';
const target = {callNumber: 'ANDROID-OFFLINE-1', userId: 'alpha'};
test('OIDC acceptance opens a fresh assignment and reopens the exact previously synchronized report', () => {
  assert.deepEqual(oidcReportContext([{call_number: target.callNumber, report_id: null}], target), {openAction: 'Open call', callNumber: target.callNumber, baselineRevision: null});
  assert.deepEqual(oidcReportContext([{call_number: target.callNumber, report_id: 'report-1', status:'draft', documenting_user_id: 'alpha', revision: 37}], target), {openAction: 'Reopen report', callNumber: target.callNumber, reportId: 'report-1', baselineRevision: 37});
});
test('OIDC acceptance cannot accidentally use a missing, ambiguous, wrong-call or wrong-owner report', () => {
  for (const rows of [[], [{}, {}], [{call_number: 'OTHER', report_id: null}], [{call_number: target.callNumber, report_id: 'report-1',status:'draft', documenting_user_id: 'beta', revision: 37}], [{call_number: target.callNumber, report_id: 'report-1',status:'draft', documenting_user_id: 'alpha', revision: -1}], [{call_number: target.callNumber, report_id: 'report-1',status:'signed', documenting_user_id: 'alpha', revision: 37}]]) assert.throws(() => oidcReportContext(rows, target));
});

function scenario(prior,alter=rows=>rows){
 const fixture={index:1,databaseUrl:'postgresql://localhost/android_1',organizationId:'agency',unitId:'unit',clinician:{userId:'alpha'}};
 let assignment;const writes=[];
 const db={transaction:work=>work(db),query:async(sql,parameters)=>{
  if(sql.startsWith('select name'))return[{name:'Android synthetic 1'}];
  if(sql.startsWith('select report.id'))return structuredClone(prior);
  if(sql.startsWith('select id from clinical.call_assignment'))return[];
  if(sql.startsWith('insert into clinical.incident')){writes.push(sql);return[];}
  if(sql.startsWith('insert into clinical.call_assignment')){writes.push(sql);assignment={assignment_id:parameters[0],call_number:parameters[4],report_id:null};return[];}
  if(sql.startsWith('select assignment.id'))return alter([structuredClone(assignment)]);
  throw Error('Unexpected fixture SQL');
 }};return{db,fixture,writes};
}
for(const signed of [true,false])test(`OIDC seeds its own unused assignment and preserves prior signed snapshots (signed prior=${signed})`,async()=>{
 const prior=signed?[{id:'old-report',status:'signed',revision:'9',snapshot_id:'old-snapshot',signed_revision:'9',canonical_sha256:'a'.repeat(64)}]:[];
 const before=JSON.stringify(prior),fixture=scenario(prior),context=await prepareOidcCall(fixture);
 assert.equal(context.callNumber,'ANDROID-OIDC-1');assert.equal(context.openAction,'Open call');assert.equal(context.reportId,undefined);assert.equal(context.baselineRevision,null);assert.equal(context.priorSignedSnapshots,signed?1:0);
 assert.equal(fixture.writes.length,2);assert(fixture.writes.every(sql=>sql.startsWith('insert into clinical.')));assert.equal(JSON.stringify(prior),before);await context.assertSignedUnchanged();
 if(signed){prior[0].canonical_sha256='b'.repeat(64);await assert.rejects(context.assertSignedUnchanged(),/Earlier signed reports/);}
});
test('independent OIDC context refuses missing, wrong assignment, wrong call or already opened contexts',async()=>{
 for(const alter of [()=>[],rows=>[{...rows[0],assignment_id:'other'}],rows=>[{...rows[0],call_number:'ANDROID-OFFLINE-1'}],rows=>[{...rows[0],report_id:'old',status:'signed',documenting_user_id:'alpha',revision:9}],rows=>[{...rows[0],report_id:'other-draft',status:'draft',documenting_user_id:'alpha',revision:9}]])await assert.rejects(prepareOidcCall(scenario([],alter)));
});
test('every OIDC phase carries the exact owned call and the API-acknowledged report once established',()=>{
 const context={callNumber:'ANDROID-OIDC-1',reportId:'own-report',baselineRevision:7};
 for(const phase of ['recovery','pending','login','prepare','resume'])assert.deepEqual(oidcInstrumentationContext(context,{phase}),{callNumber:'ANDROID-OIDC-1',reportId:'own-report',phase});
 assert.throws(()=>oidcInstrumentationContext(context,{callNumber:'ANDROID-OFFLINE-1'}));assert.throws(()=>oidcInstrumentationContext(context,{reportId:'old-signed-report'}));
});
