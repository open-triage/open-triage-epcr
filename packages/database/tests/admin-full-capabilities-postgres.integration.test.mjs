import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest('new Demo roles exclude publishing while administrators retain the full registry', async (t) => {
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
    const expected = key === 'clinician' ? ['clinical:document', 'review:self']
      : key === 'demo' ? registry.filter(capability => !capability.endsWith(':publish')) : registry;
    assert.deepEqual(granted, expected);
  }
  await client.query('set constraints all immediate');
});

integrationTest('Demo migration removes live publishing access and preserves role history', async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const priorMigration = await readFile(new URL('../../../supabase/migrations/20261002200044_full_administrator_and_demo_capabilities.sql', import.meta.url), 'utf8');
  // Recreate the previous presets without upgrading unrelated organizations.
  await client.query(priorMigration.slice(priorMigration.indexOf('create or replace function'),
    priorMigration.indexOf('-- Publish a new immutable role version')));
  const organizationId = randomUUID();
  const userId = randomUUID();
  const ownerId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values ($1,'Demo publishing migration test','UTC')`, [organizationId]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values ($1,$3,'Demo assignee'),($2,$3,'Ordinary installation owner')`, [userId, ownerId, organizationId]);
  await client.query(`insert into app_identity.installation_owner
    (organization_id,user_id,established_by_operator_id) values ($1,$2,'integration-test')`,
    [organizationId, ownerId]);
  const priorRole = (await client.query(`select id,current_version_id from app_identity.role
    where organization_id=$1 and system_key='demo'`, [organizationId])).rows[0];
  const administrator = (await client.query(`select current_version_id from app_identity.role
    where organization_id=$1 and system_key='administrator'`, [organizationId])).rows[0];
  await client.query(`insert into app_identity.user_role_assignment
    (organization_id,user_id,role_id,assigned_by,note) values ($1,$2,$3,$2,'Demo test')`,
    [organizationId, userId, priorRole.id]);
  await client.query('set constraints all immediate');
  await client.query('set constraints all deferred');
  const can = async capability => (await client.query(
    'select app_identity.user_has_capability($1,$2,$3) allowed', [userId, organizationId, capability])).rows[0].allowed;
  const publishing = ['catalog:publish', 'forms:publish', 'validation:publish'];
  for (const capability of publishing) assert.equal(await can(capability), true);

  await client.query(await readFile(new URL('../../../supabase/migrations/20261003161629_remove_demo_publishing_capabilities.sql', import.meta.url), 'utf8'));
  await client.query('set constraints all immediate');
  for (const capability of publishing) assert.equal(await can(capability), false);
  const registry = (await client.query('select key from app_identity.capability order by key')).rows.map(row => row.key);
  for (const capability of registry.filter(key => !key.endsWith(':publish'))) {
    assert.equal(await can(capability), true, `Demo lost ${capability}`);
  }
  const priorCapabilities = (await client.query(`select capability_key from app_identity.role_version_capability
    where role_version_id=$1 order by capability_key`, [priorRole.current_version_id])).rows.map(row => row.capability_key);
  assert.deepEqual(priorCapabilities, registry);
  assert.equal((await client.query(`select current_version_id from app_identity.role
    where organization_id=$1 and system_key='administrator'`, [organizationId])).rows[0].current_version_id,
    administrator.current_version_id);
  assert.equal((await client.query(`select count(*)::integer count from app_identity.authorization_event
    where organization_id=$1 and action='role.version_activate' and details->>'priorVersionId'=$2`,
    [organizationId, priorRole.current_version_id])).rows[0].count, 1);
});
