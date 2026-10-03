import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest('Review comments are append-only and available only to the API runtime role', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  if (!(await client.query("select to_regclass('clinical.review_item') item")).rows[0].item) {
    t.skip('Review schema is not installed in this database'); return;
  }
  if (!(await client.query("select to_regclass('clinical.review_comment') comment")).rows[0].comment)
    await client.query(readFileSync(new URL(
      '../../../supabase/migrations/20261002290000_review_discussion.sql', import.meta.url), 'utf8'));
  const privileges = (await client.query(`select
    has_table_privilege('open_triage_api_runtime','clinical.review_comment','select') api_read,
    has_table_privilege('open_triage_api_runtime','clinical.review_comment','insert') api_write,
    has_table_privilege('open_triage_api_runtime','clinical.review_comment','update') api_update,
    has_table_privilege('authenticated','clinical.review_comment','select') browser_read`)).rows[0];
  assert.deepEqual(privileges, { api_read: true, api_write: true, api_update: false, browser_read: false });
  const immutability = (await client.query(`select tgname from pg_trigger
    where tgrelid='clinical.review_comment'::regclass and not tgisinternal`)).rows;
  assert.ok(immutability.some((row) => row.tgname === 'review_comment_append_only'));
  const unique = (await client.query(`select pg_get_constraintdef(oid) definition from pg_constraint
    where conrelid='clinical.review_comment'::regclass and contype='u'`)).rows;
  assert.ok(unique.some((row) => row.definition.includes('organization_id, command_id')));
  assert.ok(unique.some((row) => row.definition.includes('item_id, item_version')));
});
