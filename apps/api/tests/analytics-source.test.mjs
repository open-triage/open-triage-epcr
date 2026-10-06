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
    assert.deepEqual(params.slice(0, 4), ['org', true, false, 'author']);
    assert.deepEqual(params[4], ['report']);
    assert.deepEqual(params.slice(-2), [definition.from, definition.through]);
    assert.match(sql, /report_id=any\(\$5::uuid\[\]\)/);
  }
  assert.equal(custom.params[6], false, 'identifying authorization is retained');
});
