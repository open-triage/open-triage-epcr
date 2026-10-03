import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest('retrospective run schema preserves source identity and runtime privilege boundary', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const base = (await client.query("select to_regclass('clinical.review_work') as work")).rows[0].work;
  if (!base) { t.skip('Review schema is not installed in this database'); return; }
  const installed = (await client.query("select to_regclass('clinical.review_retrospective_run') as run")).rows[0].run;
  if (!installed) await client.query(readFileSync(new URL(
    '../../../supabase/migrations/20261002260000_review_retrospective.sql', import.meta.url), 'utf8'));
  const constraints = (await client.query(`select conname, pg_get_constraintdef(oid) definition
    from pg_constraint where conrelid='clinical.review_work'::regclass
      and conname in ('review_work_source_check','review_work_source_unique')
    order by conname`)).rows;
  assert.equal(constraints.length, 2);
  assert.match(constraints.find((row) => row.conname === 'review_work_source_unique').definition,
    /source_key/);
  const privileges = (await client.query(`select
    has_table_privilege('open_triage_api_runtime','clinical.review_retrospective_run','select') api_read,
    has_table_privilege('open_triage_api_runtime','clinical.review_retrospective_report','insert') api_write,
    has_table_privilege('authenticated','clinical.review_retrospective_run','select') browser_read,
    has_table_privilege('open_triage_api_runtime','clinical.review_retrospective_run','delete') api_delete`)).rows[0];
  assert.deepEqual(privileges, { api_read: true, api_write: true, browser_read: false, api_delete: false });
});
