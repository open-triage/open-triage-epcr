import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
const integration = process.env.DATABASE_URL ? test : test.skip;
integration('expired synthetic reports purge Review dependencies while active history remains immutable', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const candidate = (await client.query(`select r.id,r.expires_at,i.id item_id from clinical.report r
    join clinical.review_item i on i.report_id=r.id where r.synthetic_generated_by is not null
    and exists(select 1 from clinical.review_item_evidence e where e.item_id=i.id) limit 1`)).rows[0];
  if (!candidate) return t.skip('Seed a synthetic Review report first');
  await client.query('savepoint protected');
  await assert.rejects(client.query('delete from clinical.review_item_evidence where item_id=$1', [candidate.item_id]));
  await client.query('rollback to savepoint protected');
  await assert.rejects(client.query('select retention.delete_expired_report_review($1)', [candidate.id]), /authorized synthetic report purge/);
  await client.query('rollback to savepoint protected');
  const realBefore = (await client.query('select count(*) from clinical.report where not synthetic')).rows[0].count;
  await client.query("select retention.purge_expired_synthetic_records($1::timestamptz + interval '1 minute')", [candidate.expires_at]);
  assert.equal((await client.query('select 1 from clinical.report where id=$1', [candidate.id])).rowCount, 0);
  for (const table of ['review_item', 'review_work', 'review_evaluation'])
    assert.equal((await client.query(`select 1 from clinical.${table} where report_id=$1`, [candidate.id])).rowCount, 0);
  assert.equal((await client.query('select 1 from clinical.review_item_evidence where item_id=$1', [candidate.item_id])).rowCount, 0);
  assert.equal((await client.query('select 1 from clinical_audit.synthetic_purge_tombstone where record_id=$1', [candidate.id])).rowCount, 1);
  assert.equal((await client.query('select count(*) from clinical.report where not synthetic')).rows[0].count, realBefore);
});
