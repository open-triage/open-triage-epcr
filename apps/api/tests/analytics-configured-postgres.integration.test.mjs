import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { compileMetric } from '@open-triage/contracts';
import { contributeConfiguredDefinition } from '../dist/review/analytics-definitions.js';

const integration = process.env.DATABASE_URL ? test : test.skip;
integration('configured inputs ignore oversized unrelated sections and retain amended groups, empty selectors and ancestors', async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  const report = randomUUID(), catalog = randomUUID(), organization = randomUUID(), author = randomUUID();
  const root = randomUUID(), observed = randomUUID(), added = randomUUID(), empty = randomUUID(), unrelated = randomUUID();
  const start = randomUUID(), end = randomUUID(), newEnd = randomUUID(), amendment = randomUUID();
  const timestamp = '2026-10-04T00:00:00Z';
  const groups = [
    { id: root, group_id: 'root', ordinal: 0 },
    ...[observed, added, empty].map((id, ordinal) => ({ id, group_id: 'observations', ordinal, parent_group_instance_id: root })),
    { id: unrelated, group_id: 'unrelated', ordinal: 0, parent_group_instance_id: root },
  ].map(group => ({ ...group, report_id: report }));
  const values = [
    { id: start, report_id: report, group_instance_id: root, element_id: 'start', ordinal: 0, value_kind: 'datetime', value_datetime: timestamp },
    { id: end, report_id: report, group_instance_id: observed, element_id: 'end', ordinal: 0, value_kind: 'datetime', value_datetime: '2026-10-04T00:02:00Z' },
  ];
  const compiled = compileMetric({ id: 'elapsed', name: 'Elapsed', enabled: true, reviewEnabled: true, unit: 's', source: JSON.stringify({
    operator: 'elapsed', unit: 's', start: { operator: 'timestamp', elementId: 'start' },
    end: { operator: 'first', groupId: 'observations', elementId: 'end', timeElementId: 'end', unit: 'timestamp', where: 'present("end")' },
  }) }, 'version', { elements: [
    { elementId: 'start', label: 'Start', baseDatatype: 'dateTime', groupPath: ['root'] },
    { elementId: 'end', label: 'End', baseDatatype: 'dateTime', groupPath: ['root', 'observations'] },
  ], groups: [{ groupId: 'observations', label: 'Observations', repeating: true, intrinsicOccurrence: { min: 0, max: 'unbounded' } }], codes: [] });
  assert.ok(compiled.compiled, JSON.stringify(compiled.diagnostics));
  const metric = { id: 'metric:version:elapsed', unit: 's', configured: { kind: 'metric', id: 'elapsed', catalogReleaseId: catalog } };
  const library = { bundle: { schemaVersion: 2, metrics: [compiled.compiled], rules: [] }, elements: [metric] };
  let changes = [], groupRows, occurrenceRows;
  const manager = { query: async (sql, params) => {
    if (sql.includes('from clinical.report r')) return [{ id: report, created_at: timestamp, updated_at: timestamp,
      form_id: 'form', form_version: 1, catalog_standard: 'NEMSIS', catalog_version: '3.5.1', catalog_dataset: 'EMSDataSet',
      catalog_release_id: catalog, revision: '1', amendment: changes.length ? 1 : 0 }];
    if (sql.includes('from clinical.element_occurrence')) {
      // Virtual rows exercise the production SQL and its real input limit;
      // no clinical data is created or changed in the local database.
      const query = `with fixture_occurrences as (
        select (jsonb_populate_record(null::clinical.element_occurrence,entry)).* from jsonb_array_elements($3::jsonb) entry
        union all select (jsonb_populate_record(null::clinical.element_occurrence,jsonb_build_object(
          'report_id',($1::uuid[])[1],'group_instance_id',$4::uuid,'element_id','unrelated','value_kind','text','value_text','fictional'))).*
        from generate_series(1,50001)
      ) ${sql.replaceAll('clinical.element_occurrence', 'fixture_occurrences')}`;
      occurrenceRows = (await client.query(query, [...params, JSON.stringify(values), unrelated])).rows;
      return occurrenceRows;
    }
    if (sql.includes('from clinical.amendment a')) {
      const query = `with fixture_amendments as (select $3::uuid id,($1::uuid[])[1] report_id,1 sequence),
        fixture_changes as (select (jsonb_populate_record(null::clinical.amendment_change,entry)).* from jsonb_array_elements($4::jsonb) entry),
        fixture_occurrences as (select (jsonb_populate_record(null::clinical.element_occurrence,entry)).* from jsonb_array_elements($5::jsonb) entry)
        ${sql.replaceAll('clinical.amendment_change', 'fixture_changes').replaceAll('clinical.amendment a', 'fixture_amendments a')
          .replaceAll('clinical.element_occurrence', 'fixture_occurrences')}`;
      return (await client.query(query, [...params, amendment, JSON.stringify(changes), JSON.stringify(values)])).rows;
    }
    if (sql.includes('from clinical.group_instance')) {
      const query = sql.replace('with recursive ', `with recursive fixture_groups as (
        select (jsonb_populate_record(null::clinical.group_instance,entry)).* from jsonb_array_elements($4::jsonb) entry
      ), `).replaceAll('clinical.group_instance parent', 'fixture_groups parent').replaceAll('from clinical.group_instance where', 'from fixture_groups where');
      groupRows = (await client.query(query, [...params, JSON.stringify(groups)])).rows;
      return groupRows;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const evaluate = async () => {
    const reports = [{ id: report, date: '2026-10-04', revision: '1', values: [] }];
    await contributeConfiguredDefinition(manager, { organizationId: organization, userId: author, reports: 'all', defaultDataset: 'synthetic' }, reports, metric, library);
    return reports[0].values[0];
  };
  assert.equal((await evaluate()).value.value, 120);
  assert.equal(occurrenceRows.length, 2, '50,001 unrelated occurrences do not exhaust the clinical input budget');
  assert.deepEqual(new Set(groupRows.map(group => group.id)), new Set([root, observed, added, empty]));
  changes = [
    { id: randomUUID(), amendment_id: amendment, action: 'remove', target_element_occurrence_id: end, original_value: values[1] },
    { id: randomUUID(), amendment_id: amendment, action: 'add', corrected_value: { ...values[1], id: newEnd, group_instance_id: added, value_datetime: '2026-10-04T00:05:00Z' } },
    { id: randomUUID(), amendment_id: amendment, action: 'add', corrected_value: { id: randomUUID(), element_id: 'unrelated', group_instance_id: unrelated } },
  ];
  const amended = await evaluate();
  assert.equal(amended.value.value, 300);
  assert.equal(amended.evidence.amendmentSequence, 1);
  assert.ok(groupRows.some(group => group.id === added), 'effective added values retain their group ancestry');
});
