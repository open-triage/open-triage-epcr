import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsDiscoveryCache } from '../dist/review/analytics-discovery-cache.js';
import { AnalyticsService } from '../dist/review/analytics.service.js';

test('discovery shares pending loads and expires from load start without extending on reads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const cache = new AnalyticsDiscoveryCache();
  let finish, reads = 0;
  const load = () => { reads++; return new Promise(resolve => { finish = resolve; }); };
  const first = cache.get('scope', load);
  assert.equal(cache.get('scope', load), first);
  await Promise.resolve();
  t.mock.timers.tick(20_000);
  finish(['first']);
  assert.deepEqual(await first, ['first']);
  assert.equal(cache.get('scope', load), first);
  t.mock.timers.tick(10_000);
  assert.deepEqual(await cache.get('scope', async () => { reads++; return ['second']; }), ['second']);
  assert.equal(reads, 2);
});

test('failed discovery retries and expired pending failures cannot evict a replacement', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const cache = new AnalyticsDiscoveryCache();
  await assert.rejects(cache.get('scope', async () => { throw new Error('unavailable'); }), /unavailable/);
  let fail;
  const pending = cache.get('scope', () => new Promise((_resolve, reject) => { fail = reject; }));
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  const replacement = cache.get('scope', async () => ['current']);
  assert.deepEqual(await replacement, ['current']);
  fail(new Error('late failure'));
  await assert.rejects(pending, /late failure/);
  assert.equal(cache.get('scope', async () => []), replacement);
});

test('discovery memory is bounded and retains recently used entries', async () => {
  const cache = new AnalyticsDiscoveryCache(2);
  const load = async () => [];
  const first = cache.get('first', load), second = cache.get('second', load);
  await Promise.all([first, second]);
  assert.equal(cache.get('first', load), first);
  await cache.get('third', load);
  assert.equal(cache.get('first', load), first);
  assert.notEqual(cache.get('second', load), second);
});

function fixture() {
  const base = { user: { id: 'user' }, organization: { id: 'org' }, capabilities: ['review:all'] };
  const state = { session: base, denied: false, authorizations: 0, elements: 0, values: 0, sourceReads: 0 };
  const manager = { query: async sql => {
    if (sql.includes('from app_identity.active_configuration_bundle')) return [];
    if (sql.includes('from operations.projection_health')) return [{ observed_at: new Date('2026-10-06T09:00:00Z'),
      oldest_backlog_age_seconds: null, persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0,
      last_run_status: 'succeeded', is_read_only_replica: false, replay_lag_seconds: null }];
    if (sql.includes('from app_identity.organization')) return [{ time_zone: 'UTC',
      start: new Date('2026-08-01T00:00:00Z'), end_exclusive: new Date('2026-10-06T00:00:00Z') }];
    if (sql.includes('from analytics.review_volume_source')) {
      state.sourceReads++;
      return [{ report_id: 'report', reporting_date: '2026-09-01', projected_at: new Date('2026-10-06T09:00:00Z'),
        revision: '1', amendment: 0, field_values: { 'eVitals.06': 120 }, field_absences: {} }];
    }
    if (sql.includes('from analytics.review_repeated_field_source')) return [{ report_id: 'report', id: 'occurrence',
      element: 'eVitals.06', value: 120, unit: 'mm[Hg]', group_ordinal: 0, element_ordinal: 0 }];
    if (sql.includes('from typed join jsonb_to_recordset')) return [];
    if (sql.includes('from typed group by element')) {
      state.elements++;
      return [{ element: 'eVitals.06', count: '3', units: [] }];
    }
    if (sql.includes('from analytics.review_operational_time_source')) return [];
    if (sql.includes('choices as (')) {
      state.values++;
      return [{ identity: { type: 'number', value: 120 }, label: '120', count: '3', total: '1' }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const database = { transaction: async (_level, run) => run(manager) };
  const service = new AnalyticsService(database, { get: async () => {
    state.authorizations++;
    if (state.denied) throw new Error('Session expired');
    return state.session;
  } }, { analyticsDatabase: async () => database });
  return { state, service, base };
}

test('search, pagination, grouping, filtering and values reuse authorized discovery', async () => {
  const { state, service } = fixture();
  const [group, filter] = await Promise.all([
    service.elements('token', '', '1', 'group'), service.elements('token', '', '1', 'filter'),
  ]);
  assert.deepEqual(group, filter);
  assert.equal((await service.elements('token', 'no match', '1', 'filter')).total, 0);
  assert.deepEqual((await service.elements('token', '', '2', 'group')).items, []);
  await service.values('token', 'eVitals.06');
  await service.values('token', 'eVitals.06');
  assert.equal(state.elements, 1);
  assert.equal(state.values, 1);
  assert.equal(state.authorizations, 6, 'cache hits still authorize');
  await service.values('token', 'eVitals.06', '120');
  await service.values('token', 'eVitals.06', '', '2');
  assert.equal(state.values, 3, 'value search and page have distinct entries');
});

const recordsDefinition = { version: 1, metric: 'records', aggregation: 'count', visualization: 'line',
  from: '2026-08-01', through: '2026-10-05', groupBy: null, timeGrouping: 'week', filters: [] };

test('record graphs, picker counts and exports skip occurrence discovery but read live reports and authorize each request', async () => {
  const { service, state } = fixture();
  const result = await service.query('token', recordsDefinition);
  assert.equal(result.completeness.valid, 1);
  assert.deepEqual(await service.counts('token', { definition: recordsDefinition,
    selection: { purpose: 'metric', ids: ['records'] } }),
  { total: 1, included: 1, elements: [{ id: 'records', included: 1 }], values: [] });
  const csv = await service.export('token', { definition: recordsDefinition, expectedRevision: result.exportRevision, kind: 'records' });
  assert.ok(csv.includes('report'));
  assert.equal(state.elements, 0);
  assert.equal(state.sourceReads, 3);
  assert.equal(state.authorizations, 3);
  state.session = { ...state.session, capabilities: [] };
  await assert.rejects(service.query('token', recordsDefinition), error => error.status === 403);
  assert.equal(state.sourceReads, 3);
});

test('recorded filters and picker candidates still load current field metadata', async () => {
  const { service, state } = fixture();
  const definition = { ...recordsDefinition, filters: [{ element: 'eVitals.06', values: [{ type: 'number', value: 120 }] }] };
  assert.equal((await service.query('token', definition)).completeness.valid, 1);
  assert.equal(state.elements, 1);
  const result = await service.counts('token', { definition: recordsDefinition,
    selection: { purpose: 'filter', ids: ['eVitals.06'] } });
  assert.equal(result.elements[0].included, 1);
  assert.equal(state.elements, 2);
  await assert.rejects(service.query('token', { ...recordsDefinition, filters: {} }), error => error.status === 400);
  await assert.rejects(service.query('token', { ...recordsDefinition, filters: [null] }), error => error.status === 400);
});

test('discovery isolates every scope and rejects revoked sessions and permissions on hits', async () => {
  const { state, service, base } = fixture();
  for (const session of [base,
    { ...base, user: { id: 'other' } }, { ...base, organization: { id: 'other' } },
    { ...base, capabilities: ['review:self'] }, { ...base, capabilities: ['review:all', 'clinical:demo'] },
    { ...base, capabilities: ['review:all', 'review:identifying'] },
  ]) {
    state.session = session;
    await service.values('token', 'eVitals.06');
  }
  assert.equal(state.elements, 6);
  assert.equal(state.values, 6);
  state.session = base;
  await service.values('token', 'eVitals.06');
  assert.equal(state.values, 6);
  state.denied = true;
  await assert.rejects(service.values('token', 'eVitals.06'), /Session expired/);
  state.denied = false;
  state.session = { ...base, capabilities: [] };
  await assert.rejects(service.elements('token', '', '1', 'group'), error => error.status === 403);
  await assert.rejects(service.values('token', 'eVitals.06'), error => error.status === 403);
  assert.equal(state.elements, 6);
  assert.equal(state.values, 6);
});
