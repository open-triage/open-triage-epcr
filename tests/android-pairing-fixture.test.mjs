import assert from 'node:assert/strict';
import test from 'node:test';
import { issueNamedFixtureEnrollment } from '../scripts/android/pairing-fixture.mjs';

test('ordinary and managed Android journeys verify administrator-assigned names before consuming a code', async () => {
  for (const name of ['Synthetic emulator ambulance', 'Managed emulator ambulance']) {
    const calls = [], headers = { Cookie: 'synthetic', 'x-csrf-token': 'synthetic' }, fixture = { unitId: 'unit' };
    const api = async (actualFixture, ca, path, method, body, actualHeaders) => {
      assert.equal(actualFixture, fixture); assert.equal(ca, 'synthetic-ca'); assert.equal(method, 'POST');
      calls.push(path);
      if (path.endsWith('/enrollment')) {
        assert.equal(actualHeaders, headers); assert.deepEqual(body, { name });
        return { status: 201, body: { token: 'synthetic-token' } };
      }
      assert.equal(path, 'installations/preview'); assert.deepEqual(body, { token: 'synthetic-token' });
      assert.deepEqual(actualHeaders, { 'x-installation-enrollment': '1' });
      return { status: 201, body: { installationName: name } };
    };
    assert.equal((await issueNamedFixtureEnrollment(api, fixture, 'synthetic-ca', headers, name)).body.token, 'synthetic-token');
    assert.deepEqual(calls, ['admin/units/unit/enrollment', 'installations/preview']);
    await assert.rejects(issueNamedFixtureEnrollment(async (...args) => args[2].endsWith('/enrollment') ? {status:201,body:{token:'synthetic-token'}} : {status:201,body:{installationName:'Client-selected name'}}, fixture, 'synthetic-ca', headers, name), /administrator-selected/);
  }
});
