import test from 'node:test';
import assert from 'node:assert/strict';
import {mappingRepairConflicts,patientBinding} from '../dist/hospital/cos-remap.js';
import {makePackage} from '../dist/admin/canonical-package.js';
import {COS_PROFILE} from '../dist/hospital/cos-configuration.js';
const identifier={field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]};
const mapping=patientIdentifier=>makePackage({kind:'hospital-mapping',name:'Repair test',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'123e4567-e89b-42d3-a456-426614174000',revision:1,authoredAt:'2026-10-19T00:00:00Z',author:'fixture',profile:COS_PROFILE,patientIdentifier,pdfLinkId:'371530004',clinicalMappings:[]}});
const previous={canonical_mapping:mapping(identifier),endpoint:'https://cos.example.invalid',settings:{mode:'simulator',authentication:'api-key',template:'urn:template',organizationHsaId:'org',encounterNamespace:'urn:encounter',staff:[],careUnits:[],defaultAmbulanceCareUnit:'ambulance'}};
const source={amendmentSequence:0,occurrences:[{id:'one',element_id:'ePatient.01',value_kind:'text',value_text:'200207252388'}],amendments:[]};
test('mapping repair distinguishes patient selection, recipient changes and additive mapping repairs',()=>{
 assert.deepEqual(mappingRepairConflicts(source,previous,previous),[]);
 assert.deepEqual(mappingRepairConflicts(source,previous,{...previous,canonical_mapping:mapping({...identifier,field:{kind:'nemsis',elementId:'ePatient.05'}})}),['patientIdentifier']);
 assert.deepEqual(mappingRepairConflicts(source,previous,{...previous,endpoint:'https://recipient.example.invalid'}),['recipient']);
 assert.deepEqual(mappingRepairConflicts(source,{...previous,settings:{...previous.settings,organizationHsaId:''}},previous),[]);
 assert.deepEqual(mappingRepairConflicts(source,previous,{...previous,settings:{...previous.settings,staff:[{userId:'new-signer',hsaId:'new-hsa'}]}}),[]);
});
test('identity preview preserves exact immutable patient value and rejects ambiguous/missing qualifiers',()=>{
 assert.equal(patientBinding(source,previous).value,'200207252388');
 assert.equal(patientBinding({...source,occurrences:[...source.occurrences,{...source.occurrences[0],id:'two'}]},previous).value,null);
 assert.equal(patientBinding({...source,occurrences:[{...source.occurrences[0],not_value_code:'not-recorded'}]},previous).value,null);
 assert.equal(patientBinding({...source,occurrences:[]},previous).value,null);
});
test('recipient conflicts use amended signed destination rather than a stale base destination',()=>{
 const rows=[['unit','eDisposition.27','4227001'],['care','eDisposition.28','4228001'],['transport','eDisposition.30','4230001']].map(([id,element_id,code])=>({id,element_id,value_kind:'coded',code}));
 rows.push({id:'hospital',element_id:'eDisposition.01',value_kind:'text',value_text:'Hospital'},{id:'local',element_id:'eDisposition.02',value_kind:'text',value_text:'Old'});
 const base={...source,occurrences:rows};
 const old={...previous,settings:{...previous.settings,careUnits:[{hospital:'Hospital',localCareUnit:'Old',hsaId:'old-target'},{hospital:'Hospital',localCareUnit:'New',hsaId:'new-target'}]}};
 const repaired={...old,settings:{...old.settings,careUnits:[{hospital:'Hospital',localCareUnit:'Old',hsaId:'changed-unused-target'},{hospital:'Hospital',localCareUnit:'New',hsaId:'new-target'}]}};
 assert.deepEqual(mappingRepairConflicts(base,old,repaired),['recipient']);
 const original=rows.find(row=>row.id==='local');
 const amended={...base,amendmentSequence:1,amendments:[{id:'amendment',sequence:1,changes:[{action:'remove',targetId:'local',original,corrected:null},{action:'add',targetId:null,original:null,corrected:{...original,id:'corrected-local',value_text:'New'}}]}]};
 assert.deepEqual(mappingRepairConflicts(amended,old,repaired),[],'unrelated old route must not require acknowledgement for the amended destination');
 assert.equal(original.value_text,'Old');
});
