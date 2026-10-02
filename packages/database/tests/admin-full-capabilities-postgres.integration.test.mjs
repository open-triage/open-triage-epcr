import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest('new administrator and demo roles grant the full registry; clinician remains limited', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const organizationId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values ($1,'Full permissions test','UTC')`, [organizationId]);
  const registry = (await client.query('select key from app_identity.capability order by key')).rows.map(row => row.key);
  for (const key of ['administrator', 'demo', 'clinician']) {
    const granted = (await client.query(`select c.capability_key from app_identity.role r
      join app_identity.role_version_capability c on c.role_version_id=r.current_version_id
      where r.organization_id=$1 and r.system_key=$2 order by c.capability_key`, [organizationId, key]))
      .rows.map(row => row.capability_key);
    assert.deepEqual(granted, key === 'clinician' ? ['clinical:document', 'review:self'] : registry);
  }
  await client.query('set constraints all immediate');
});
