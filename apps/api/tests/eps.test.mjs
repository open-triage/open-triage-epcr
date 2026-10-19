import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {parsePatientSummary,narrativeText} from '@open-triage/contracts';
import {EpsAdapter} from '../dist/hospital/eps-adapter.js';
const fixtures=await Promise.all(['andrea','arne'].map(name=>readFile(new URL(`./fixtures/hospital/${name}.json`,import.meta.url),'utf8').then(JSON.parse)));
const configuration={field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]};
const listing=(name,value)=>({resourceType:'Parameters',parameter:[{name:'entry',part:[{name,valueString:value}]}]});
test('complete EPS projections preserve both fictional patients, all resources and all source leaves',()=>{
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
 assert.equal(narrativeText('<div>One &amp; two<br/><img src="https://bad" onerror="bad()">Three<script>bad()</script></div>'),'One & two\n Three');
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
 for(const fixture of fixtures){const remote=parsePatientSummary(fixture).identifiers[0];const configured={...configuration,namespace:'urn:local',aliases:[remote.system]};
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
