import assert from 'node:assert/strict';
import test from 'node:test';
import {AssignedCallsService} from '../dist/calls/assigned-calls.service.js';
import {DraftReportService} from '../dist/reports/draft-report.service.js';
import {clinicalFormConfiguration} from '../dist/forms/clinical-form-configuration.js';

test('initial assignment open and draft reopen load current scoped destinations outside the pinned form cache',async()=>{
 const report={id:'report',documenting_user_id:'author',form_version_id:'form',catalog_release_id:'catalog',revision:0,status:'draft'};
 const destinations=new Map([['agency-a',[{id:'destination-a',groupId:'group-a',revision:1,displayName:'Hospital A',localCode:'001',hsaId:'HSA-A',active:true}]],['agency-b',[]]]);
 const reads=[];
 let cosActive=true;
 const manager={connection:{},query:async(sql,params)=>{
  reads.push({sql,params});
  if(sql.includes('from app_identity.hospital_cos_state'))return cosActive===null?[]:[{active:cosActive}];
  if(sql.includes('from app_identity.destination_directory')){
   assert.match(sql,/group_id=app_identity\.organization_group\(\$1\)/);
   assert.match(sql,/and active/);
   return structuredClone(destinations.get(params[0]));
  }
  if(sql.includes('from forms.form_version'))return [{canonical_definition:{schemaVersion:1,sections:[{key:'destination',fields:[{key:'destination',source:{kind:'nemsis',elementId:'eDisposition.01'}}]}]}}];
  if(sql.includes('from catalog.element_definition e'))return [{element_id:'eDisposition.01',name:'Destination',usage:'Optional',min_occurs:0,max_occurs:1}];
  if(sql.includes('from catalog.value_set_element')||sql.includes('from catalog.group_definition')||sql.includes('customGroupDefinitions'))return [];
  if(sql.includes('from clinical.report where'))return [report];
  if(sql.includes('join forms.form_version'))return [{...report,created_at:'2026-10-29T10:00:00Z',updated_at:'2026-10-29T10:00:00Z',form_id:'form',form_version:1,catalog_version:'3.5.1'}];
  if(sql.includes('left join clinical.call_assignment'))return [{call_number:'CALL',unit_call_sign:'UNIT',agency_time_zone:'UTC'}];
  if(sql.includes('with recorded_access'))return [{recorded:1}];
  if(['clinical.group_instance','clinical.element_occurrence','clinical.dispatch_conflict','clinical.report_note','clinical.report_photo_note','clinical.report_audio_note'].some(table=>sql.includes(`from ${table}`)))return [];
  throw new Error(`Unexpected query: ${sql}`);
 }};
 let organizationId='agency-a';
 const sessions={requireCapability:async()=>({organization:{id:organizationId},user:{id:'author'}})};
 const database={transaction:async(_isolation,work)=>work(manager)};
 const calls=new AssignedCallsService(database,sessions);
 const drafts=new DraftReportService(database,sessions);
 // reportResult authorization is separately covered; exercise the complete reopen response assembly.
 drafts.reportResult=async()=>({id:'report',documentingUserId:'author',formVersionId:'form',catalogReleaseId:'catalog',revision:0});
 const opened=await calls.openResult(manager,{id:'assignment',organization_id:organizationId},'report','author',null);
 const recommendations=form=>form.catalogFields['eDisposition.01'].recommendations;
 assert.deepEqual(recommendations(opened.report.clinicalForm),{source:'destination-directory',items:destinations.get('agency-a')});
 destinations.get('agency-a')[0].revision=2;
 destinations.get('agency-a')[0].displayName='Renamed hospital';
 const reopened=await drafts.reopen('token','report');
 assert.equal(recommendations(reopened.report.clinicalForm).items[0].revision,2);
 assert.equal(recommendations(opened.report.clinicalForm).items[0].revision,1,'earlier response remains isolated');
 organizationId='agency-b';
 assert.deepEqual(recommendations((await drafts.reopen('token','report')).report.clinicalForm).items,[]);
 cosActive=false;
 assert.equal(recommendations((await drafts.reopen('token','report')).report.clinicalForm),undefined,'deactivated COS restores scalar fields');
 cosActive=null;
 assert.equal(recommendations((await drafts.reopen('token','report')).report.clinicalForm),undefined,'unconfigured COS keeps scalar fields');
 cosActive=true;
 assert.deepEqual(recommendations((await drafts.reopen('token','report')).report.clinicalForm).items,[],'active COS with empty directory still uses picker');
 assert.equal(recommendations(await clinicalFormConfiguration(manager,'form','catalog')),undefined,'live directory never enters immutable cache');
 assert.equal(reads.filter(row=>row.sql.includes('from forms.form_version')).length,1,'both service paths reuse pinned definitions');
 assert.deepEqual(reads.filter(row=>row.sql.includes('from app_identity.destination_directory')).map(row=>row.params[0]),['agency-a','agency-a','agency-b','agency-b']);
});
