import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { catalogParams, catalogSourceSql } from '../dist/review/analytics-catalog.js';

test('narrow medication discovery retains its correlated unit and custom identities', () => {
  const scope = { organizationId: 'org', userId: 'user', defaultDataset: 'synthetic', reports: 'own', identifying: false };
  assert.deepEqual(catalogParams(scope, ['eMedications.05', 'eMedications.05', 'custom:identity:hash'])[4],
    ['eMedications.05', 'custom:identity:hash', 'eMedications.06']);
  assert.deepEqual(catalogParams(scope, ['record.documenting-user'])[4], ['record.documenting-user']);
});

const integration = process.env.DATABASE_URL ? test : test.skip;
integration('medication unit discovery scans effective occurrences once and keeps report/group correlation', async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  const report = randomUUID(), other = randomUUID(), catalog = randomUUID();
  const rows = [];
  const add = (reportId, group, element, code, action = 'base') => rows.push({
    report_id: reportId, catalog_release_id: catalog, occurrence_id: randomUUID(), sequence: 0, action, change_id: '',
    value: { element_id: element, group_instance_id: group, value_kind: element === 'eMedications.05' ? 'numeric' : 'coded',
      value_numeric: 10, code, identifying: false },
  });
  for (let index = 0; index < 100; index++) {
    const group = randomUUID();
    add(report, group, 'eMedications.05');
    add(report, group, 'eMedications.06', 'mg');
    add(other, group, 'eMedications.05');
    add(other, group, 'eMedications.06', 'mcg');
  }
  const removed = randomUUID();
  add(report, removed, 'eMedications.05');
  add(report, removed, 'eMedications.06', 'mg', 'remove');
  // Supply virtual base/amendment versions to the production effective/typed
  // catalog pipeline. No clinical rows or installation settings are changed.
  const sql = `with scoped_reports as (
    select $1::uuid id,$2::uuid catalog_release_id,$3::uuid organization_id,'signed' status,$4::uuid documenting_user_id where false
  ), custom_definitions as (select null::uuid catalog_release_id,null::jsonb definition where false), versions as (
    select * from jsonb_to_recordset($8::jsonb) fixture(report_id uuid,catalog_release_id uuid,occurrence_id uuid,
      value jsonb,sequence integer,action text,change_id text)
  ${catalogSourceSql.slice(catalogSourceSql.indexOf('), effective as ('))}
    select report_id,value->>'group_instance_id' group_id,unit from typed where element='eMedications.05'`;
  const params = [report, catalog, randomUUID(), randomUUID(), ['eMedications.05', 'eMedications.06'], ['eMedications.05'], false, JSON.stringify(rows)];
  const result = (await client.query(sql, params)).rows;
  assert.equal(result.length, 201);
  assert.ok(result.filter(row => row.report_id === other).every(row => row.unit === 'mcg'));
  assert.ok(result.filter(row => row.report_id === report && row.group_id !== removed).every(row => row.unit === 'mg'));
  assert.equal(result.find(row => row.group_id === removed).unit, null);
  const [{ 'QUERY PLAN': [plan] }] = (await client.query(`explain (analyze,format json) ${sql}`, params)).rows;
  const visit = node => {
    if (node['Node Type'] === 'CTE Scan' && node['CTE Name'] === 'effective')
      assert.ok(node['Actual Loops'] <= 1, 'unit lookup must not rescan effective occurrences for each medication dose');
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan.Plan);
});

integration('catalog occurrences retain scalar semantics without carrying large dispatch and provenance payloads', async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  const fixture = (await client.query(`select id,organization_id,catalog_release_id,documenting_user_id from clinical.report
    where synthetic and status='signed' and (expires_at is null or expires_at>now()) limit 1`)).rows[0];
  assert.ok(fixture, 'seed a nonexpired signed local synthetic report before integration tests');
  const group = randomUUID();
  const payload = 'fictional-fixture'.repeat(10000);
  const rows = [{ id: randomUUID(), report_id: fixture.id, catalog_release_id: fixture.catalog_release_id,
    group_instance_id: group, element_id: 'eMedications.05', value_kind: 'numeric', value_numeric: 42.5,
    source_attributes: { unit: 'fallback', dispatchPayload: payload }, provenance_detail: { payload }, identifying: false },
  { id: randomUUID(), report_id: fixture.id, catalog_release_id: fixture.catalog_release_id,
    group_instance_id: group, element_id: 'eMedications.06', value_kind: 'coded', code: '3706013', identifying: false }];
  const source = catalogSourceSql.replace(/^with /, '').replaceAll('clinical.element_occurrence o', 'fixture_occurrences o');
  const sql = `with fixture_occurrences as (
    select (jsonb_populate_record(null::clinical.element_occurrence,entry)).* from jsonb_array_elements($8::jsonb) entry
  ), ${source} select value,identity,unit from typed where element='eMedications.05' and value->>'group_instance_id'=$9`;
  const scope = { organizationId: fixture.organization_id, userId: fixture.documenting_user_id,
    reports: 'all', defaultDataset: 'synthetic', identifying: false };
  const [dose] = (await client.query(sql, [...catalogParams(scope, ['eMedications.05']), JSON.stringify(rows), group])).rows;
  assert.deepEqual(dose.identity, { type: 'number', value: 42.5 });
  assert.equal(dose.unit, '3706013');
  assert.deepEqual(dose.value.source_attributes, { unit: 'fallback' });
  assert.equal(dose.value.provenance_detail, undefined);
  assert.ok(JSON.stringify(dose.value).length < 1000, 'large source payloads must not enter catalog sorts');
});
