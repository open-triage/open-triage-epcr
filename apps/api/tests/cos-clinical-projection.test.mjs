import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCosVitals} from '../dist/hospital/cos-vitals.js';
import {buildCosMedications} from '../dist/hospital/cos-medications.js';
import {COS_ELEMENT_MAPPINGS} from '@open-triage/contracts';
const field=elementId=>({kind:'nemsis',elementId});
const context={deliveryId:'delivery',patient:{system:'patient',value:'fictional'},encounter:{system:'encounter',value:'test'},staff:'staff',careUnit:'ambulance'};
const group=(id,parent=null,type='eVitals.VitalGroup',time='2026-10-27T10:00:00+01:00')=>({id,group_id:type,parent_group_instance_id:parent,ordinal:0,documented_time:time});
const numeric=(id,element,group,value)=>({id,element_id:element,group_instance_id:group,value_kind:'numeric',value_numeric:value});
const coded=(id,element,group,code)=>({id,element_id:element,group_instance_id:group,value_kind:'coded',code,code_system:''});
const source=(groups,occurrences)=>({reportId:'report',signedAt:'2026-10-27T11:00:00Z',amendments:[],groups,occurrences,configuration:{catalogFields:{}}});
const mapping=vital=>{const spec=COS_ELEMENT_MAPPINGS.vitals[vital];return {id:vital,vital,source:field(spec.source),unit:spec.unit,linkId:spec.snomed,...(spec.companionSource?{companionSource:field(spec.companionSource)}:{})};};
const run=(s,types)=>buildCosVitals(s,types.map(mapping),context,100);
test('canonical mappings pair BP only within assessment ancestry and keep independent artifacts',()=>{
 const s=source([group('a'),group('b'),group('bp','a','eVitals.BloodPressureGroup',null)],[numeric('sys','eVitals.06','bp',120),numeric('dia','eVitals.07','b',80),numeric('spo','eVitals.12','a',0)]);
 const result=run(s,['bloodPressure','oxygenSaturation']);assert.equal(result.entries.length,1);assert.equal(result.entries[0].resource.valueQuantity.value,0);assert.equal(result.findings[0].code,'clinicalCompanionMissing');
 s.occurrences[1].group_instance_id='bp';const bp=run(s,['bloodPressure']).entries[0].resource;assert.deepEqual(bp.component.map(c=>c.valueQuantity.value),[120,80]);assert.equal(bp.effectiveDateTime,'2026-10-27T10:00:00+01:00');
});
test('repeated BP subgroups never cross pair and conflicting explicit time is a finding',()=>{
 const s=source([group('a'),group('bp1','a','eVitals.BloodPressureGroup',null),group('bp2','a','eVitals.BloodPressureGroup',null)],[numeric('s1','eVitals.06','bp1',120),numeric('d1','eVitals.07','bp1',80),numeric('s2','eVitals.06','bp2',140),numeric('d2','eVitals.07','bp2',90)]);
 assert.deepEqual(run(s,['bloodPressure']).entries.map(e=>e.resource.component.map(c=>c.valueQuantity.value)),[[120,80],[140,90]]);
 s.groups.push(group('nested','bp1','custom',null));s.occurrences[0].group_instance_id='nested';assert.equal(run(s,['bloodPressure']).entries.length,2);
 s.occurrences.push({id:'time',element_id:'eVitals.01',group_instance_id:'a',value_kind:'datetime',value_datetime:'2026-10-27T10:01:00+01:00'});assert.equal(run(s,['bloodPressure']).entries.length,0);
});
test('AVPU uses exact canonical codes, pain exports the score regardless of scale and code 0 remains valid',()=>{
 for(const [nemsis,snomed] of Object.entries(COS_ELEMENT_MAPPINGS.avpu)){const s=source([group('a')],[coded('avpu','eVitals.26','a',nemsis)]);assert.equal(run(s,['avpu']).entries[0].resource.valueCodeableConcept.coding[0].code,snomed);}
 const s=source([group('a')],[numeric('pain','eVitals.27','a',0),coded('scale','eVitals.28','a','3328003')]);let r=run(s,['painNrs']);assert.equal(r.entries[0].resource.valueCodeableConcept.coding[0].code,'0');assert.equal(r.items.length,0);
 s.occurrences[1].code='3328001';r=run(s,['painNrs']);assert.equal(r.entries[0].resource.valueCodeableConcept.coding[0].code,'0');assert.deepEqual(r.findings,[]);
});
test('qualifiers and missing times never become assertions; stable identity survives delivery changes',()=>{
 const s=source([group('a')],[numeric('spo','eVitals.12','a',98)]);const first=run(s,['oxygenSaturation']).entries[0].resource;
 const next=buildCosVitals(s,[mapping('oxygenSaturation')],{...context,deliveryId:'amendment'},100).entries[0].resource;
 assert.deepEqual(first.identifier,next.identifier);assert.notEqual(first.id,next.id);
 const renamed=buildCosVitals(s,[{...mapping('oxygenSaturation'),id:'renamed-admin-mapping'}],context,100).entries[0].resource;assert.deepEqual(first.identifier,renamed.identifier);
 s.occurrences[0].not_value_code='7701003';assert.equal(run(s,['oxygenSaturation']).entries.length,0);
 delete s.occurrences[0].not_value_code;s.groups[0].documented_time=null;assert.equal(run(s,['oxygenSaturation']).findings[0].code,'clinicalTime');
});
test('medication groups preserve time, typed children and pinned terminology without guessing',()=>{
 const s=source([group('m',null,'eMedications.MedicationGroup')],[coded('drug','eMedications.03','m','123'),numeric('dose','eMedications.05','m',2),coded('unit','eMedications.06','m','u'),coded('route','eMedications.04','m','r')]);
 for(const [id,code,label] of [['eMedications.03','123','Fictional medicine'],['eMedications.06','u','mg'],['eMedications.04','r','Oral']])s.configuration.catalogFields[id]={codeChoices:[{code,codeSystem:'',label}]};
 const maps=[{id:'meds',groupId:'eMedications.MedicationGroup'}];let r=buildCosMedications(s,maps);assert.equal(r.items.length,1);assert.equal(r.items[0].answer[0].item[2].answer[0].valueDecimal,2);assert.equal(r.items[0].answer[0].item[1].answer[0].valueString,'Fictional medicine');
 s.configuration.catalogFields['eMedications.03'].codeChoices=[];r=buildCosMedications(s,maps);assert.equal(r.items.length,0);assert.equal(r.findings[0].code,'clinicalTerminology');
});

test('incomplete BP with diastolic only is reported rather than lost',()=>{
 const s=source([group('a')],[numeric('dia','eVitals.07','a',80)]);
 const result=run(s,['bloodPressure']);assert.equal(result.entries.length,0);assert.equal(result.findings[0]?.coverage,'partial');assert.equal(result.findings[0]?.code,'clinicalCompanionMissing');
});
test('systolic-only assessment reports a missing companion and preserves a separate complete BP',()=>{
 const s=source([group('a'),group('b'),group('bp1','a','eVitals.BloodPressureGroup',null),group('bp2','b','eVitals.BloodPressureGroup',null)],
  [numeric('s1','eVitals.06','bp1',120),numeric('s2','eVitals.06','bp2',140),{id:'d2',element_id:'eVitals.07',group_instance_id:'bp2',value_kind:'text',value_text:'93'}]);
 const result=run(s,['bloodPressure']);
 assert.deepEqual(result.findings,[{mappingId:'bloodPressure',occurrenceId:'s1',code:'clinicalCompanionMissing',coverage:'partial'}]);
 assert.deepEqual(result.entries.map(e=>e.resource.component.map(c=>c.valueQuantity.value)),[[140,93]]);
});
test('companion diagnostics distinguish missing values, duplicate candidates and invalid times for BP',()=>{
 for(const [vital,primary,secondary] of [['bloodPressure','eVitals.06','eVitals.07']]){
  const s=source([group('a')],[numeric('primary',primary,'a',4)]);
  assert.equal(run(s,[vital]).findings[0].code,'clinicalCompanionMissing');
  const companion=vital==='bloodPressure'?numeric('companion',secondary,'a',80):coded('companion',secondary,'a','3328003');
  s.occurrences.push(companion,{...companion,id:'duplicate'});
  assert.equal(run(s,[vital]).findings[0].code,'clinicalGroup');
  s.occurrences.pop();s.groups.push(group('nested','a','custom','2026-10-27T10:01:00+01:00'));companion.group_instance_id='nested';
  assert.equal(run(s,[vital]).findings[0].code,'clinicalTime');
 }
});
test('v2 requires authoritative assessment ancestry and nested medication fields retain their group',()=>{
 const invalid=source([group('a',null,'arbitrary')],[numeric('spo','eVitals.12','a',98)]);assert.equal(run(invalid,['oxygenSaturation']).findings[0].code,'clinicalGroup');
 const s=source([group('m',null,'eMedications.MedicationGroup'),group('child','m','custom',null)],[{id:'drug',element_id:'eMedications.03',group_instance_id:'child',value_kind:'text',value_text:'Fictional medicine'},numeric('dose','eMedications.05','child',2),{id:'unit',element_id:'eMedications.06',group_instance_id:'child',value_kind:'text',value_text:'mg'},{id:'route',element_id:'eMedications.04',group_instance_id:'child',value_kind:'text',value_text:'Oral'}]);
 assert.equal(buildCosMedications(s,[{id:'meds',groupId:'eMedications.MedicationGroup'}]).items.length,1);
});
test('infusion rates remain coverage limitations regardless of administering unit',()=>{
 const s=source([group('m',null,'eMedications.MedicationGroup')],[{id:'drug',element_id:'eMedications.03',group_instance_id:'m',value_kind:'text',value_text:'Fictional medicine'},numeric('dose','eMedications.05','m',2),{id:'unit',element_id:'eMedications.06',group_instance_id:'m',value_kind:'text',value_text:'mg/min'},{id:'route',element_id:'eMedications.04',group_instance_id:'m',value_kind:'text',value_text:'Intravenous'}]);
 const maps=[{id:'meds',groupId:'eMedications.MedicationGroup'}];assert.equal(buildCosMedications(s,maps).findings[0].code,'medicationRate');
 s.occurrences.push(coded('other','eMedications.13','m','9923003'));const result=buildCosMedications(s,maps);assert.equal(result.items.length,0);assert.equal(result.findings[0].code,'medicationRate');assert.equal(result.findings[0].coverage,'partial');
});
test('v2 missing mappings cannot silently downgrade documented vitals; absent values are excluded',async()=>{
 const {cosUnmappedClinicalFindings}=await import('../dist/hospital/cos-completeness.js');
 const mapping={schemaVersion:2,vitalMappings:[]},s=source([group('a')],[numeric('spo','eVitals.12','a',98)]);
 assert.equal(cosUnmappedClinicalFindings(s,mapping)[0].code,'clinicalMappingMissing');
 s.occurrences[0].not_value_code='7701003';assert.deepEqual(cosUnmappedClinicalFindings(s,mapping),[]);
 s.occurrences=[numeric('pain','eVitals.27','a',3),coded('scale','eVitals.28','a','3328001')];assert.equal(cosUnmappedClinicalFindings(s,mapping)[0].code,'clinicalMappingMissing');
 s.occurrences=[];assert.deepEqual(cosUnmappedClinicalFindings(s,mapping),[]);
});
test('official string diastolic values become BP quantities; palpated and nonnumeric text remain findings',()=>{
 const s=source([group('a')],[numeric('sys','eVitals.06','a',120),{id:'dia',element_id:'eVitals.07',group_instance_id:'a',value_kind:'text',value_text:'80'}]);
 for(const value of ['0','80','500']){s.occurrences[1].value_text=value;const result=run(s,['bloodPressure']);assert.equal(result.entries[0].resource.component[1].valueQuantity.value,Number(value));assert.deepEqual(result.findings,[]);}
 for(const value of ['P','p','',' 80','80 ','080','80.5','501','-1','NaN','1e2','80 mmHg',null,true]){s.occurrences[1].value_text=value;const result=run(s,['bloodPressure']);assert.equal(result.entries.length,0,JSON.stringify(value));assert.ok(result.findings.some(f=>f.code==='clinicalValue'));}
 s.occurrences[1].value_text='80';s.occurrences[1].not_value_code='7701003';assert.equal(run(s,['bloodPressure']).entries.length,0);
});

test('catalog terminology resolves absent code systems consistently in COS and PDF',async()=>{
 const {terminologyText}=await import('../dist/hospital/cos-clinical-context.js');
 const {signedPdfValue}=await import('../dist/reports/signed-report-pdf.js');
 const s=source([],[]);
 s.configuration.catalogFields['eMedications.04']={name:'Route',codeChoices:[{code:'9927003',codeSystem:'',label:'Buccal'}]};
 for(const system of [null,undefined,'']){
  const row={...coded('route','eMedications.04','medication','9927003'),code_system:system};
  assert.equal(terminologyText(s,row),'Buccal');
  assert.equal(signedPdfValue(row,s,'en'),'Buccal');
 }
 const wrong={...coded('route','eMedications.04','medication','9927003'),code_system:'different-system'};
 assert.throws(()=>terminologyText(s,wrong),{code:'clinicalTerminology'});
 assert.equal(signedPdfValue(wrong,s,'en'),'Unlabelled value');
});

 test('AVPU rejects unrelated namespaces while pain ignores scale metadata',()=>{
  const avpu=source([group('a')],[coded('avpu','eVitals.26','a','3326001')]);
  avpu.occurrences[0].code_system='unrelated-system';
  assert.equal(run(avpu,['avpu']).findings[0].code,'clinicalTerminology');
  const pain=source([group('a')],[numeric('pain','eVitals.27','a',4),coded('scale','eVitals.28','a','3328003')]);
  pain.occurrences[1].code_system='unrelated-system';
  const result=run(pain,['painNrs']);assert.equal(result.entries[0].resource.valueCodeableConcept.coding[0].code,'4');assert.deepEqual(result.findings,[]);
 });


test('prior-care and other-unit metadata never change medication export or mapping completeness',async()=>{
 const {cosUnmappedClinicalFindings}=await import('../dist/hospital/cos-completeness.js');
 const s=source([group('m',null,'eMedications.MedicationGroup')],[
  {id:'drug',element_id:'eMedications.03',group_instance_id:'m',value_kind:'text',value_text:'Fictional medicine'},
  numeric('dose','eMedications.05','m',2),
  {id:'unit',element_id:'eMedications.06',group_instance_id:'m',value_kind:'text',value_text:'mg'},
  {id:'route',element_id:'eMedications.04',group_instance_id:'m',value_kind:'text',value_text:'Oral'},
 ]);
 const maps=[{id:'meds',groupId:'eMedications.MedicationGroup'}];
 const baseline=buildCosMedications(s,maps),rows=[...s.occurrences];
 assert.equal(baseline.items.length,1);assert.deepEqual(baseline.findings,[]);
 const variants=[undefined,{value_kind:'coded',code:'9923001'},{value_kind:'coded',code:'9923003'},
  {value_kind:'coded',code:'9923005'},{value_kind:'null',not_value_code:'7701003'}];
 for(const prior of variants)for(const other of variants){
  s.occurrences=[...rows,...(prior?[{id:'prior',element_id:'eMedications.02',group_instance_id:'m',...prior}]:[]),
   ...(other?[{id:'other',element_id:'eMedications.13',group_instance_id:'m',...other}]:[])];
  assert.deepEqual(buildCosMedications(s,maps),baseline);
  assert.deepEqual(cosUnmappedClinicalFindings(s,{schemaVersion:2,medicationMappings:maps}),[]);
  assert.deepEqual(cosUnmappedClinicalFindings(s,{schemaVersion:2,medicationMappings:[]}),
   [{mappingId:'administered-medications',occurrenceId:'m',code:'clinicalMappingMissing',coverage:'partial'}]);
 }
});

test('pain exports the recorded number without a scale companion, including legacy mappings',()=>{
 for(const score of [0,4,10])for(const scale of [[],[coded('scale','eVitals.28','a','3328001')],
  [{...coded('scale','eVitals.28','a','3328003'),not_value_code:'7701003'}],
  [coded('scale','eVitals.28','a','3328003'),coded('duplicate','eVitals.28','a','3328001')]]){
  const s=source([group('a')],[numeric('pain','eVitals.27','a',score),...scale]);
  for(const companionSource of [undefined,field('eVitals.28')]){
   const result=buildCosVitals(s,[{...mapping('painNrs'),companionSource}],context,100);
   assert.deepEqual(result.findings,[]);
   assert.equal(result.entries[0].resource.valueCodeableConcept.coding[0].code,String(score));
  }
 }
 for(const score of [-1,11,1.5,NaN]){
  const result=run(source([group('a')],[numeric('pain','eVitals.27','a',score)]),['painNrs']);
  assert.equal(result.entries.length,0);assert.equal(result.findings[0].code,'clinicalValue');
 }
});
