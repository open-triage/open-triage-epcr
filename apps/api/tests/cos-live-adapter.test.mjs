import test from 'node:test';
import assert from 'node:assert/strict';
import {CosLiveAdapter,cosApiUrl,cosObservationMatches,cosNoteItemsMatch,cosTemplateNoteItemsMatch} from '../dist/hospital/cos-live-adapter.js';
import {cosObservationDigest,buildCosEncounter,pinCosTransportTime} from '../dist/hospital/cos-live-delivery.js';
const settings={baseUrl:'https://receiver.example/api/open/',tokenUrl:'https://identity.example/token',clientId:'client',scope:'user/*.read user/*.write',acceptedProfiles:['profile'],pdfKeyword:'PDF',versionMarkerLinkId:'123456'};
const credential={clientSecret:'PRIVATE',subscriptionKey:'PRIVATE-SUBSCRIPTION'};
const outcome=(severity='information',code='informational')=>({resourceType:'OperationOutcome',issue:[{severity,code,diagnostics:'PRIVATE patient text'}]});
const response=(body,status=200,headers={})=>({body:JSON.stringify(body),status,headers});
test('COS confines pagination and receipts to configured API, rejects credentialed/traversal URLs',()=>{
 for(const path of ['https://evil.example/api/open/fhir','../outside','%2f..%2foutside','https://user:pass@receiver.example/api/open/fhir'])assert.throws(()=>cosApiUrl(settings.baseUrl,path));
 assert.equal(cosApiUrl(settings.baseUrl,'fhir/Observation').href,settings.baseUrl+'fhir/Observation');
});
test('COS OAuth and write evidence share bounded transport and strip diagnostics',async()=>{
 const requests=[];const adapter=new CosLiveAdapter(settings,credential,async options=>{requests.push(options);return options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):response(outcome(),201,{location:settings.baseUrl+'fhir/Observation/123'});});
 const receipt=await adapter.write('fhir/Observation','POST',{resourceType:'Observation'});
 assert.equal(receipt.state,'accepted');assert.equal(receipt.remoteId,'123');assert.equal(JSON.stringify(receipt.issues).includes('PRIVATE'),false);
 assert.match(requests[0].body,/grant_type=client_credentials/);assert.equal(requests[1].headers['accept-language'],'sv-SE');assert.equal(requests[1].headers.authorization,'Bearer TOKEN');
 await adapter.write('fhir/Observation','POST',{resourceType:'Observation'});assert.equal(requests.length,3,'valid token reused');
});
test('COS 2xx errors and potentially committed server failures never prove success',async()=>{
 for(const [status,body,expected] of [[200,outcome('error','invalid'),'rejected'],[500,outcome('error','exception'),'uncertain'],[201,{},'uncertain']]){
  const adapter=new CosLiveAdapter(settings,credential,async options=>options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):response(body,status));
  assert.equal((await adapter.write('fhir/Observation','POST',{resourceType:'Observation'})).state,expected);
 }
});
test('COS bounded pagination rejects cycles and external next links before credential disclosure',async()=>{
 for(const next of ['fhir/Observation','https://evil.example/']){
  let calls=0;const adapter=new CosLiveAdapter(settings,credential,async options=>{calls++;return options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):response({resourceType:'Bundle',type:'searchset',entry:[],link:[{relation:'next',url:next}]});});
  await assert.rejects(adapter.search('fhir/Observation'));assert.equal(calls,2);
 }
});
test('Observation verification requires remote identity, encounter, exact time, components and patient',()=>{
 const expected={resourceType:'Observation',id:'local',status:'final',subject:{identifier:{system:'patient',value:'1'}},encounter:{identifier:{system:'encounter',value:'1'}},effectiveDateTime:'2026-10-27T10:00:00Z',component:[{code:{coding:[{system:'loinc',code:'systolic'}]},valueQuantity:{value:120,code:'mm[Hg]'}}]};
 const actual={...structuredClone(expected),id:'remote'};assert.equal(cosObservationMatches(expected,actual,'remote'),true);
 for(const patch of [{id:'other'},{encounter:{identifier:{system:'encounter',value:'2'}}},{effectiveDateTime:'2026-10-27T10:01:00Z'},{component:[]}])assert.equal(cosObservationMatches(expected,{...actual,...patch},'remote'),false);
});
test('Observation ledger ignores amendment signer and transport metadata but detects changed measurement',()=>{
 const one={resourceType:'Observation',id:'a',meta:{lastUpdated:'one'},identifier:[{value:'source'}],valueQuantity:{value:72},performer:[{type:'Practitioner',identifier:{value:'signer1'}},{type:'Organization',identifier:{value:'unit'}}]};
 const two={...structuredClone(one),id:'b',meta:{lastUpdated:'two'}};two.performer[0].identifier.value='signer2';assert.equal(cosObservationDigest(one),cosObservationDigest(two));two.valueQuantity.value=73;assert.notEqual(cosObservationDigest(one),cosObservationDigest(two));
});
test('Encounter uses report start, signature completion and actual arrival separately',()=>{
 const source={reportId:'report',signedAt:'2026-10-27T11:00:00Z',amendments:[],amendmentSequence:0,occurrences:[{id:'arrival',element_id:'eTimes.11',value_kind:'datetime',value_datetime:'2026-10-27T10:30:00Z'}]};
 const payload={contact:{encounter:{system:'encounter',value:'report'},patient:{system:'patient',value:'1'},staff:'author'}};
 const result=buildCosEncounter(source,payload,{startedAt:'2026-10-27T10:00:00Z',unit:{rakelId:'001-23'},destination:{hsaId:'hospital'}});
 assert.equal(result.period.end,source.signedAt);assert.equal(result.period.start,'2026-10-27T10:00:00Z');assert.equal(result.hospitalization.extension[0].valueDateTime,'2026-10-27T10:30:00Z');assert.equal(result.location[0].location.identifier.value,'001-23');
 assert.throws(()=>buildCosEncounter(source,payload,{unit:{rakelId:'123'}}));
 for(const occurrences of [[],[{...source.occurrences[0],value_datetime:'invalid'}],[...source.occurrences,{...source.occurrences[0],id:'arrival-2'}]]){
  const withoutArrival=buildCosEncounter({...source,occurrences},payload,{startedAt:'2026-10-27T10:00:00Z',unit:{rakelId:'001-23'},destination:{hsaId:'hospital'}});
  assert.equal(withoutArrival.hospitalization.extension,undefined,'optional clinical arrival never gates delivery');
  assert.equal(withoutArrival.hospitalization.destination.identifier.value,'hospital');
 }
});
test('Receiver reference read-back binds exact patient and encounter and normalizes clinical coding order',()=>{
 const expected={resourceType:'Observation',status:'final',meta:{profile:['profile']},subject:{identifier:{value:'patient'}},encounter:{identifier:{value:'business'}},effectiveDateTime:'2026-10-27T10:00:00+01:00',code:{coding:[{system:'loinc',code:'pulse'}]},valueQuantity:{value:72,system:'http://unitsofmeasure.org',code:'/min'}};
 const actual={resourceType:'Observation',id:'42',status:'final',meta:{profile:['profile']},subject:{reference:'Patient/12'},encounter:{reference:'Encounter/31'},effectiveDateTime:'2026-10-27T09:00:00Z',code:{coding:[{system:'local',code:'extra'},{system:'loinc',code:'pulse',display:'Pulse'}]},valueQuantity:{value:72,system:'http://unitsofmeasure.org',code:'/min',unit:'beats per minute'}};
 assert.equal(cosObservationMatches(expected,actual,'42',{patientReference:'Patient/12',encounterId:'31'}),true);
 assert.equal(cosObservationMatches(expected,actual,'42',{patientReference:'Patient/12',encounterId:'32'}),false);
 actual.valueQuantity.value='72';assert.equal(cosObservationMatches(expected,actual,'42',{patientReference:'Patient/12',encounterId:'31'}),false);
});
test('Expired tokens refresh and omitted configured scope never requests invented scopes',async()=>{
 const requests=[];const adapter=new CosLiveAdapter({...settings,scope:undefined},credential,async options=>{requests.push(options);return options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:0}):response({resourceType:'CapabilityStatement'});});
 await adapter.read('fhir/metadata');await adapter.read('fhir/metadata');
 assert.equal(requests.filter(r=>r.url.href===settings.tokenUrl).length,2);assert.equal(new URLSearchParams(requests[0].body).has('scope'),false);
});

test('Prepared transport timestamps advance monotonically without changing authored clinical time',()=>{
 const payload={bundle:{meta:{lastUpdated:'2026-10-27T10:00:00Z'},entry:[{resource:{meta:{lastUpdated:'2026-10-27T10:00:00Z'},authored:'2026-10-27T10:00:00Z'}}]},observations:[{meta:{lastUpdated:'old'},effectiveDateTime:'2026-10-27T09:00:00Z'}],pdfSha256:'a'.repeat(64)};
 const timestamp=pinCosTransportTime(payload,['2026-10-27T11:00:00Z'],new Date('2026-10-27T10:30:00Z'));
 assert.equal(timestamp,'2026-10-27T11:00:00.001Z');assert.equal(payload.bundle.entry[0].resource.authored,'2026-10-27T10:00:00Z');assert.equal(payload.observations[0].effectiveDateTime,'2026-10-27T09:00:00Z');assert.match(payload.payloadSha256,/^[a-f0-9]{64}$/);
});
test('HTML authentication rejection is definite without retaining remote body',async()=>{
 const adapter=new CosLiveAdapter(settings,credential,async options=>options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):{status:403,body:'<html>PRIVATE</html>',headers:{}});
 const receipt=await adapter.write('fhir/Observation','POST',{resourceType:'Observation'});assert.equal(receipt.state,'rejected');assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);
});

test('Note read-back consumes repeated medication items one by one',()=>{
 const administration={linkId:'medication',item:[{linkId:'name',answer:[{valueString:'Medication'}]},{linkId:'dose',answer:[{valueString:'1 mg'}]}]};
 assert.equal(cosNoteItemsMatch([administration,administration],[administration]),false);
 assert.equal(cosNoteItemsMatch([administration,administration],[administration,structuredClone(administration)]),true);
});
test('Standalone Observation binding uses verified encounter reference without changing canonical identities',async()=>{
 const adapter=new CosLiveAdapter(settings,credential,async()=>{throw new Error('No transport for binding');});
 const source={resourceType:'Observation',subject:{identifier:{system:'patient',value:'1'}},encounter:{identifier:{system:'business',value:'call'}},performer:[{type:'Practitioner',identifier:{system:'hsa',value:'author'}}]};
 const before=structuredClone(source);
 const bound=await adapter.bindObservation(source,{id:'106952',identifier:[{system:'business',value:'call'}]});
 assert.deepEqual(bound.encounter,{type:'Encounter',reference:'Encounter/106952'});assert.deepEqual(source,before);assert.deepEqual(bound.subject,source.subject);assert.deepEqual(bound.performer,source.performer);
 await assert.rejects(adapter.bindObservation(source,{id:'106953',identifier:[{system:'business',value:'other-call'}]}));
});
test('Actual COS Observation search contract, second precision and contained PractitionerRole verify exact identities',async()=>{
 const expected={resourceType:'Observation',meta:{profile:['profile']},status:'final',subject:{identifier:{system:'patient',value:'1'}},encounter:{identifier:{system:'business',value:'call'}},effectiveDateTime:'2026-10-27T14:44:06.123Z',code:{coding:[{system:'loinc',code:'pulse'}]},valueQuantity:{value:72,system:'http://unitsofmeasure.org',code:'/min',unit:'/min'},performer:[{type:'Practitioner',identifier:{system:'hsa',value:'author'}},{type:'Organization',identifier:{system:'hsa',value:'ambulance-unit'}}]};
 const actual={...structuredClone(expected),id:'19950',subject:{reference:'Patient/456'},encounter:{reference:'Encounter/106952'},effectiveDateTime:'2026-10-27T15:44:06+01:00',performer:[{reference:'#1'}],contained:[{resourceType:'PractitionerRole',id:'1',practitioner:{reference:'Practitioner/1038'},organization:{reference:'Organization/2152'}}]};
 let wrongUnit=false;const requests=[];
 const adapter=new CosLiveAdapter(settings,credential,async options=>{
  requests.push(options);const url=options.url;
  if(url.href===settings.tokenUrl)return response({access_token:'TOKEN',expires_in:300});
  if(url.pathname.endsWith('/Observation/_search')){assert.equal(url.searchParams.get('patient'),'456');assert.equal(url.searchParams.has('subject.identifier'),false);assert.equal(url.searchParams.getAll('date').length,2);return response({resourceType:'Bundle',type:'searchset',entry:[{resource:actual}]});}
  if(url.pathname.endsWith('/Practitioner/1038'))return response({resourceType:'Practitioner',id:'1038',identifier:[{system:'hsa',value:'author'}]});
  if(url.pathname.endsWith('/Organization/2152'))return response({resourceType:'Organization',id:'2152',identifier:[{system:'hsa',value:wrongUnit?'hospital':'ambulance-unit'}]});
  throw new Error('Unexpected receiver route');
 });
 const encounter={id:'106952',subject:{reference:'Patient/456'}};
 assert.equal((await adapter.verifyObservation(expected,'19950',encounter))?.id,'19950');
 assert.equal(await adapter.verifyObservation(expected,'19951',encounter),undefined,'similar reading without receipt identity never confirms');
 wrongUnit=true;assert.equal(await adapter.verifyObservation(expected,'19950',encounter),undefined,'receiving hospital cannot replace ambulance performer');
});

test('Version-pinned template matches nested keyword ordinals with exact value multiplicity',()=>{
 const canonical='http://fhir.cambio.se/fhir/Questionnaire/1860|2037';
 const template={resourceType:'Questionnaire',id:'1860',version:'2037',url:canonical,item:[{linkId:'1860.2037.2.0.14617',code:[{system:'http://snomed.info/sct',code:'263490005'}]},{linkId:'1860.2037.2.4.0.14629',code:[{system:'http://snomed.info/sct',code:'86290005'}]}]};
 const expected=[{linkId:'263490005',answer:[{valueString:'marker'}]},{linkId:'86290005',answer:[{valueString:'16 /min'},{valueString:'16 /min'}]}];
 const actual=[{linkId:'1860.2037.2.14615',item:[{linkId:'1860.2037.2.0.14617',answer:[{valueString:'marker'}]},{linkId:'1860.2037.2.4.1.14629',answer:[{valueString:'16 /min'},{valueString:'16 /min'}]},{linkId:'1860.2037.6.1500'}]}];
 assert.equal(cosTemplateNoteItemsMatch(expected,actual,template,canonical),true);
 const missing=structuredClone(actual);missing[0].item[1].answer.pop();assert.equal(cosTemplateNoteItemsMatch(expected,missing,template,canonical),false);
 assert.equal(cosTemplateNoteItemsMatch(expected,actual,{...template,version:'2038'},canonical),false);
 const ambiguous=structuredClone(template);ambiguous.item.push({linkId:'1860.2037.9.14629',code:[{system:'http://snomed.info/sct',code:'other'}]});assert.equal(cosTemplateNoteItemsMatch(expected,actual,ambiguous,canonical),false);
 assert.equal(cosTemplateNoteItemsMatch([{linkId:'medication',item:[{linkId:'dose',answer:[{valueString:'1 mg'}]}]}],actual,template,canonical),false);
});
test('Version-pinned note verification accepts only exact newline joining of repeated text answers',()=>{
 const canonical='http://fhir.cambio.se/fhir/Questionnaire/1860|2037';
 const codes=['1104441000000107','364075005','103228002','86290005'];
 const template={resourceType:'Questionnaire',id:'1860',version:'2037',url:canonical,item:codes.map((code,index)=>({linkId:`1860.2037.2.${index}`,code:[{system:'http://snomed.info/sct',code}]}))};
 const values=['10:00: 16 /min','10:05: 18 /min'];
 const expected=codes.map(linkId=>({linkId,answer:values.map(valueString=>({valueString}))}));
 const actual=template.item.map(item=>({linkId:item.linkId,answer:[{valueString:values.join('\n')}]}));
 const matches=received=>cosTemplateNoteItemsMatch(expected,received,template,canonical);
 assert.equal(matches(actual),true);
 for(const value of [values[0],values[1],values.join(' '),values.join('\r\n'),[...values].reverse().join('\n'),values.join('\n')+'\n',values.join('\n').replace('18','19'),[...values,values[1]].join('\n')]){
  const changed=structuredClone(actual);changed[0].answer=[{valueString:value}];assert.equal(matches(changed),false,value);
 }
 const extra=structuredClone(actual);extra[0].answer.push({valueString:values[0]});assert.equal(matches(extra),false);
 assert.equal(cosTemplateNoteItemsMatch(expected,actual,{...template,version:'2038'},canonical),false);
 const duplicate=[{linkId:codes[0],answer:[{valueString:'same'},{valueString:'same'}]}];
 assert.equal(cosTemplateNoteItemsMatch(duplicate,[{linkId:actual[0].linkId,answer:[{valueString:'same\nsame'}]}],template,canonical),true);
 assert.equal(cosTemplateNoteItemsMatch(duplicate,[{linkId:actual[0].linkId,answer:[{valueString:'same'}]}],template,canonical),false);
});
test('Actual note shape binds journal contact, contained author, exact template version and second precision',async()=>{
 const canonical='http://fhir.cambio.se/fhir/Questionnaire/1860|2037',marker='OpenTriage delivery delivery';
 const note={resourceType:'QuestionnaireResponse',status:'completed',questionnaire:canonical,subject:{identifier:{system:'patient',value:'1'}},encounter:{identifier:{system:'business',value:'call'}},author:{identifier:{system:'hsa',value:'author'}},authored:'2026-10-27T14:44:06.123Z',item:[{linkId:'263490005',answer:[{valueString:marker}]}]};
 const stored={resourceType:'QuestionnaireResponse',id:'135158',status:'completed',questionnaire:canonical,subject:{reference:'Patient/456'},author:{reference:'#1'},contained:[{resourceType:'PractitionerRole',id:'1',practitioner:{reference:'Practitioner/1038'}}],authored:'2026-10-27T15:44:06+01:00',item:[{linkId:'1860.2037.2.14615',item:[{linkId:'1860.2037.2.0.14617',answer:[{valueString:marker}]}]}]};
 const template={resourceType:'Questionnaire',id:'1860',version:'2037',url:canonical,item:[{linkId:'1860.2037.2.0.14617',code:[{system:'http://snomed.info/sct',code:'263490005'}]}]};
 const journal={journalNoteEHRExtract:[{patient:{patientInternalID:'456',patientID:{extension:'1'}},hCMContact:{hCMContactInternalID:'106952'},note:{noteActive:true,noteId:{extension:'cos:JournalNoteId:135158'},records:{record:[{keyword:'Status',value:[{value:marker,journalValueType:'Text'}]},{keyword:'PDF',value:[{value:'submitted.pdf',journalValueType:'Document'}]}]}}}]};
 const adapter=new CosLiveAdapter(settings,credential,async options=>{
  const url=options.url;
  if(url.href===settings.tokenUrl)return response({access_token:'TOKEN',expires_in:300});
  if(url.pathname.endsWith('/journalnotes/'))return response(journal);
  if(url.pathname.endsWith('/QuestionnaireResponse/135158'))return response(stored);
  if(url.pathname.endsWith('/Questionnaire/1860'))return response(template);
  if(url.pathname.endsWith('/Practitioner/1038'))return response({resourceType:'Practitioner',id:'1038',identifier:[{system:'hsa',value:'author'}]});
  throw new Error('Unexpected read route');
 });
 const bundle={entry:[{resource:note}]},encounter={id:'106952',subject:{reference:'Patient/456'}};
 assert.equal((await adapter.verifyNote(bundle,encounter,'delivery'))?.documentRecorded,true);
 note.item.push({linkId:'86290005',answer:[{valueString:'10:00: 16 /min'},{valueString:'10:05: 18 /min'}]});
 template.item.push({linkId:'1860.2037.2.4.0.14629',code:[{system:'http://snomed.info/sct',code:'86290005'}]});
 stored.item[0].item.push({linkId:'1860.2037.2.4.1.14629',answer:[{valueString:'10:00: 16 /min\n10:05: 18 /min'}]});
 assert.equal((await adapter.verifyNote(bundle,encounter,'delivery'))?.noteVerified,true,'full read-back verifies newline-joined readings');
 stored.encounter={reference:'Encounter/wrong'};assert.equal(await adapter.verifyNote(bundle,encounter,'delivery'),undefined);delete stored.encounter;
 note.item.push({linkId:'62521000052103',answer:[{item:[{linkId:'dose',answer:[{valueString:'2 mg'}]}]}]});
 const partial=await adapter.verifyNote(bundle,encounter,'delivery');assert.equal(partial.noteVerified,false);assert.equal(partial.documentRecorded,true);assert.equal(partial.verificationFinding,'medicationRepresentationUnverified');
 template.version='2038';assert.equal(await adapter.verifyNote(bundle,encounter,'delivery'),undefined);
 const pdf=await adapter.verifyPdf(bundle,encounter,'delivery');
 assert.equal(pdf.state,'document-recorded','exact journal PDF evidence survives a structured template mismatch');
 assert.equal(pdf.pdfBytesReadBack,false);
 assert.equal(await adapter.verifyNote(bundle,encounter,'delivery',pdf),undefined);
});

test('Outpatient Encounter verifies returned organization context and records absent routing coverage explicitly',async()=>{
 const hsa='urn:oid:1.2.752.129.2.1.4.1';
 const expected={resourceType:'Encounter',identifier:[{system:'encounter',value:'call'}],status:'finished',subject:{identifier:{system:'patient',value:'1'}},period:{start:'2026-10-27T09:00:00.345Z',end:'2026-10-27T10:00:00.678Z'},participant:[{individual:{identifier:{system:hsa,value:'author'}}}],location:[{location:{identifier:{system:'rakel',value:'001-23'}}}],hospitalization:{destination:{identifier:{system:hsa,value:'destination'}}}};
 const actual={resourceType:'Encounter',id:'106952',identifier:[{use:'official',system:'encounter',value:'call'}],status:'finished',subject:{reference:'Patient/456',identifier:{system:'patient',value:'1'}},period:{start:'2026-10-27T10:00:00+01:00',end:'2026-10-27T11:00:00+01:00'},participant:expected.participant,serviceProvider:{identifier:{system:hsa,value:'provider'}},extension:[{url:'https://fhir.cambio.se/StructureDefinition/encounterPerformingUnit',valueReference:{identifier:{system:hsa,value:'ambulance'}}}]};
 const adapter=new CosLiveAdapter(settings,credential,async options=>options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):response({resourceType:'Bundle',type:'searchset',entry:[{resource:actual}]}));
 const organizations={careProviderHsaId:'provider',careUnitHsaId:'ambulance'};
 const verified=await adapter.verifyEncounter(expected,'106952',organizations);
 assert.equal(verified?._openTriageVerification.performingUnit,'verified');assert.equal(verified?._openTriageVerification.rakel,'submitted-not-returned');assert.equal(verified?._openTriageVerification.destination,'submitted-not-returned');
 actual.hospitalization={destination:{identifier:{system:hsa,value:'wrong-destination'}}};assert.equal(await adapter.verifyEncounter(expected,'106952',organizations),undefined);
});

test('Empty successful receipts retain remote IDs for supported read-back routes',async()=>{
 const adapter=new CosLiveAdapter(settings,credential,async options=>options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):{status:201,body:'',headers:{'content-location':settings.baseUrl+'fhir/Encounter/106996'}});
 const receipt=await adapter.write('fhir/subscription/Encounter/report','PUT',{resourceType:'Encounter'});
 assert.equal(receipt.state,'uncertain');assert.equal(receipt.remoteId,'106996');
});
test('Receipt-less encounter reconciliation searches supported patient/profile query and filters business identity locally',async()=>{
 const expected={identifier:[{system:'business',value:'call'}],subject:{identifier:{system:'patient',value:'1'}},status:'finished',period:{start:'2026-10-27T09:00:00Z',end:'2026-10-27T10:00:00Z'}};
 const adapter=new CosLiveAdapter(settings,credential,async options=>{
  if(options.url.href===settings.tokenUrl)return response({access_token:'TOKEN',expires_in:300});
  assert.equal(options.url.searchParams.get('subject.identifier'),'patient|1');assert.equal(options.url.searchParams.has('identifier'),false);assert.equal(options.url.searchParams.has('_id'),false);
  return response({resourceType:'Bundle',type:'searchset',entry:[]});
 });
 assert.equal(await adapter.verifyEncounter(expected,undefined,{careProviderHsaId:'provider',careUnitHsaId:'unit'}),undefined);
});

test('patient lookup distinguishes explicit absence from auth, malformed, ambiguous and transport failures',async()=>{
 const id={system:'urn:oid:1.2.752.129.2.1.3.3',value:'201304822172'};
 const absent={resourceType:'OperationOutcome',issue:[{severity:'error',code:'processing',diagnostics:'Patient Not found for the given identifier'}]};
 for(const [body,status,missing] of [[absent,404,true],[{resourceType:'Bundle',type:'searchset',total:0},200,true],[absent,403,false],[{},404,false],[{resourceType:'Bundle',type:'searchset',total:1},200,false],[{resourceType:'Bundle',type:'searchset',entry:[{resource:{resourceType:'Patient'}},{resource:{resourceType:'Patient'}}]},200,false],[{resourceType:'Bundle',type:'searchset',total:0,link:[{relation:'next',url:'next'}]},200,false]]){
  const a=new CosLiveAdapter(settings,credential,async options=>options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):response(body,status));
  if(missing)assert.equal(await a.findPatient(id),undefined);else await assert.rejects(a.findPatient(id));
 }
});

test('COS medication text proves all five fields in the exact template, with explicit minute precision',()=>{
 const canonical='http://fhir.cambio.se/fhir/Questionnaire/1860|2037';
 const template={resourceType:'Questionnaire',id:'1860',version:'2037',url:canonical,item:[{linkId:'1860.2037.5.2761',code:[{system:'http://snomed.info/sct',code:'62521000052103'}]}]};
 const medication=time=>({linkId:'62521000052103',answer:[{valueCoding:{system:'http://snomed.info/sct',code:'62521000052103'},item:[
  {linkId:'118575009',answer:[{valueDateTime:time}]},{linkId:'410942007',answer:[{valueString:'Synthetic drug'}]},
  {linkId:'118555000',answer:[{valueDecimal:100}]},{linkId:'767525000',answer:[{valueString:'mg/kg'}]},{linkId:'410675002',answer:[{valueString:'Urethral'}]}
 ]}]});
 const actual=text=>[{linkId:'1860.2037.5.2761',answer:[{valueString:text}]}];
 const line='(2026-10-30 12:43)     Synthetic drug 100 mg/kg Urethral';
 const expected=[medication('2026-10-30T11:43:59Z')];
 const match=(e,a,t=template)=>cosTemplateNoteItemsMatch(e,a,t,canonical);
 assert.equal(match(expected,actual(line)),true);
 for(const changed of [line.replace('12:43','11:43'),line.replace('Synthetic drug','Other drug'),line.replace('100','10'),line.replace('mg/kg','mg'),line.replace('Urethral','Oral'),''])assert.equal(match(expected,actual(changed)),false);
 assert.equal(match([medication('2026-07-30T22:43:59Z')],actual('(2026-07-31 00:43)     Synthetic drug 100 mg/kg Urethral')),true,'summer time and midnight rollover');
 assert.equal(match(expected,actual(line),{...template,version:'2038'}),false);
 const extra=structuredClone(expected);extra[0].answer[0].item.push({linkId:'other',answer:[{valueString:'must not disappear'}]});assert.equal(match(extra,actual(line)),false);
 const missing=structuredClone(expected);missing[0].answer[0].item.pop();assert.equal(match(missing,actual(line)),false);
 assert.equal(match([...expected,...expected],actual(line)),false,'duplicate administrations cannot collapse');
 assert.equal(match([...expected,...expected],actual(line+'\n'+line)),true);
 assert.equal(match([medication('invalid')],actual(line)),false);
});

test('Journal lookup retains bounded empty-response evidence and never treats malformed success as absence',async()=>{
 const bundle={entry:[{resource:{resourceType:'QuestionnaireResponse',authored:'2026-10-30T12:00:00Z',subject:{identifier:{system:'urn:oid:1.2.752.129.2.1.3.3',value:'201304822172'}}}}]};
 const encounter={id:'contact',subject:{reference:'Patient/6905'}};
 let body=[];
 const adapter=new CosLiveAdapter(settings,credential,async req=>req.method==='POST'?response({access_token:'token',expires_in:300}):response(body,200,{'x-request-id':'bounded-request-id'}));
 const empty=await adapter.verifyPdf(bundle,encounter,'delivery');
 assert.equal(empty.reason,'pdfJournalEmpty');assert.equal(empty.journalEvidence.extractCount,0);
 assert.equal(empty.journalEvidence.bodyBytes,2);assert.equal(empty.journalEvidence.httpStatus,200);
 assert.equal(empty.journalEvidence.correlation['x-request-id'],'bounded-request-id');
 assert.match(empty.journalEvidence.bodySha256,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(empty).includes('201304822172'),false);
 for(const invalid of [null,{},outcome('error','processing'),[null],[{journalNoteEHRExtract:{}}],[{journalNoteEHRExtract:[null]}]]){
  body=invalid;await assert.rejects(()=>adapter.verifyPdf(bundle,encounter,'delivery'),/COS read unavailable/);
 }
 body=[{journalNoteEHRExtract:[]}];assert.equal((await adapter.verifyPdf(bundle,encounter,'delivery')).journalEvidence.extractCount,0);
});

test('encounter update binds receiver version by exact business identity without mutating the manifest',async()=>{
 const expected={resourceType:'Encounter',id:'local',identifier:[{system:'business',value:'report'}],subject:{identifier:{system:'patient',value:'123'}},meta:{lastUpdated:'2026-11-01T10:00:00Z',profile:['write-profile']},period:{end:'2026-11-01T10:00:00Z'}};
 const stored={resourceType:'Encounter',id:'remote',identifier:expected.identifier,subject:expected.subject,meta:{versionId:'107304',profile:['read-profile']},period:{end:'2026-11-01T09:00:00Z'}};
 let rows=[stored];const requests=[];
 const adapter=new CosLiveAdapter(settings,credential,async options=>{requests.push(options);return options.url.href===settings.tokenUrl?response({access_token:'TOKEN',expires_in:300}):response({resourceType:'Bundle',type:'searchset',entry:rows.map(resource=>({resource}))});});
 const bound=await adapter.bindEncounter(expected,true);
 assert.deepEqual(bound,{...expected,meta:{...expected.meta,versionId:'107304'}});assert.equal(expected.meta.versionId,undefined);
 assert.equal(requests.filter(r=>r.method!=='GET'&&r.url.href!==settings.tokenUrl).length,0);
 rows=[];assert.deepEqual(await adapter.bindEncounter(expected),expected);await assert.rejects(adapter.bindEncounter(expected,true));
 for(const invalid of [[stored,stored],[{...stored,meta:{}}],[{...stored,meta:{versionId:''}}],[{...stored,meta:{versionId:'bad/value'}}],[{...stored,subject:{identifier:{system:'patient',value:'other'}}}]]){
  rows=invalid;await assert.rejects(adapter.bindEncounter(expected,true));
 }
 rows=[{...stored,identifier:[{system:'other',value:'report'}]}];await assert.rejects(adapter.bindEncounter(expected,true));
 rows=[{...stored,identifier:[{system:'business',value:'different'}]}];await assert.rejects(adapter.bindEncounter(expected,true));
});
