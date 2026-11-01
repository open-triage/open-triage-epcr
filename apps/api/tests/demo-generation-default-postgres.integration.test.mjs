import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { AssignedCallsService } from '../dist/calls/assigned-calls.service.js';

const integration = process.env.DATABASE_URL ? test : test.skip;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

integration('demo generation follows the agency default for every authorized user, including owners', async () => {
  const db = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const agency = SYNTHETIC_DEMO_FIXTURE.organizationId;
    const first = randomUUID(), second = randomUUID();
    await runner.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign)
      values($1,$3,'First','DEFAULT-FIRST'),($2,$3,'Second','DEFAULT-SECOND')`, [first, second, agency]);
    const session = { organization: { id: agency }, user: { id: SYNTHETIC_DEMO_FIXTURE.userId } };
    const service = new AssignedCallsService(runner.manager, {
      requireCapability: async (_token, capability) => {
        assert.ok(['clinical:document', 'clinical:demo'].includes(capability));
        return session;
      },
    });
    const context = () => service.syntheticGenerationContext('authorized-owner');
    const setDefault = id => runner.query('update app_identity.agency_settings set demo_unit_id=$2 where organization_id=$1', [agency, id]);
    await setDefault(null);
    const all = (await context()).eligibleUnits;
    assert.ok(all.some(unit => unit.id === first));
    assert.ok(all.some(unit => unit.id === second));
    await setDefault(second);
    assert.deepEqual((await context()).eligibleUnits, [{ id: second, callSign: 'DEFAULT-SECOND', name: 'Second' }]);
    await setDefault(first);
    assert.deepEqual((await context()).eligibleUnits.map(unit => unit.id), [first]);
    await runner.query('update app_identity.operational_unit set active=false where id=$1', [first]);
    assert.deepEqual((await context()).eligibleUnits, [], 'an inactive default must not silently route to another unit');
    await setDefault(null);
    assert.ok((await context()).eligibleUnits.some(unit => unit.id === second));
    assert.ok(!(await context()).eligibleUnits.some(unit => unit.id === first));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await db.destroy();
  }
});
