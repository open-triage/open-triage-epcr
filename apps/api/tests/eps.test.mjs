import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {parsePatientSummary,narrativeText,clinicalResourceText} from '@open-triage/contracts';
import {EpsAdapter} from '../dist/hospital/eps-adapter.js';
const fixtures=await Promise.all(['andrea','arne','ville'].map(name=>readFile(new URL(`./fixtures/hospital/${name}.json`,import.meta.url),'utf8').then(JSON.parse)));
const configuration={field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]};
const listing=(name,value)=>({resourceType:'Parameters',parameter:[{name:'entry',part:[{name,valueString:value}]}]});
test('complete EPS projections preserve fictional patients, all resources and all source leaves',()=>{
 for(const bundle of fixtures){
  const {summary,identifiers}=parsePatientSummary(bundle);
  assert.equal(summary.sections.length,bundle.entry.length+1);
  assert.ok(identifiers.length);assert.ok(summary.date);assert.ok(summary.source);assert.ok(summary.authors.length);
  const expected=[];function leaves(v){if(Array.isArray(v))v.forEach(leaves);else if(v&&typeof v==='object')Object.values(v).forEach(leaves);else if(v!==undefined)expected.push(v);}leaves(bundle);
  assert.equal(summary.sections.flatMap(s=>s.rows).length,expected.length);
  assert.ok(summary.sections.some(s=>s.title.includes('Observation')));
 }
 assert.ok(parsePatientSummary(fixtures[1]).summary.sections.some(s=>s.rows.some(r=>r.path==='resourceType'&&r.value==='CarePlan')));
});
test('narrative is inert readable text and unknown references remain visible without fetching',()=>{
 assert.equal(narrativeText('<div>One &amp; two<br/><img src="https://bad" onerror="bad()">Three<script>bad()</script></div>'),'One & two\nThree');
 const bundle=structuredClone(fixtures[0]);bundle.entry[0].resource.section[0].entry=[{reference:'https://example.invalid/private'}];
 const parsed=parsePatientSummary(bundle);assert.ok(parsed.summary.findings.includes('https://example.invalid/private'));
 assert.ok(parsed.summary.sections.flatMap(s=>s.rows).some(r=>r.path.endsWith('.div')&&!r.value.includes('<div')));
});
test('malformed, ambiguous subjects and duplicate references fail closed',()=>{
 for(const body of [null,{}, {...fixtures[0],type:'searchset'},{...fixtures[0],entry:[]}])assert.throws(()=>parsePatientSummary(body));
 const second=structuredClone(fixtures[0]);second.entry.push({resource:{resourceType:'Patient',id:'another'}});assert.throws(()=>parsePatientSummary(second));
 const duplicate=structuredClone(fixtures[0]);duplicate.entry.push(duplicate.entry[1]);assert.throws(()=>parsePatientSummary(duplicate));
});
test('adapter indexes actual Patient identifiers using only sample and published document reads',async()=>{
 const adapter=new EpsAdapter(),paths=[];
 adapter.read=async path=>{paths.push(path);if(path==='/$samples')return listing('id','sample');if(path==='/$exchange')return listing('organizationSlug','team');return path==='/Bundle/sample'?fixtures[0]:fixtures[1];};
 for(const fixture of fixtures.slice(0,2)){const remote=parsePatientSummary(fixture).identifiers[0];const configured={...configuration,namespace:'urn:local',aliases:[remote.system]};
 const found=await adapter.discover(configured,{system:'urn:local',value:remote.value});assert.equal(found.summary.title,parsePatientSummary(fixture).summary.title);}
 assert.deepEqual(new Set(paths),new Set(['/$samples','/$exchange','/Bundle/sample','/Organization/team/$document']));
 assert.equal(await adapter.discover(configuration,{system:configuration.namespace,value:'unmatched'}),null);
 assert.equal(await adapter.discover({...configuration,namespace:'urn:wrong'},{system:'urn:wrong',value:parsePatientSummary(fixtures[0]).identifiers[0].value}),null);
});
test('partial discovery, unsupported listing paths and malformed bundles are lookup failures, never no match',async()=>{
 const adapter=new EpsAdapter();adapter.read=async path=>path==='/$samples'?listing('id','../../secret'):listing('organizationSlug','team');await assert.rejects(adapter.discover(configuration,{system:'x',value:'x'}));
 adapter.read=async path=>path==='/$samples'?listing('id','sample'):path==='/$exchange'?{resourceType:'Parameters',parameter:[]}:{};await assert.rejects(adapter.discover(configuration,{system:'x',value:'x'}));
 adapter.read=async()=>{throw new Error('secret provider body');};await assert.rejects(adapter.discover(configuration,{system:'x',value:'x'}));
});
test('discovery stops scheduling after failure and drains in-flight requests before rejecting',async()=>{
 const adapter=new EpsAdapter();let active=0,started=0;
 adapter.read=async path=>{
  if(path==='/$samples')return {resourceType:'Parameters',parameter:Array.from({length:12},(_,i)=>({name:'entry',part:[{name:'id',valueString:`sample-${i}`}]}))};
  if(path==='/$exchange')return {resourceType:'Parameters',parameter:[]};
  active++;started++;try{if(path==='/Bundle/sample-0')throw new Error('failed');await new Promise(resolve=>setTimeout(resolve,10));return fixtures[0];}finally{active--;}
 };
 await assert.rejects(adapter.discover(configuration,{system:configuration.namespace,value:'x'}));assert.equal(active,0);assert.ok(started<=4);
});
test('multiple matching summaries select the latest clinical instant across timezone offsets',async()=>{
 const earlier=structuredClone(fixtures[0]),later=structuredClone(fixtures[0]);earlier.entry[0].resource.date='2026-10-19T12:00:00+02:00';later.entry[0].resource.date='2026-10-19T11:00:00Z';
 const adapter=new EpsAdapter();adapter.read=async path=>path==='/$samples'?listing('id','earlier'):path==='/$exchange'?listing('organizationSlug','later'):path==='/Bundle/earlier'?earlier:later;
 const id=parsePatientSummary(earlier).identifiers[0];const found=await adapter.discover({...configuration,namespace:id.system},id);assert.equal(found.documentId,'/Organization/later/$document');
});

test('clinical section rows retain canonical resource identities for inline imports',()=>{
 const bundle=structuredClone(fixtures[1]);
 const allergy=bundle.entry.find(e=>e.resource.resourceType==='AllergyIntolerance');
 bundle.entry[0].resource.section=[{title:'Allergies',entry:[{reference:`AllergyIntolerance/${allergy.resource.id}`},{reference:'https://example.invalid/missing'}]}];
 const {summary}=parsePatientSummary(bundle);
 const [entry,unresolved]=summary.clinicalSections[0].entries;
 assert.equal(entry.identity,allergy.fullUrl);
 assert.ok(summary.importEntries.some(candidate=>candidate.identity===entry.identity));
 assert.ok(entry.label);assert.ok(entry.content);
 assert.equal(unresolved.identity,'https://example.invalid/missing');
 assert.ok(summary.findings.includes(unresolved.identity));
});

test('coordination-number EPS requires its configured namespace and does not match by number alone',async()=>{
 const source=structuredClone(fixtures[1]);
 const patient=source.entry.find(entry=>entry.resource.resourceType==='Patient').resource;
 const remote={system:'http://electronichealth.se/identifier/samordningsnummer',value:'201304822172'};
 patient.identifier=[remote];
 const local={system:'http://electronichealth.se/identifier/personnummer',value:remote.value};
 const configured={...configuration,namespace:local.system,aliases:[]};
 const adapter=new EpsAdapter();
 adapter.read=async path=>path==='/$samples'?listing('id','coordination-number'):path==='/$exchange'?{resourceType:'Parameters',parameter:[]}:source;
 assert.equal(await adapter.discover(configured,local),null);
 assert.equal((await adapter.discover({...configured,aliases:[remote.system]},local)).documentId,'/Bundle/coordination-number');
 assert.equal(await adapter.discover({...configured,aliases:[remote.system]},{...local,value:'201304822173'}),null);
});

test('EPS narrative tables preserve cells and bind imports by unique labels, never row position',async()=>{
 const {narrativeTables}=await import('@open-triage/contracts');
 const source=structuredClone(fixtures[1]);
 const conditions=source.entry.filter(entry=>entry.resource.resourceType==='Condition').slice(0,2);
 conditions[0].resource.code={text:'First condition'};conditions[1].resource.code={text:'Second condition'};
 source.entry[0].resource.section=[{title:'Conditions',entry:conditions.map(e=>({reference:e.fullUrl})),text:{div:'<div><p>Source note</p><table><thead><tr><th>Condition</th><th>Date</th><th>Note</th></tr></thead><tbody><tr><td>Second condition</td><td>2026-01-02</td><td></td></tr><tr><td>Text-only condition</td><td></td><td>Not a resource</td></tr><tr><td>First condition</td><td>2025-01-01</td><td>A &amp; B</td></tr></tbody></table></div>'}}];
 const section=parsePatientSummary(source).summary.clinicalSections[0];
 assert.deepEqual(section.tables[0].headers,['Condition','Date','Note']);
 assert.deepEqual(section.tables[0].rows.map(r=>r.cells),[['Second condition','2026-01-02',''],['Text-only condition','','Not a resource'],['First condition','2025-01-01','A & B']]);
 assert.deepEqual(section.tables[0].rows.map(r=>r.identity),[conditions[1].fullUrl,undefined,conditions[0].fullUrl]);
 assert.equal(section.prose,'Source note');
 conditions[1].resource.code.text='First condition';
 assert.ok(parsePatientSummary(source).summary.clinicalSections[0].tables[0].rows.every(row=>!row.identity));
 const inert=narrativeTables('<table><tr><th>Item</th></tr><tr><td><img src="https://bad" onerror="bad()">&lt;script&gt;hello&lt;/script&gt;<script>bad()</script></td></tr></table>');
 assert.equal(inert.tables[0].rows[0].cells[0],'<script>hello</script>');
 const complex=narrativeTables('<table><tr><th colspan="2">Heading</th></tr><tr><td>A</td><td>B</td></tr></table>');
 assert.equal(complex.tables.length,0);assert.match(complex.prose,/Heading/);
});


test('Ville patient story retains four paragraphs and source resource details stay readable',()=>{
 const bundle=fixtures[2],before=JSON.stringify(bundle),{summary}=parsePatientSummary(bundle);
 const story=summary.clinicalSections.find(section=>section.title.includes('Patientberättelse'));
 assert.ok(story);assert.equal(story.prose.split(/\n\n/).length,4);
 assert.equal(story.entries.length,0);assert.equal(story.tables.length,0);
 assert.ok(summary.clinicalSections.flatMap(section=>section.entries).every(entry=>!entry.content.includes('meta.profile[')));
 assert.equal(JSON.stringify(bundle),before,'display parsing does not mutate clinical source');
});
test('clinical resource fallback shows source clinical facts without JSON, paths or invented missing values',()=>{
 const resource={resourceType:'Observation',id:'internal-id',meta:{profile:['https://internal/profile']},code:{text:'Oxygen saturation'},valueQuantity:{value:0,unit:'%'},note:[{text:'Recorded on room air'}],component:[{code:{text:'Pulse'},valueQuantity:{value:80,unit:'/min'}}],extension:[{url:'private-extension',valueString:'hidden technical value'}],subject:{reference:'Patient/internal'}};
 const content=clinicalResourceText(resource);
 for(const expected of ['Oxygen saturation','0 %','Pulse: 80 /min','Recorded on room air'])assert.ok(content.includes(expected));
 for(const excluded of ['resourceType','internal','extension','valueQuantity','unknown','normal'])assert.ok(!content.includes(excluded));
 assert.equal(clinicalResourceText({resourceType:'Observation',meta:resource.meta}), '');
 assert.equal(clinicalResourceText({resourceType:'MedicationStatement',medicationReference:{reference:'Medication/1'},dosage:[{text:'Take one tablet'}]}, {code:{text:'Source medicine'}}),'Source medicine\n\nTake one tablet');
 const source=structuredClone(fixtures[0]),resourceEntry=source.entry.find(entry=>entry.resource.resourceType==='Observation');resourceEntry.resource=resource;
 source.entry[0].resource.section=[{title:'Measurement',entry:[{reference:resourceEntry.fullUrl}]}];
 assert.equal(parsePatientSummary(source).summary.clinicalSections[0].entries[0].content,content);
});
test('narrative preserves paragraphs, list items and table label boundaries without executable markup',()=>{
 assert.equal(narrativeText('<div><p>First paragraph.</p><p>Second paragraph.</p><ul><li>One</li><li>Two<script>unsafe()</script></li></ul></div>'),'First paragraph.\n\nSecond paragraph.\n\n• One\n\n• Two');
 assert.equal(clinicalResourceText({text:{div:'<div><table><tr><th>Medicine</th><td>Source medicine</td></tr><tr><th>Note</th><td>Source note</td></tr></table></div>'}}),'Medicine: Source medicine\nNote: Source note');
});

test('narrative-free clinical summaries retain status, absence and false values',()=>{
 assert.equal(clinicalResourceText({resourceType:'Condition',code:{text:'Prior diagnosis'},clinicalStatus:{coding:[{code:'resolved'}]},verificationStatus:{coding:[{code:'confirmed',display:'Confirmed by source'}]}}),'Prior diagnosis\n\nresolved\n\nConfirmed by source');
 assert.equal(clinicalResourceText({resourceType:'AllergyIntolerance',code:{text:'Penicillin allergy'},verificationStatus:{coding:[{code:'refuted'}]}}),'Penicillin allergy\n\nrefuted');
 const observation={resourceType:'Observation',code:{text:'Clinical finding present'},status:'cancelled',valueBoolean:false,component:[{code:{text:'Second finding present'},valueBoolean:false},{code:{text:'Unavailable measurement'},dataAbsentReason:{coding:[{code:'not-performed'}]}}]};
 const content=clinicalResourceText(observation);assert.match(content,/Clinical finding present\n\nfalse/);assert.match(content,/cancelled/);assert.match(content,/Second finding present: false/);assert.match(content,/Unavailable measurement: not-performed/);
 assert.equal(clinicalResourceText({resourceType:'Observation',code:{text:'Measurement'},dataAbsentReason:{text:'Not measured'},interpretation:[{coding:[{code:'L',display:'Low'}]}]}),'Measurement\n\nNot measured\n\nLow');
 assert.equal(clinicalResourceText({text:{div:'<p>Source narrative remains authoritative.</p>'},status:'cancelled'}),'Source narrative remains authoritative.');
});

test('vaccine rows link by their vaccine concept without duplicate source entries or positional guesses',()=>{
 const source=structuredClone(fixtures[2]);
 const vaccines=source.entry.filter(entry=>entry.resource.resourceType==='Immunization');
 const section=()=>parsePatientSummary(source).summary.clinicalSections.find(section=>section.title==='Vaccinationer');
 assert.equal(section().tables[0].rows.length,6);
 assert.deepEqual(new Set(section().tables[0].rows.map(row=>row.identity)),new Set(vaccines.map(entry=>entry.fullUrl)));
 assert.equal(section().entries[0].label,vaccines[0].resource.vaccineCode.text);
 const compositionSection=source.entry[0].resource.section.find(section=>section.title==='Vaccinationer');
 compositionSection.entry.reverse();
 assert.equal(section().tables[0].rows[0].identity,vaccines[0].fullUrl,'reordering references does not reassign a vaccine');
 vaccines[1].resource.vaccineCode=structuredClone(vaccines[0].resource.vaccineCode);
 vaccines[1].resource.occurrenceDateTime=vaccines[0].resource.occurrenceDateTime;
 assert.equal(section().tables[0].rows[0].identity,undefined,'ambiguous vaccine names remain unlinked');
 assert.ok(clinicalResourceText({resourceType:'Immunization',vaccineCode:{text:'Example vaccine'},occurrenceDateTime:'2026-01-02',status:'completed'}).includes('Example vaccine'));
});

test('narrative associations use normalized explicit identity and unique clinical facts, never elimination',()=>{
 const bundle=structuredClone(fixtures[2]);
 let summary=parsePatientSummary(bundle).summary;
 const device=summary.clinicalSections.find(s=>s.title==='Medicintekniska produkter');assert.equal(device.tables[0].rows[0].identity,device.entries[0].identity);
 const procedure=summary.clinicalSections.find(s=>s.entries?.some(e=>e.label==='Narkos'));
 const anesthesia=procedure.tables.flatMap(t=>t.rows).filter(row=>row.cells[0]==='Narkos');assert.equal(anesthesia.length,2);assert.ok(anesthesia.every(row=>row.identity));assert.notEqual(anesthesia[0].identity,anesthesia[1].identity);
 const medications=summary.clinicalSections.find(s=>s.title==='Läkemedelslista');assert.equal(medications.tables[0].rows[0].identity,undefined,'schedule and administered dose both have matching dates');
 const composition=bundle.entry[0].resource,conditions=bundle.entry.filter(e=>e.resource.resourceType==='Condition').slice(0,2);
 conditions.forEach(e=>{e.resource.code={text:'Same label'};delete e.resource.text;});
 composition.section=[{title:'Repeated',entry:conditions.map(e=>({reference:e.fullUrl})),text:{div:'<table><tr><th>Item</th><th>Date</th></tr><tr><td> SAME   LABEL </td><td>2000-01-01</td></tr><tr><td>Same label</td><td></td></tr></table>'}}];
 conditions[0].resource.effectiveDateTime='2000-01-01';conditions[1].resource.effectiveDateTime='2001-01-01';
 const rows=parsePatientSummary(bundle).summary.clinicalSections[0].tables[0].rows;assert.equal(rows[0].identity,conditions[0].fullUrl);assert.equal(rows[1].identity,undefined);
});
test('document source URL association is exact, unique and inert',()=>{
 const bundle=structuredClone(fixtures[0]),doc={fullUrl:'urn:doc:1',resource:{resourceType:'DocumentReference',id:'doc',description:'Different title',content:[{attachment:{url:'https://example.invalid/document'}}]}};
 bundle.entry.push(doc);bundle.entry[0].resource.section=[{title:'Documents',entry:[{reference:doc.fullUrl}],text:{div:'<table><tr><th>Name</th><th>URL</th></tr><tr><td>Other name</td><td>https://example.invalid/document</td></tr><tr><td>Unrelated</td><td>https://example.invalid/document/other</td></tr></table>'}}];
 let rows=parsePatientSummary(bundle).summary.clinicalSections[0].tables[0].rows;assert.equal(rows[0].identity,doc.fullUrl);assert.equal(rows[1].identity,undefined);
 const duplicate=structuredClone(doc);duplicate.fullUrl='urn:doc:2';duplicate.resource.id='doc2';bundle.entry.push(duplicate);bundle.entry[0].resource.section[0].entry.push({reference:duplicate.fullUrl});
 rows=parsePatientSummary(bundle).summary.clinicalSections[0].tables[0].rows;assert.ok(rows.every(row=>!row.identity));
});
test('only explicitly labeled primary clinical narrative cells can provide aliases',()=>{
 const bundle=structuredClone(fixtures[0]),entry=bundle.entry.find(e=>e.resource.resourceType==='Condition');
 entry.resource.code={text:'Formal source diagnosis'};
 bundle.entry[0].resource.section=[{title:'Problem',entry:[{reference:entry.fullUrl}],text:{div:'<table><tr><th>Problem</th></tr><tr><td>Patient-facing diagnosis</td></tr></table>'}}];
 const identity=()=>parsePatientSummary(bundle).summary.clinicalSections[0].tables[0].rows[0].identity;
 entry.resource.text={div:'<table><tr><th>Condition</th><td>Patient-facing diagnosis</td></tr></table>'};assert.equal(identity(),entry.fullUrl);
 entry.resource.text={div:'<table><tr><th>Note</th><td>Patient-facing diagnosis</td></tr></table>'};assert.equal(identity(),undefined);
});

test('source URLs cannot override a conflicting clinical label and aliases use the actual first row',()=>{
 const bundle=structuredClone(fixtures[0]),condition=bundle.entry.find(e=>e.resource.resourceType==='Condition');
 condition.resource.code={text:'Clinical diagnosis'};delete condition.resource.text;
 const doc={fullUrl:'urn:doc:conflict',resource:{resourceType:'DocumentReference',id:'conflict',content:[{attachment:{url:'https://example.invalid/source'}}]}};bundle.entry.push(doc);
 const section={title:'Findings',entry:[{reference:condition.fullUrl},{reference:doc.fullUrl}],text:{div:'<table><tr><th>Item</th><th>Source</th></tr><tr><td>Clinical diagnosis</td><td>https://example.invalid/source</td></tr></table>'}};bundle.entry[0].resource.section=[section];
 assert.equal(parsePatientSummary(bundle).summary.clinicalSections[0].tables[0].rows[0].identity,undefined);
 section.entry=[{reference:condition.fullUrl}];section.text.div='<table><tr><th>Item</th></tr><tr><td>Alternative diagnosis</td></tr></table>';
 for(const first of ['<td>Unlabeled first row</td>','<th>Note</th><td>First note</td>']){
  condition.resource.text={div:`<table><tr>${first}</tr><tr><th>Condition</th><td>Alternative diagnosis</td></tr></table>`};
  assert.equal(parsePatientSummary(bundle).summary.clinicalSections[0].tables[0].rows[0].identity,undefined);
 }
});
