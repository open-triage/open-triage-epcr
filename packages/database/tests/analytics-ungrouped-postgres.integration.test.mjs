import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest('legacy ungrouped analytical occurrences require an explicit quality flag', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const sample = (await client.query(`select * from analytics_private.epcr_repeatable_element
    where not is_custom and group_instance_id is null
      and quality_flags @> array['missing-group-instance']::text[] limit 1`)).rows[0];
  if (!sample) { t.skip('No legacy projection fixture'); return; }
  const row = { ...sample, element_occurrence_id: randomUUID(), quality_flags: null };
  const columns = Object.keys(row);
  const sql = `insert into analytics_private.epcr_repeatable_element (${columns.join(',')})
    values (${columns.map((_,index) => '$'+(index+1)).join(',')})`;
  await client.query('savepoint unflagged');
  await assert.rejects(client.query(sql, columns.map(key => row[key])), error => error.code === '23514');
  await client.query('rollback to savepoint unflagged');
  row.quality_flags = ['missing-group-instance'];
  await client.query(sql, columns.map(key => row[key]));
  const result = (await client.query(`select group_instance_id,instance_path,quality_flags
    from analytics_private.epcr_repeatable_element where element_occurrence_id=$1`, [row.element_occurrence_id])).rows[0];
  assert.deepEqual(result, {group_instance_id: null,instance_path: [],quality_flags: ['missing-group-instance']});
});
