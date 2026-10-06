import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileMetric, compileMetricLibrary, compileValidationRule, evaluateMetric, evaluateValidationBundle,
  evaluateValidationBundleSafely, evaluateValidationOutcomes, compiledValidationBundleSha256,
  readValidationDefinition, serializeValidationDefinition } from '@open-triage/contracts';
import { canonicalValidationCatalog } from '../../../packages/database/tests/helpers/canonical-validation-catalog.mjs';
import { aggregateAnalytics, validateAnalytics } from '../dist/review/analytics-engine.js';
import { makePackage, parsePackage } from '../dist/admin/canonical-package.js';
import { clinicalFormConfiguration } from '../dist/forms/clinical-form-configuration.js';
import { configuredAnalyticsLibrary, contributeConfiguredDefinition } from '../dist/review/analytics-definitions.js';
import { AnalyticsService } from '../dist/review/analytics.service.js';

const fullValidation = JSON.parse(await readFile(new URL('../../../defines/validation/validation_nemsis-full.json', import.meta.url), 'utf8'));
const emsDefinitions = {
  schemaVersion: fullValidation.schemaVersion, metrics: fullValidation.metrics,
  rules: fullValidation.rules.filter(rule => rule.provenance?.some(source => source.standard === 'EMS Performance Measures')),
};

const context = { timestamp: '2026-10-04T00:00:00Z' };
const catalog = { elements: [
  { elementId: 'start', label: 'PSAP contact', baseDatatype: 'dateTime' },
  { elementId: 'time', label: 'Observation time', baseDatatype: 'dateTime', groupPath: ['observations'] },
  { elementId: 'score', label: 'Score', baseDatatype: 'decimal', groupPath: ['observations', 'scores'] },
  { elementId: 'code', label: 'Code', baseDatatype: 'string', groupPath: ['observations'] },
  { elementId: 'eligible', label: 'Eligible', baseDatatype: 'boolean' },
  { elementId: 'unrelated', label: 'Unrelated', baseDatatype: 'string' },
], groups: [{ groupId: 'observations', label: 'Observations', repeating: true, intrinsicOccurrence: { min: 0, max: 'unbounded' } }],
  codes: [{ elementId: 'code', codeSystem: 'test', code: 'shock', label: 'Defibrillation' }] };
const scalar = (id, value) => ({ id, values: [{ occurrenceId: id, kind: 'scalar', value }] });
const row = (id, time, score, shock = true) => ({ instanceId: id, elements: [scalar('time', time), scalar('score', score),
  { id: 'code', values: [{ occurrenceId: `code-${id}`, kind: 'coded', code: shock ? 'shock' : 'other', system: 'test' }] }] });
const document = (rows = []) => ({ groups: [
  { id: 'root', instances: [{ instanceId: 'root', elements: [scalar('start', '2026-10-04T00:00:00Z'), scalar('eligible', true), scalar('unrelated', 'hello')] }] },
  { id: 'observations', instances: rows },
] });
const selected = (operator, elementId = 'score', unit = 'score') => ({ operator, groupId: 'observations', elementId, timeElementId: 'time', unit,
  where: 'coded("code", "test", "shock")' });
const interval = { operator: 'elapsed', start: { operator: 'timestamp', elementId: 'start' }, end: selected('first', 'time', 'timestamp'), unit: 's' };
const source = (expression = interval, extra = {}) => ({ id: 'metric', name: 'Metric', description: 'Test', enabled: true, reviewEnabled: true,
  unit: 's', source: JSON.stringify(expression), ...extra });
const compile = (expression, extra) => {
  const result = compileMetric(source(expression, extra), 'version', catalog);
  assert.ok(result.compiled, JSON.stringify(result.diagnostics)); return result.compiled;
};
const rule = (text = 'require metricCompare("metric", "less-or-equal", 90, "s")', extra = {}) => ({ id: 'rule', name: 'Interval limit', message: 'Review interval',
  enabled: true, severity: 'warning', reviewPriority: 'high', executionTargets: ['live', 'sign', 'review'], primaryTargetElementId: 'start', source: text, ...extra });
const bundle = (metric = compile(interval), authored = rule()) => {
  const result = compileValidationRule(authored, 'version', catalog, [metric]);
  assert.ok(result.compiled, JSON.stringify(result.diagnostics));
  return { schemaVersion: 2, languageVersion: '2.0.0', validationVersionId: 'version', catalogReleaseId: 'catalog', metrics: [metric], rules: [result.compiled] };
};

test('first/last use correlated clinical timestamps and stable tie identities, not array order', () => {
  const input = document([row('z', '2026-10-04T00:03:00Z', 4), row('b', '2026-10-04T00:02:00Z', 8), row('a', '2026-10-04T00:02:00Z', 7), row('other', '2026-10-04T00:00:01Z', 1, false)]);
  assert.equal(evaluateMetric(compile(interval), input, context).value, 120);
  const difference = compile({ operator: 'difference', left: selected('last'), right: selected('first') }, { unit: 'score' });
  assert.equal(evaluateMetric(difference, input, context).value, -3);
  input.groups[1].instances.reverse();
  assert.equal(evaluateMetric(difference, input, context).value, -3);
});

test('ancestry keeps nested values attached and rejects ambiguous values and missing clinical times', () => {
  const input = document([row('a', '2026-10-04T00:01:00Z', 8), row('b', '2026-10-04T00:02:00Z', 3)]);
  input.groups.push({ id: 'scores', instances: input.groups[1].instances.map((instance) => {
    const score = instance.elements.splice(1, 1)[0]; return { instanceId: `child-${instance.instanceId}`, parentInstanceId: instance.instanceId, elements: [score] };
  }) });
  assert.equal(evaluateMetric(compile({ operator: 'difference', left: selected('last'), right: selected('first') }, { unit: 'score' }), input, context).value, -5);
  input.groups[1].instances[1].elements.shift();
  assert.equal(evaluateMetric(compile(interval), input, context).state, 'missing');
  const ambiguous = document([row('a', '2026-10-04T00:01:00Z', 1)]);
  ambiguous.groups[1].instances[0].elements[0].values.push({ occurrenceId: 'second', kind: 'scalar', value: '2026-10-04T00:02:00Z' });
  assert.equal(evaluateMetric(compile(interval), ambiguous, context).state, 'invalid');
});

test('missing, recorded absence, invalid negative duration, applicability and bounded evaluation remain distinct', () => {
  const metric = compile(interval);
  assert.equal(evaluateMetric(metric, document(), context).state, 'missing');
  const absent = document([row('a', '2026-10-04T00:01:00Z', 1)]);
  absent.groups[0].instances[0].elements[0].values = [{ occurrenceId: 'start', kind: 'null', notValue: { code: 'unknown' } }];
  assert.equal(evaluateMetric(metric, absent, context).state, 'absent');
  assert.equal(evaluateMetric(metric, document([row('a', '2026-10-03T23:59:00Z', 1)]), context).state, 'invalid');
  assert.equal(evaluateMetric(metric, document([row('a', '2026-02-30T00:01:00Z', 1)]), context).state, 'invalid');
  assert.equal(evaluateMetric(compile(interval, { applicability: 'never()' }), document(), context).state, 'not-applicable');
  assert.equal(evaluateMetric(metric, document(), { ...context, limits: { maxTraversalSteps: 1 } }).state, 'failed');
});

test('compiler rejects Boolean metrics, unsupported operations, unit mismatches and broken dependencies', () => {
  for (const expression of [true, { operator: 'mean', elementId: 'score' }, { operator: 'metric', id: 'other' },
    { operator: 'difference', left: { operator: 'value', elementId: 'score', unit: 'score' }, right: { operator: 'value', elementId: 'score', unit: 'kg' } }])
    assert.equal(compileMetric(source(expression), 'version', catalog).compiled, undefined);
  const metric = compile(interval);
  for (const candidates of [[], [{ ...metric, enabled: false }], [{ ...metric, validationVersionId: 'another-version' }]])
    assert.equal(compileValidationRule(rule(), 'version', catalog, candidates).compiled, undefined);
  assert.equal(compileValidationRule(rule('require metricCompare("metric", "equal", 1, "min")'), 'version', catalog, [metric]).compiled, undefined);
  assert.equal(compileMetric(source({ operator: 'value', elementId: 'eligible', unit: 's' }), 'version', catalog).compiled, undefined);
  assert.equal(compileMetric(source({ operator: 'value', elementId: 'score', unit: 's' }), 'version', {
    ...catalog, codes: [...catalog.codes, { elementId: 'score', codeSystem: 'test', code: '1', label: 'Category one' }],
  }).compiled, undefined);
  assert.deepEqual(compileValidationRule(rule(), 'version', catalog, [metric]).compiled.references.elementIds, ['code', 'start', 'time']);
  const disabled = compileMetricLibrary([source({ operator: 'unsupported' }, { enabled: false })], 'version', catalog);
  assert.ok(disabled.diagnostics.every((diagnostic) => diagnostic.severity === 'warning'));
});

test('metric rules are shared across live/sign/review; unavailable comparisons fail closed and guards remain explicit', () => {
  const version = bundle(), input = document([row('a', '2026-10-04T00:02:00Z', 1)]);
  for (const target of ['live','sign','review']) assert.equal(evaluateValidationBundle(version, input, target, context)[0].metricEvidence[0].value, 120);
  assert.equal(evaluateValidationBundleSafely(version, document(), 'sign', context).failures.length, 1);
  const guarded = bundle(compile(interval), rule('when metricAvailable("metric")\nrequire metricCompare("metric", "less-or-equal", 90, "s")'));
  assert.equal(evaluateValidationBundleSafely(guarded, document(), 'sign', context).failures.length, 0);
  const excluded = evaluateValidationOutcomes(guarded, document(), 'review', context).outcomes[0];
  assert.equal(excluded.state, 'not-applicable');
  assert.equal(excluded.metricEvidence[0].state, 'missing');
  const required = bundle(compile(interval), rule('require metricAvailable("metric")'));
  assert.equal(evaluateValidationOutcomes(required, document(), 'review', context).outcomes[0].value, false);
});

test('acknowledgements follow metric evidence and version, retaining identity on unrelated changes', () => {
  const version = bundle(), input = document([row('a', '2026-10-04T00:02:00Z', 1)]);
  const fingerprint = () => evaluateValidationBundle(version, input, 'sign', context)[0].inputFingerprint;
  const before = fingerprint(); input.groups[0].instances[0].elements[2].values[0].value = 'unrelated edit'; assert.equal(fingerprint(), before);
  input.groups[1].instances[0].elements[0].values[0].value = '2026-10-04T00:03:00Z'; assert.notEqual(fingerprint(), before);
  const hash = compiledValidationBundleSha256(version); version.metrics[0].description = 'changed'; assert.notEqual(compiledValidationBundleSha256(version), hash);
});

test('outcomes retain priority/severity None and reduce occurrence rules once per report', () => {
  const metric = compile(interval);
  const version = bundle(metric, rule(undefined, { severity: 'none', reviewPriority: 'none' }));
  const input = document([row('a','2026-10-04T00:02:00Z',5)]);
  assert.equal(evaluateValidationBundle(version,input,'review',context).length,0);
  assert.equal(evaluateValidationOutcomes(version,input,'review',context).outcomes[0].value,false);
  const compiled = compileValidationRule(rule('for each("observations")\nrequire compareValue("score", "less-than", 5)'), 'version', catalog);
  assert.ok(compiled.compiled,JSON.stringify(compiled.diagnostics));
  version.rules = [compiled.compiled];
  const reduced = evaluateValidationOutcomes(version, document([row('a','2026-10-04T00:01:00Z',3),row('b','2026-10-04T00:02:00Z',7)]),'review',context).outcomes;
  assert.equal(reduced.length,1); assert.equal(reduced[0].value,false); assert.equal(reduced[0].occurrences.length,2);
});

const field = { id: 'metric', label: 'Metric', datatype: 'number', kind: 'numeric', units: ['s'], unit: 's', aggregations: ['mean','median','minimum','maximum','p90'],
  configured: { kind: 'metric', id: 'id', validationVersionId: 'version', version: 1, catalogReleaseId:'catalog' }, grouping:false, filtering:false, operations:[] };
const query = { version:1,metric:'metric',aggregation:'p90',visualization:'table',from:'2026-10-04',through:'2026-10-04',groupBy:null,timeGrouping:'day',filters:[] };
const report = (id,value,state='valid') => ({ id,date:'2026-10-04',revision:'1',values:[{id,element:'metric',value:value===null?null:{type:typeof value==='boolean'?'boolean':'number',value},state,unit:'s',path:[],groupId:null,ordinal:0,groupOrdinal:0,clinicalTime:null,label:String(value)}] });
test('nearest-rank p90 and Boolean denominators aggregate only valid report contributions', () => {
  assert.equal(aggregateAnalytics([1,2,3,4,5,6,7,8,9,100].map((n)=>report(String(n),n)),query,field).summary,9);
  assert.equal(aggregateAnalytics([report('one',3)],query,field).summary,3);
  const boolean = {...field,kind:'categorical',datatype:'boolean',unit:null,units:[],aggregations:['count','percentage'],configured:{...field.configured,kind:'rule'}};
  const selection = {...query,aggregation:'percentage',outcome:'fail'};
  const result = aggregateAnalytics([report('pass',true),report('fail',false),report('missing',null,'missing'),report('excluded',null,'not-applicable'),report('bad',null,'failed')],selection,boolean);
  assert.equal(result.summary,50); assert.equal(result.cells[0].numerator,1); assert.equal(result.cells[0].denominator,2);
  assert.equal(result.completeness.notApplicable,1); assert.equal(result.completeness.failed,1);
  assert.equal(aggregateAnalytics([report('missing',null,'missing')],selection,boolean).summary,null);
  assert.equal(aggregateAnalytics([report('pass',true)],selection,boolean).cells[0].value,0);
  assert.throws(()=>validateAnalytics({...selection,aggregation:'mean'},[boolean]));
  assert.throws(()=>validateAnalytics({...selection,outcome:undefined},[boolean]));
});

test('shared canonical formats preserve mapped definitions and only unresolved rules stay disabled', () => {
  const definitions = structuredClone(emsDefinitions);
  assert.equal(definitions.metrics.length,6); assert.equal(definitions.rules.length,6);
  assert.ok([...definitions.metrics,...definitions.rules].every(item => item.enabled === !item.unresolved?.length && item.provenance.length));
  assert.ok(definitions.metrics.every(metric => metric.enabled && !metric.applicability));
  assert.deepEqual(definitions.rules.filter(rule => !rule.enabled).map(rule => rule.name), ['Trauma-center destination', 'Aspirin administered']);
  assert.deepEqual(definitions.rules.filter(rule => rule.name.startsWith('Pain ')).map(rule => rule.name), ['Pain reduced', 'Pain intervention']);
  const canonical = makePackage({kind:'validation',name:'Shared library',version:'1',catalog:{sha256:'a'.repeat(64)},definition:definitions});
  assert.equal(canonical.schemaVersion,2);
  assert.deepEqual(readValidationDefinition(parsePackage(JSON.parse(JSON.stringify(canonical)),'validation').definition),definitions);
  assert.deepEqual(readValidationDefinition([rule()]).metrics,[]);
  assert.deepEqual(serializeValidationDefinition([rule()],[]),[rule()]);
  assert.throws(()=>readValidationDefinition({...definitions,schemaVersion:3}));
});

test('offline clinical bundles retain metric dependencies even when they are not exposed for Review', async () => {
  const version = bundle(compile(interval, { reviewEnabled: false }));
  const sha = compiledValidationBundleSha256(version);
  const manager = { query: async (sql) => {
    if (sql.includes('from forms.form_version')) return [{ canonical_definition: { schemaVersion: 1, sections: [] } }];
    if (sql.includes('from validation.version')) return [{ compiled_bundle: version, compiled_sha256: sha }];
    if (sql.includes('from catalog.group_definition') || sql.includes('customGroupDefinitions')
      || sql.includes('from catalog.element_definition') || sql.includes('from catalog.value_set_element')) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const configuration = await clinicalFormConfiguration(manager, 'form', 'catalog', 'version', sha);
  assert.equal(configuration.validation.bundle.metrics[0].id, 'metric');
  assert.equal(evaluateValidationBundle(configuration.validation.bundle, document([row('a', '2026-10-04T00:02:00Z', 5)]), 'live', context)[0].metricEvidence[0].value, 120);
});

test('configuration discovery includes deduplicated authored identities and hides identifying dependencies', async () => {
  const version = bundle();
  const sourceRule = rule();
  const database = { query: async sql => sql.includes('from app_identity.active_configuration_bundle') ? [{
    id: 'version', version: 1, catalog_release_id:'catalog', compiled_bundle:version, compiled_sha256:compiledValidationBundleSha256(version),
    source_rule: { schemaVersion:2,metrics:[source()],rules:[sourceRule,{...sourceRule,id:'alias',name:'Second policy identity'}] },
  }] : [{element_id:'start'}] };
  const visible = await configuredAnalyticsLibrary(database,{organizationId:'org',identifying:true});
  assert.deepEqual(visible.elements.map(element=>element.configured.id),['metric','rule','alias']);
  const restricted = await configuredAnalyticsLibrary(database,{organizationId:'org',identifying:false});
  assert.equal(restricted.elements.length,0);
});

test('metric selector offers Records and only enabled Review definitions before search and pagination', async () => {
  const version = bundle();
  const metric = version.metrics[0], compiledRule = version.rules[0];
  version.metrics.push({ ...metric, id: 'disabled-metric', enabled: false },
    { ...metric, id: 'clinical-metric', reviewEnabled: false });
  version.rules.push({ ...compiledRule, ruleId: 'disabled-rule', enabled: false },
    { ...compiledRule, ruleId: 'clinical-rule', executionTargets: ['live', 'sign'] },
    { ...compiledRule, ruleId: 'no-findings', name: 'No workflow findings', severity: 'none', reviewPriority: 'none' });
  let active = true, catalogReads = 0;
  const manager = { query: async sql => {
    if (sql.includes('from app_identity.active_configuration_bundle')) return active ? [{
      id: 'version', version: 1, catalog_release_id: 'catalog', compiled_bundle: version,
      compiled_sha256: compiledValidationBundleSha256(version),
    }] : [];
    catalogReads++;
    if (sql.includes('from typed group by element')) return [
      { element: 'eVitals.06', count: '3', units: [] },
      { element: 'custom:assessment', label: 'Custom assessment', datatype: 'coded', definition: {}, count: '2', units: [], repeating: false, oversized: false },
    ];
    if (sql.includes('from analytics.review_operational_time_source')) return [{ response: '3', scene: '0', transport: '0' }];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const session = { organization: { id: 'org' }, user: { id: 'reviewer' }, capabilities: ['review:all', 'review:identifying'] };
  const service = new AnalyticsService({ transaction: async (_isolation, callback) => callback(manager) }, { get: async () => session }, {});
  const available = await service.elements('test', '', '1', 'metric');
  assert.deepEqual(available.items.map(item => item.id), ['records', 'metric:version:metric', 'rule:version:rule', 'rule:version:no-findings']);
  assert.equal(available.total, 4);
  assert.equal(catalogReads, 0, 'metric discovery does not depend on recorded observations');
  assert.equal((await service.elements('test', 'disabled', '1', 'metric')).total, 0);
  assert.equal((await service.elements('test', 'clinical', '1', 'metric')).total, 0);
  assert.deepEqual((await service.elements('test', 'RECORDS', '1', 'metric')).items.map(item => item.id), ['records']);
  for (const purpose of ['group', 'filter']) {
    assert.deepEqual((await service.elements('test', '', '1', purpose)).items.map(item => item.id).sort(), ['custom:assessment', 'eVitals.06']);
  }
  for (let index = 0; index < 55; index++) version.rules.push({ ...compiledRule, ruleId: `page-${index}`, name: `Page rule ${index}` });
  const secondPage = await service.elements('test', 'Page rule', '2', 'metric');
  assert.equal(secondPage.total, 55);
  assert.deepEqual(secondPage.items.map(item => item.id), Array.from({ length: 5 }, (_, index) => `rule:version:page-${index + 50}`));
  active = false;
  assert.deepEqual((await service.elements('test', '', '1', 'metric')).items.map(item => item.id), ['records']);
});

test('installation reseeding leaves existing publications alone when no optional validation pairs remain', async () => {
  const { readInstallOptions, seedInstallDefinitions } = await import('../../../packages/database/scripts/seed-install-definitions.mjs');
  const options = await readInstallOptions();
  assert.deepEqual(options, []);
  class Client {
    async connect() {}
    async end() {}
    async query(sql) {
      if (sql.includes('from app_identity.active_configuration_bundle')) return { rows:[{organization_id:'org',catalog_release_id:'catalog'}] };
      throw new Error(`Reseeding must not write over a publication: ${sql}`);
    }
  }
  const results = await seedInstallDefinitions({databaseUrl:'fixture',Client,log:{info(){}}});
  assert.deepEqual(results, []);
});

test('selector counts batch configured inputs and apply authorized dates, filters and metric eligibility', async () => {
  const version = bundle(), ids = ['pass', 'fail', 'missing', 'outside-filter'];
  const queries = [];
  const configuredReportReads = [];
  let stale = false;
  const manager = { query: async (sql, parameters) => {
    queries.push(sql);
    if (sql.includes('from app_identity.active_configuration_bundle')) return [{
      id: 'version', version: 1, catalog_release_id: 'catalog', compiled_bundle: version,
      compiled_sha256: compiledValidationBundleSha256(version),
    }];
    if (sql.includes('from typed group by element')) return [{ element: 'eArrest.01', count: '500', units: [] }];
    if (sql.includes('from analytics.review_operational_time_source')) return [{ response: '0', scene: '0', transport: '0' }];
    if (sql.includes('from operations.projection_health')) return [{ observed_at: context.timestamp, oldest_backlog_age_seconds: null,
      persistent_failure_count: stale ? 1 : 0, retrying_count: 0, stale_run_count: 0, last_run_status: 'success', is_read_only_replica: false, replay_lag_seconds: null }];
    if (sql.includes('from app_identity.organization')) return [{ time_zone: 'UTC', start: context.timestamp, end_exclusive: '2026-10-05T00:00:00Z' }];
    if (sql.includes('from analytics.review_volume_source')) {
      assert.deepEqual(parameters.slice(0, 4), ['org', true, false, 'author']);
      assert.equal(parameters[4], parameters[5]);
      if (parameters[4] !== '2026-10-04') return [];
      return ids.map(report_id => ({ report_id, reporting_date: '2026-10-04', projected_at: context.timestamp, revision: '1', amendment: 0,
        field_values: { 'eArrest.01': report_id === 'outside-filter' ? 'B' : 'A' }, field_absences: {} }));
    }
    if (sql.includes('from jsonb_to_recordset')) return [];
    if (sql.includes('from typed join jsonb_to_recordset')) return [];
    if (sql.includes('from clinical.report r')) {
      configuredReportReads.push(parameters[0]);
      assert.deepEqual(parameters.slice(1), ['org', true, false, 'author']);
      return parameters[0].map(id => ({ id, created_at: context.timestamp, updated_at: context.timestamp, form_id: 'form', form_version: 1,
        catalog_standard: 'NEMSIS', catalog_version: '3.5.1', catalog_dataset: 'EMSDataSet', catalog_release_id: 'catalog', revision: '1', amendment: 0 }));
    }
    if (sql.includes('from clinical.group_instance')) return parameters[0].flatMap(id => [
      { id: `${id}-root`, report_id: id, group_id: 'root', ordinal: 0 },
      { id: `${id}-observations`, report_id: id, group_id: 'observations', ordinal: 0, parent_group_instance_id: `${id}-root` },
    ]);
    if (sql.includes('from clinical.element_occurrence')) return parameters[0].flatMap(id => [
      { id: `${id}-start`, report_id: id, group_instance_id: `${id}-root`, element_id: 'start', ordinal: 0, value_kind: 'datetime', value_datetime: context.timestamp },
      ...(id === 'missing' ? [] : [
        { id: `${id}-time`, report_id: id, group_instance_id: `${id}-observations`, element_id: 'time', ordinal: 0, value_kind: 'datetime', value_datetime: `2026-10-04T00:0${id === 'fail' ? 2 : 1}:00Z` },
        { id: `${id}-code`, report_id: id, group_instance_id: `${id}-observations`, element_id: 'code', ordinal: 0, value_kind: 'coded', code: 'shock', code_system: 'test' },
      ]),
    ]);
    if (sql.includes('from clinical.amendment a')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const database = { transaction: async (isolation, callback) => { assert.equal(isolation, 'REPEATABLE READ'); return callback(manager); } };
  const session = { organization: { id: 'org' }, user: { id: 'author' }, capabilities: ['review:self', 'review:identifying', 'clinical:demo'] };
  const service = new AnalyticsService(database, { get: async () => session }, { analyticsDatabase: async () => database });
  const definition = { ...query, metric: 'rule:version:rule', aggregation: 'percentage', outcome: 'fail',
    filters: [{ element: 'eArrest.01', values: [{ type: 'code', value: 'A' }] }] };
  const selection = { purpose: 'metric', ids: ['records', 'metric:version:metric', 'rule:version:rule'] };
  const counts = await service.counts('test', { definition, selection });
  assert.deepEqual(counts, { total: 3, included: 2, elements: [
    { id: 'records', included: 3 }, { id: 'metric:version:metric', included: 2 }, { id: 'rule:version:rule', included: 2 },
  ], values: [] });
  for (const prefix of ['select id,report_id,parent_group_instance_id', 'select * from clinical.element_occurrence', 'select a.report_id,c.action'])
    assert.equal(queries.filter(sql => sql.trimStart().startsWith(prefix)).length, 1, 'one input read per table for the whole picker page');
  const graph = await service.query('test', definition);
  assert.equal(graph.completeness.total, 3);
  assert.deepEqual(configuredReportReads.at(-1), ['pass', 'fail', 'missing'],
    'graphs exclude filtered reports before loading configured clinical inputs');
  const values = await service.counts('test', { definition, selection: { purpose: 'values', element: 'eArrest.01',
    values: [{ value: 'A', type: 'code' }, { type: 'code', value: 'B' }] } });
  assert.deepEqual(values, { total: 3, included: 2, elements: [], values: [
    { identity: { type: 'code', value: 'A' }, included: 2 }, { identity: { type: 'code', value: 'B' }, included: 0 },
  ] });
  for (const purpose of ['group', 'filter']) assert.deepEqual((await service.counts('test', { definition, selection: { purpose, ids: ['eArrest.01'] } })).elements,
    [{ id: 'eArrest.01', included: 2 }]);
  assert.equal((await service.counts('test', { definition: { ...definition, filters: [] }, selection })).total, 4);
  assert.equal((await service.counts('test', { definition: { ...definition, from: '2026-10-05', through: '2026-10-05' }, selection })).total, 0);
  await assert.rejects(service.counts('test', { definition, selection: { purpose: 'metric', ids: ['disabled-rule'] } }), error => error.status === 400);
  await assert.rejects(service.counts('test', { definition, selection: { purpose: 'metric', ids: Array(51).fill('records') } }), error => error.status === 400);
  stale = true;
  await assert.rejects(service.counts('test', { definition, selection }), error => error.status === 409);
  session.capabilities = [];
  await assert.rejects(service.counts('test', { definition, selection }), error => error.status === 403);
});

test('configured contributions use effective amendments, explicit historical compatibility and bounded reads', async () => {
  const version = bundle(), element = {...field,configured:{...field.configured,id:'metric'}};
  const library = { bundle:version,elements:[element] };
  let changed = false, compatible = true, identifyingInput = false;
  const manager = { query: async (sql, parameters) => {
    if (sql.includes('from clinical.report r')) {
      assert.deepEqual(parameters,[['report'],'org',true,false,'author']);
      return [{id:'report',created_at:context.timestamp,updated_at:context.timestamp,form_id:'form',form_version:1,
        catalog_standard:'NEMSIS',catalog_version:'3.5.1',catalog_dataset:'EMSDataSet',catalog_release_id:compatible?'catalog':'older',revision:'7',amendment:changed?1:0}];
    }
    if (sql.includes('from clinical.group_instance')) return [{id:'root',report_id:'report',group_id:'root',ordinal:0},
      {id:'a',report_id:'report',group_id:'observations',ordinal:0,parent_group_instance_id:'root'}];
    if (sql.includes('from clinical.element_occurrence')) return [
      {id:'start',report_id:'report',group_instance_id:'root',element_id:'start',ordinal:0,value_kind:'datetime',value_datetime:context.timestamp},
      {id:'time',report_id:'report',group_instance_id:'a',element_id:'time',ordinal:0,value_kind:'datetime',value_datetime:'2026-10-04T00:02:00Z',
        identifying:identifyingInput,source_attributes:{private_note:'Unrestricted source metadata'}},
      {id:'code',report_id:'report',group_instance_id:'a',element_id:'code',ordinal:0,value_kind:'coded',code:'shock',code_system:'test'},
    ];
    if (sql.includes('from clinical.amendment a')) return changed ? [{report_id:'report',action:'replace',target_element_occurrence_id:'time',corrected_value:{id:'time',value_datetime:'2026-10-04T00:04:00Z'}}] : [];
    throw new Error(`Unexpected query ${sql}`);
  } };
  const scope = {organizationId:'org',userId:'author',reports:'own',defaultDataset:'synthetic'};
  const evaluate = async () => {
    const reports = [{id:'report',date:'2026-10-04',revision:'7',values:[]}];
    await contributeConfiguredDefinition(manager,scope,reports,element,library); return reports[0].values[0];
  };
  const initial = await evaluate();
  assert.equal(initial.value.value,120);
  assert.ok(!JSON.stringify(initial.evidence).includes('Unrestricted source metadata'));
  identifyingInput=true;
  assert.equal((await evaluate()).state,'failed');
  scope.identifying=true;
  assert.equal((await evaluate()).value.value,120);
  scope.identifying=false; identifyingInput=false;
  changed=true;
  const amended=await evaluate(); assert.equal(amended.value.value,240); assert.equal(amended.evidence.amendmentSequence,1);
  compatible=false;
  assert.equal((await evaluate()).state,'failed');
  await assert.rejects(contributeConfiguredDefinition(manager,scope,Array.from({length:2001},()=>({id:'report'})),element,library),/2,000 reports/);
});

test('minimumDistinctTimes counts qualifying instants and rejects invalid bounds', () => {
  const selection = { ...selected('first'), minimumDistinctTimes: 2 };
  const metric = compile(selection, { unit: 'score' });
  for (const rows of [[], [row('a', '2026-10-04T00:01:00Z', 8)],
    [row('a', '2026-10-04T00:01:00Z', 8), row('b', '2026-10-04T02:01:00+02:00', 3)],
    [row('a', '2026-10-04T00:01:00Z', 8), row('b', '2026-10-04T00:02:00Z', 3, false)]]) {
    const result = evaluateMetric(metric, document(rows), context);
    assert.equal(result.state, 'missing'); assert.equal(result.value, null);
  }
  assert.equal(evaluateMetric(metric, document([row('a', '2026-10-04T00:01:00Z', 8), row('b', '2026-10-04T00:02:00Z', 3)]), context).value, 8);
  for (const minimumDistinctTimes of [0, -1, 1.5, '2', null, 5001])
    assert.equal(compileMetric(source({ ...selection, minimumDistinctTimes }, { unit: 'score' }), 'version', catalog).compiled, undefined);
});

const canonicalCatalog = canonicalValidationCatalog(JSON.parse(await readFile(new URL('../../../defines/catalog/catalog_nemsis-3.5.1.json', import.meta.url), 'utf8')));
const emsLibrary = compileMetricLibrary(emsDefinitions.metrics, 'ems', canonicalCatalog);
assert.deepEqual(emsLibrary.diagnostics, []);
const emsBundle = { schemaVersion: 2, languageVersion: '2.0.0', validationVersionId: 'ems', catalogReleaseId: 'nemsis-3.5.1',
  metrics: emsLibrary.metrics, rules: emsDefinitions.rules.filter(rule => rule.enabled).map(rule => {
    const result = compileValidationRule(rule, 'ems', canonicalCatalog, emsLibrary.metrics);
    assert.ok(result.compiled, JSON.stringify(result.diagnostics)); return result.compiled;
  }) };
const time = minutes => `2026-10-04T00:${String(minutes).padStart(2, '0')}:00Z`;
const codedValue = (id, system, code) => ({ id, values: [{ occurrenceId: `${id}-${code}`, kind: 'coded', system, code }] });
const group = (id, instanceId, elements, parentInstanceId) => ({ id, instances: [{ instanceId, elements,
  ...(parentInstanceId ? { parentInstanceId } : {}) }] });
const emsInput = () => ({ groups: [
  group('eTimesSection', 'times', [['eTimes.01', 0], ['eTimes.07', 2], ['eTimes.09', 6], ['eTimes.11', 10]].map(([id, minutes]) => scalar(id, time(minutes)))),
  group('ePatient.AgeGroup', 'age', [scalar('ePatient.15', 35), scalar('ePatient.16', '2516009')]),
  group('eSituationSection', 'situation', [codedValue('eSituation.11', 'ICD-10-CM', 'R07.9')]),
  group('eDispositionSection', 'destination', [scalar('eDisposition.23', '9908031')]),
  { id: 'eProcedures.ProcedureGroup', instances: [
    { instanceId: 'shock', elements: [scalar('eProcedures.01', time(3)), codedValue('eProcedures.03', 'SNOMED-CT', '450661000124102')] },
    { instanceId: 'ecg', elements: [scalar('eProcedures.01', time(2)), codedValue('eProcedures.03', 'SNOMED-CT', '268400002')] },
  ] },
  group('eMedications.MedicationGroup', 'analgesia', [codedValue('eMedications.03', 'RxNorm', '4337')]),
  { id: 'eVitals.VitalGroup', instances: [
    { instanceId: 'last', elements: [scalar('eVitals.01', time(8))] },
    { instanceId: 'first', elements: [scalar('eVitals.01', time(1))] },
  ] },
  { id: 'eVitals.PainScaleGroup', instances: [
    { instanceId: 'last-pain', parentInstanceId: 'last', elements: [scalar('eVitals.27', 3), scalar('eVitals.28', '3328003')] },
    { instanceId: 'first-pain', parentInstanceId: 'first', elements: [scalar('eVitals.27', 8), scalar('eVitals.28', '3328003')] },
  ] },
  group('eVitals.CardiacRhythmGroup', 'rhythm', [scalar('eVitals.03', '9901051'), scalar('eVitals.04', '3304007')], 'first'),
] });
const instances = (input, id) => input.groups.find(group => group.id === id).instances;
const element = (input, id) => input.groups.flatMap(group => group.instances).flatMap(instance => instance.elements).find(element => element.id === id);
const emsOutcome = (name, input) => {
  const id = emsDefinitions.rules.find(rule => rule.name === name).id;
  const result = evaluateValidationOutcomes(emsBundle, input, 'review', context);
  assert.deepEqual(result.outcomes.filter(outcome => outcome.state === 'failed'), []);
  return result.outcomes.find(outcome => outcome.ruleId === id);
};

test('mapped EMS metrics calculate from real catalog choices without population restrictions', () => {
  const input = emsInput();
  assert.deepEqual(emsLibrary.metrics.map(metric => evaluateMetric(metric, input, context).value), [180, 60, -5, 120, 240, 240]);
  input.groups = input.groups.filter(group => !['ePatient.AgeGroup', 'eSituationSection'].includes(group.id));
  assert.deepEqual(emsLibrary.metrics.map(metric => evaluateMetric(metric, input, context).value), [180, 60, -5, 120, 240, 240]);
  // No arrest/vehicle/lights-and-sirens fields are required.
  const shock = emsLibrary.metrics[0], rhythm = emsLibrary.metrics[1];
  element(input, 'eProcedures.03').values[0].code = '426220008';
  assert.equal(evaluateMetric(shock, input, context).value, 180);
  element(input, 'eVitals.03').values[0].value = '9901005';
  assert.equal(evaluateMetric(rhythm, input, context).state, 'missing');
  element(input, 'eVitals.03').values = [{ occurrenceId: 'nv', kind: 'null', notValue: { code: '7701003' } }];
  assert.equal(evaluateMetric(rhythm, input, context).state, 'missing');
  for (const metric of emsLibrary.metrics) {
    const result = evaluateMetric(metric, { groups: [] }, context);
    assert.equal(result.state, 'missing'); assert.equal(result.value, null);
  }
});

test('one pain reduction outcome distinguishes lower, equal, higher and unavailable score pairs', () => {
  const metric = emsLibrary.metrics.find(metric => metric.name === 'Pain change (last minus first)');
  for (const [score, expected] of [[3, true], [8, false], [10, false]]) {
    const input = emsInput(); element(input, 'eVitals.27').values[0].value = score;
    assert.equal(emsOutcome('Pain reduced', input).value, expected);
    instances(input, 'eVitals.VitalGroup').reverse(); instances(input, 'eVitals.PainScaleGroup').reverse();
    assert.equal(emsOutcome('Pain reduced', input).value, expected);
  }
  for (const change of [
    input => { instances(input, 'eVitals.PainScaleGroup').shift(); },
    input => { element(input, 'eVitals.01').values[0].value = time(1); },
    input => { element(input, 'eVitals.28').values[0].value = '3328001'; },
    input => { element(input, 'eVitals.27').values[0].value = 11; },
    input => { element(input, 'eVitals.27').values = [{ occurrenceId: 'nv', kind: 'null', notValue: { code: '7701003' } }]; },
  ]) {
    const input = emsInput(); change(input);
    assert.equal(evaluateMetric(metric, input, context).state, 'missing');
    assert.equal(emsOutcome('Pain reduced', input).state, 'not-applicable');
  }
});

test('pain intervention accepts the six catalog analgesics by occurrence without medication times', () => {
  for (const code of ['161', '4337', '3423', '6130', '35827', '7052']) {
    const input = emsInput(); element(input, 'eMedications.03').values[0].code = code;
    // No medication timestamp exists; vital timestamps also have no bearing on intervention.
    for (const row of instances(input, 'eVitals.VitalGroup')) row.elements = [];
    assert.equal(emsOutcome('Pain intervention', input).value, true, code);
  }
  for (const code of ['1191', '3322', '6960', '8782', '4917', '1819', '6387']) {
    const input = emsInput(); element(input, 'eMedications.03').values[0].code = code;
    assert.equal(emsOutcome('Pain intervention', input).value, false, code);
  }
  const absent = emsInput(); element(absent, 'eMedications.03').values = [{ occurrenceId: 'refused', kind: 'pertinent-negative', code: '8801019' }];
  assert.equal(emsOutcome('Pain intervention', absent).value, false);
  for (const row of instances(absent, 'eVitals.PainScaleGroup')) row.elements[0].values[0].value = 6;
  assert.equal(emsOutcome('Pain intervention', absent).state, 'not-applicable');
});

test('12-lead and STEMI outcomes use age units, catalog codes and correlated rhythm observations', () => {
  const input = emsInput();
  assert.equal(emsOutcome('12-lead performed', input).value, true);
  assert.equal(emsOutcome('STEMI specialty destination', input).value, true);
  element(input, 'eDisposition.23').values[0].value = '9908035';
  assert.equal(emsOutcome('STEMI specialty destination', input).value, false);
  element(input, 'eDisposition.23').values[0].value = '9908033';
  assert.equal(emsOutcome('STEMI specialty destination', input).value, true);
  for (const [age, unit, eligible] of [[34, '2516009', false], [35, '2516007', false], [420, '2516007', true]]) {
    element(input, 'ePatient.15').values[0].value = age; element(input, 'ePatient.16').values[0].value = unit;
    assert.equal(emsOutcome('12-lead performed', input).state, eligible ? 'valid' : 'not-applicable');
  }
  const rows = instances(input, 'eVitals.CardiacRhythmGroup');
  rows[0].elements[1].values[0].value = '3304001';
  rows.push({ instanceId: 'different-ecg', parentInstanceId: 'last', elements: [scalar('eVitals.03', '9901047'), scalar('eVitals.04', '3304007')] });
  assert.equal(emsOutcome('STEMI specialty destination', input).state, 'not-applicable');
  input.groups = input.groups.filter(group => group.id !== 'eVitals.CardiacRhythmGroup');
  assert.equal(emsOutcome('12-lead performed', input).value, true, 'procedure code qualifies without a vital ECG type');
  instances(input, 'eProcedures.ProcedureGroup').pop();
  assert.equal(emsOutcome('12-lead performed', input).value, false);
  element(input, 'eSituation.11').id = 'eSituation.12';
  assert.equal(emsOutcome('12-lead performed', input).state, 'valid', 'secondary impression qualifies');
});

test('unresolved trauma and aspirin definitions cannot be enabled prematurely', () => {
  for (const source of emsDefinitions.rules.filter(rule => !rule.enabled)) {
    assert.ok(!source.source.includes('local.') && !source.source.includes('LOCAL'), 'available fields are mapped');
    const blocked = compileValidationRule({ ...source, enabled: true }, 'ems', canonicalCatalog, emsLibrary.metrics);
    assert.equal(blocked.compiled, undefined);
    assert.ok(blocked.diagnostics.some(diagnostic => diagnostic.message.includes('Complete source mapping')));
    const syntax = compileValidationRule({ ...source, unresolved: [] }, 'ems', canonicalCatalog, emsLibrary.metrics);
    assert.ok(syntax.compiled, JSON.stringify(syntax.diagnostics));
  }
});
