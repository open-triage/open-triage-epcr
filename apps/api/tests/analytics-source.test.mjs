import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAnalyticsReports } from '../dist/review/analytics-source.js';

test('repeated and custom sources bound monthly partitions to the authorized report period', async () => {
  const scope = { organizationId: 'org', userId: 'author', defaultDataset: 'synthetic', reports: 'self', identifying: false };
  const definition = { metric: 'records', groupBy: null, from: '2026-08-01', through: '2026-10-05',
    filters: [{ element: 'eMedications.03' }, { element: 'custom:fixture:version' }] };
  const queries = [];
  const database = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('from analytics.review_volume_source')) return [{ report_id: 'report', reporting_date: '2026-09-01',
      revision: '1', amendment: 0, projected_at: new Date('2026-10-06'), field_values: {}, field_absences: {} }];
    return [];
  } };
  await loadAnalyticsReports(database, scope, definition, [
    { id: 'eMedications.03', datatype: 'code', repeating: true },
    { id: 'custom:fixture:version', datatype: 'number', source: 'custom' },
  ]);
  const repeated = queries.find(({ sql }) => sql.includes('from analytics.review_repeated_field_source'));
  const custom = queries.find(({ sql }) => sql.includes('from analytics.review_custom_field_source'));
  assert.match(repeated.sql, /reporting_date between \$7::date and \$8::date/);
  assert.match(custom.sql, /c.reporting_date between \$8::date and \$9::date/);
  for (const { sql, params } of [repeated, custom]) {
    assert.deepEqual(params.slice(0, 4), [['org'], true, false, 'author']);
    assert.deepEqual(params[4], ['report']);
    assert.deepEqual(params.slice(-2), [definition.from, definition.through]);
    assert.match(sql, /report_id=any\(\$5::uuid\[\]\)/);
  }
  assert.equal(custom.params[6], false, 'identifying authorization is retained');
});

for (const scenario of [
  { name: 'record counts', fields: [] },
  { name: 'configured metrics', metric: 'metric:version:response', fields: [{ id: 'metric:version:response', configured: {} }] },
  { name: 'user grouping', group: 'record.documenting-user', fields: [{ id: 'record.documenting-user', datatype: 'code' }], user: true },
  { name: 'repeated dimensions', group: 'eMedications.03', fields: [{ id: 'eMedications.03', repeating: true }] },
  { name: 'custom dimensions', group: 'custom:fixture:version', fields: [{ id: 'custom:fixture:version', source: 'custom' }] },
  { name: 'scalar filters', filter: 'eDispatch.01', fields: [{ id: 'eDispatch.01', datatype: 'code' }], scalar: true },
  { name: 'operational intervals', metric: 'response', fields: [{ id: 'response', datatype: 'number', interval: { start: 'eTimes.03', end: 'eTimes.06' } }], times: true },
  { name: 'picker candidates', additional: ['eDispatch.01'], fields: [{ id: 'eDispatch.01', datatype: 'code' }], scalar: true },
]) test(`${scenario.name} only load required analytical sources`, async () => {
  const queries = [];
  const reports = await loadAnalyticsReports({ query: async (sql, params) => {
    queries.push({ sql, params });
    if (!sql.includes('from analytics.review_volume_source')) return [];
    return [{ report_id: 'report', organization_id: 'org', reporting_date: '2026-09-01', revision: '1', amendment: 0,
      projected_at: new Date('2026-10-06'), documenting_user_id: 'author', documenting_user_label: 'Clinician',
      field_values: { 'eDispatch.01': '123' }, field_absences: {},
      etimes_03: new Date('2026-09-01T10:00:00Z'), etimes_06: new Date('2026-09-01T10:10:00Z') }];
  } }, { organizationId: 'org', userId: 'author', defaultDataset: 'synthetic', reports: 'self', identifying: false },
  { metric: scenario.metric ?? 'records', groupBy: scenario.group ?? null, from: '2026-09-01', through: '2026-09-30',
    filters: scenario.filter ? [{ element: scenario.filter }] : [] }, scenario.fields, scenario.additional);
  const { sql, params } = queries[0];
  assert.equal(sql.includes('join analytics.review_field_source_with_identity'), !!scenario.scalar);
  assert.equal(sql.includes('join analytics.review_operational_time_source'), !!scenario.times);
  assert.equal(sql.includes('join app_identity.app_user'), !!scenario.user);
  assert.match(sql, /r.status='signed'/);
  assert.match(sql, /r.expires_at>now\(\)/);
  assert.deepEqual(params.slice(0, 4), [['org'], true, false, 'author']);
  assert.equal(reports.length, 1);
  if (scenario.times) assert.equal(reports[0].values[0].value.value, 10);
  if (scenario.user) assert.equal(reports[0].values[0].value.value, 'author');
});
