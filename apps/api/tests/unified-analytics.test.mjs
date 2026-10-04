import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateAnalytics, analyticsBuckets, countAnalyticsRecords, validateAnalytics } from '../dist/review/analytics-engine.js';
import { recordsElement, standardElements, userElement } from '../dist/review/analytics-catalog.js';
import { unifiedAnalyticsCsv } from '../dist/review/analytics-csv.js';
const numeric = standardElements.find(field => field.id === 'eVitals.06');
const category = standardElements.find(field => field.id === 'eMedications.03');
const definition = overrides => ({ version: 1, metric: 'records', aggregation: 'count', visualization: 'line', from: '2026-03-28', through: '2026-03-30', groupBy: null, timeGrouping: 'day', filters: [], ...overrides });
const occurrence = (element, value, overrides={}) => ({ id: String(Math.random()), element, value: value === null ? null : { type: typeof value === 'number' ? 'number' : 'code', value },
  state: value === null ? 'absent' : 'valid', label: value === null ? null : String(value), unit: element === numeric.id ? 'mm[Hg]' : null,
  groupId: null, path: [], ordinal: 0, groupOrdinal: 0, clinicalTime: null, ...overrides });
const report = (id, values, date='2026-03-28') => ({id,date,revision:'1',values});

test('datatype validation rejects fabricated aggregation, duplicate filters, invalid dates and wrong units', () => {
  const fields = [recordsElement,numeric,category];
  assert.throws(() => validateAnalytics(definition({metric:category.id,aggregation:'mean'}),fields), /aggregation/);
  assert.throws(() => validateAnalytics(definition({metric:numeric.id,aggregation:'mean'}),fields), /per-report/);
  assert.throws(() => validateAnalytics(definition({metric:numeric.id,aggregation:'mean',reducer:'first',unit:'kg'}),fields), /unit/);
  assert.throws(() => validateAnalytics(definition({from:'2026-02-30'}),fields), /dates/);
  assert.throws(() => validateAnalytics(definition({filters:[{element:category.id,values:[{type:'number',value:123}]}]}),fields), /datatype/);
  const filter={element:category.id,values:[{type:'code',value:'123'}]};
  assert.throws(() => validateAnalytics(definition({filters:[filter,filter]}),fields), /distinct filter/);
  assert.throws(() => validateAnalytics(definition({through:'2027-03-29'}),fields), /366 days/);
});

test('oversized visualizations fail explicitly instead of dropping series or cells', () => {
  const reports=Array.from({length:101},(_,index)=>report(String(index),[occurrence(category.id,String(index))]));
  assert.throws(()=>aggregateAnalytics(reports,definition({groupBy:category.id}),recordsElement),/100-series/);
  assert.throws(()=>aggregateAnalytics(reports.slice(0,100),definition({groupBy:category.id,through:'2027-03-28'}),recordsElement),/20,000-cell/);
});

test('discrete percentages deduplicate per report and exclude missing, absent, invalid denominators', () => {
  const reports = [report('a',[occurrence(category.id,'A'),occurrence(category.id,'A'),occurrence(category.id,'B')]),
    report('b',[occurrence(category.id,'B')]),report('c',[]),report('d',[occurrence(category.id,null)]),
    report('e',[occurrence(category.id,null,{state:'invalid'})])];
  const result=aggregateAnalytics(reports,definition({metric:category.id,aggregation:'percentage'}),category);
  assert.deepEqual(result.completeness,{total:5,valid:2,missing:1,absent:1,invalid:1});
  const a=result.series.find(series=>series.category.value==='A');
  const cell=result.cells.find(cell=>cell.series===a.id && cell.bucket==='2026-03-28');
  assert.deepEqual([cell.count,cell.numerator,cell.denominator,cell.value],[1,1,2,50]);
  assert.equal(result.cells.find(cell=>cell.series===a.id && cell.bucket==='2026-03-29').value,null);
  assert.equal(result.overlapping,true);
  assert.equal(result.contributions.length,5);
});

test('record shares use the bucket population; count zero differs from unavailable percentage', () => {
  const reports=[report('a',[occurrence(category.id,'A'),occurrence(category.id,'B')]),report('b',[occurrence(category.id,'B')])];
  const result=aggregateAnalytics(reports,definition({aggregation:'percentage',groupBy:category.id}),recordsElement);
  assert.deepEqual(result.cells.filter(cell=>cell.bucket==='2026-03-28').map(cell=>[cell.count,cell.denominator,cell.value]),[[1,2,50],[2,2,100]]);
  const counts=aggregateAnalytics([],definition(),recordsElement);
  assert.equal(counts.cells.length,3); assert.ok(counts.cells.every(cell=>cell.value===0));
  assert.ok(aggregateAnalytics([],definition({aggregation:'percentage'}),recordsElement).cells.every(cell=>cell.value===null));
});

test('user grouping and multiselect filters retain distinct identities, metric eligibility and clinical filters', () => {
  const user = id => occurrence(userElement.id, id, { label: 'Same name' });
  const reports = [report('a', [user('first'), occurrence(numeric.id, 10), occurrence(category.id, 'A')]),
    report('b', [user('second'), occurrence(numeric.id, 20), occurrence(category.id, 'A')]),
    report('c', [user('first'), occurrence(category.id, 'A')]),
    report('d', [user('third'), occurrence(numeric.id, 90), occurrence(category.id, 'B')])];
  const query = validateAnalytics(definition({ metric: numeric.id, aggregation: 'mean', reducer: 'first', visualization: 'table',
    groupBy: userElement.id, filters: [{ element: userElement.id, values: ['first', 'second'].map(value => ({ type: 'code', value })) },
      { element: category.id, values: [{ type: 'code', value: 'A' }] }] }), [numeric, category, userElement]);
  const result = aggregateAnalytics(reports, query, numeric);
  assert.equal(result.summary, 15);
  assert.deepEqual(result.series.map(series => [series.group.value, series.groupLabel]), [['first', 'Same name'], ['second', 'Same name']]);
  assert.deepEqual(result.cells.map(cell => cell.value), [10, 20]);
  assert.deepEqual(countAnalyticsRecords(reports, query, numeric, userElement.id), { total: 3, included: 2 });
  assert.deepEqual(countAnalyticsRecords(reports, query, numeric, userElement.id, { type: 'code', value: 'first' }), { total: 3, included: 1 });
  assert.throws(() => validateAnalytics(definition({ metric: userElement.id }), [userElement]), /aggregation/);
});

test('numeric overall summaries use one reduced source value per report and preserve gaps', () => {
  const reports=[report('a',[occurrence(numeric.id,10),occurrence(numeric.id,90,{ordinal:1})]),
    report('b',[occurrence(numeric.id,20)]),report('c',[occurrence(numeric.id,120)],'2026-03-30')];
  const result=aggregateAnalytics(reports,definition({metric:numeric.id,aggregation:'mean',reducer:'first'}),numeric);
  assert.equal(result.summary,50); assert.deepEqual(result.cells.map(cell=>cell.value),[15,null,120]);
  const median=aggregateAnalytics(reports,definition({metric:numeric.id,aggregation:'median',reducer:'last',visualization:'table'}),numeric);
  assert.equal(median.summary,90); assert.equal(median.cells.length,1);
});

test('groups without valid categorical metrics retain labels and separate code identities', () => {
  const group = 'eDispatch.05';
  const reports = [report('missing', [occurrence(group, '2305001', { label: 'Critical' })]),
    report('absent', [occurrence(group, '2305003', { label: 'Critical' }), occurrence(category.id, null)]),
    report('unknown', [occurrence(group, 'unknown')]), report('ungrouped', [])];
  const result = aggregateAnalytics(reports, definition({ metric: category.id, groupBy: group, visualization: 'table' }), category);
  assert.deepEqual(result.series.map(series => [series.group?.value ?? null, series.groupLabel]),
    [['2305001', 'Critical'], ['2305003', 'Critical'], ['unknown', 'unknown'], [null, null]]);
  assert.equal(result.cells.length, 4);
  assert.equal(result.completeness.missing, 3);
  assert.equal(result.completeness.absent, 1);
});

test('clinical time determines first/last only when every candidate has it', () => {
  const rows=[occurrence(numeric.id,100,{ordinal:0,clinicalTime:'2026-03-28T12:00:00Z'}),occurrence(numeric.id,80,{ordinal:1,clinicalTime:'2026-03-28T11:00:00Z'})];
  const query=definition({metric:numeric.id,aggregation:'minimum',reducer:'first'});
  assert.equal(aggregateAnalytics([report('a',rows)],query,numeric).summary,80);
  rows[0].clinicalTime=null;
  assert.equal(aggregateAnalytics([report('a',rows)],query,numeric).summary,100);
});

test('multi-value and multi-element filters preserve parent correlation and report-level deduplication', () => {
  const rows=[occurrence(category.id,'A',{groupId:'Medication',path:['a']}),occurrence(category.id,'B',{groupId:'Medication',path:['b']}),
    occurrence(numeric.id,10,{groupId:'Medication',path:['a']}),occurrence(numeric.id,90,{groupId:'Medication',path:['b']})];
  const q=definition({metric:numeric.id,aggregation:'mean',reducer:'first',filters:[{element:category.id,values:[{type:'code',value:'B'},{type:'code',value:'C'}]}]});
  assert.equal(aggregateAnalytics([report('a',rows)],q,numeric).summary,90);
  q.filters.push({element:'other',values:[{type:'code',value:'x'}]});
  assert.equal(aggregateAnalytics([report('a',rows)],q,numeric).completeness.total,0);
});

test('weeks start Monday; partial calendar month and week edges are clipped', () => {
  assert.deepEqual(analyticsBuckets(definition({timeGrouping:'week'})),[
    {key:'2026-03-23',from:'2026-03-28',through:'2026-03-29'}, {key:'2026-03-30',from:'2026-03-30',through:'2026-03-30'}]);
  assert.deepEqual(analyticsBuckets(definition({through:'2026-04-02',timeGrouping:'month'})),[
    {key:'2026-03-01',from:'2026-03-28',through:'2026-03-31'}, {key:'2026-04-01',from:'2026-04-01',through:'2026-04-02'}]);
});

test('unlike dosage units are excluded before per-report reduction', () => {
  const drug={...numeric,id:'eMedications.05',unit:null,units:['mg','mcg']};
  const q=definition({metric:drug.id,aggregation:'mean',reducer:'maximum',unit:'mg'});
  const result=aggregateAnalytics([report('a',[occurrence(drug.id,10,{unit:'mg'}),occurrence(drug.id,1000,{unit:'mcg'})])],q,drug);
  assert.equal(result.summary,10); assert.equal(result.contributions[0].occurrences.length,1);
});

test('included record counts share metric eligibility, filtered totals and correlated values with analysis', () => {
  const metric = { ...numeric, configured: { kind: 'metric' } };
  const rows = [
    report('valid', [occurrence(numeric.id, 10), occurrence(numeric.id, 20), occurrence(category.id, 'A'), occurrence(category.id, 'A')]),
    ...['missing', 'absent', 'invalid', 'failed', 'not-applicable'].map(state => report(state, [
      occurrence(numeric.id, null, { state }), occurrence(category.id, 'A'),
    ])),
    report('filtered-out', [occurrence(numeric.id, 30), occurrence(category.id, 'B')]),
  ];
  const query = definition({ metric: metric.id, aggregation: 'mean', reducer: 'first', groupBy: category.id,
    filters: [{ element: category.id, values: [{ type: 'code', value: 'A' }] }] });
  const aggregate = aggregateAnalytics(rows, query, metric);
  assert.deepEqual(countAnalyticsRecords(rows, query, metric), { total: 6, included: 1 });
  assert.equal(aggregate.completeness.valid, 1);
  assert.equal(aggregate.completeness.total, 6);
  assert.deepEqual(countAnalyticsRecords(rows, { ...query, metric: 'records', aggregation: 'count', reducer: undefined }, recordsElement), { total: 6, included: 6 });
  assert.deepEqual(countAnalyticsRecords(rows, query, metric, category.id, { type: 'code', value: 'A' }), { total: 6, included: 1 });
  assert.deepEqual(countAnalyticsRecords(rows, query, metric, category.id, { type: 'code', value: 'B' }), { total: 6, included: 0 });
  assert.deepEqual(countAnalyticsRecords([], query, metric), { total: 0, included: 0 });
  const correlated = [report('one', [occurrence(numeric.id, 10, { groupId: 'Medication', path: ['a'] }),
    occurrence(category.id, 'A', { groupId: 'Medication', path: ['a'] }), occurrence(category.id, 'B', { groupId: 'Medication', path: ['b'] })])];
  assert.deepEqual(countAnalyticsRecords(correlated, { ...query, filters: [] }, metric, category.id, { type: 'code', value: 'B' }), { total: 1, included: 0 });
});

test('rule included counts use the denominator, irrespective of selected pass/fail or overlapping groups', () => {
  const metric = { ...category, id: 'rule', datatype: 'boolean', configured: { kind: 'rule' } };
  const ruleValue = value => ({ ...occurrence(metric.id, value), value: { type: 'boolean', value } });
  const rows = [report('pass', [ruleValue(true), occurrence(category.id, 'A'), occurrence(category.id, 'B')]),
    report('fail', [ruleValue(false), occurrence(category.id, 'A')]), report('excluded', [occurrence(metric.id, null, { state: 'not-applicable' })])];
  for (const outcome of ['pass', 'fail']) {
    const query = definition({ metric: metric.id, aggregation: 'percentage', outcome, groupBy: category.id });
    assert.deepEqual(countAnalyticsRecords(rows, query, metric), { total: 3, included: 2 });
    assert.equal(aggregateAnalytics(rows, query, metric).summary, 50);
  }
});

test('CSV preserves every cell, source row, missingness, percentage context and formula safety', () => {
  const def=definition({metric:category.id,aggregation:'percentage',visualization:'table'});
  const {contributions,...aggregate}=aggregateAnalytics([report('a',[occurrence(category.id,'=1+1')]),report('b',[])],def,category);
  const result={...aggregate,definition:def,metric:category,group:null,filters:[],population:{unit:'patient-report',scope:'all',organizationId:'org',dataset:'real',signedOnly:true},
    timeZone:'Europe/Stockholm',interval:{start:'2026-03-27T23:00:00Z',endExclusive:'2026-03-30T22:00:00Z'},freshness:{status:'current',observedAt:'2026-04-01T12:00:00Z'},unit:'%',exportRevision:'r'};
  const csv=unifiedAnalyticsCsv(result,contributions,'aggregate'); assert.match(csv,/"'=1\+1"/); assert.match(csv,/"numerator","denominator"/);
  const records=unifiedAnalyticsCsv(result,contributions,'records'); assert.equal(records.split('\r\n').filter(row=>row.startsWith('"a",')).length,1);
  assert.match(records,/"b","2026-03-28".*"missing"/);
});
