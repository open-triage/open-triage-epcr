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
  const state = { session: base, denied: false, authorizations: 0, elements: 0, values: 0 };
  const manager = { query: async sql => {
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
  const service = new AnalyticsService({ transaction: async (_level, run) => run(manager) }, { get: async () => {
    state.authorizations++;
    if (state.denied) throw new Error('Session expired');
    return state.session;
  } }, {});
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
