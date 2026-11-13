import assert from 'node:assert/strict';

/** Verify the administrator's name snapshot before starting a device journey. */
export async function issueNamedFixtureEnrollment(api, fixture, ca, headers, name) {
  assert.equal(typeof name, 'string'); assert(name.trim(), 'An explicit fixture installation name is required');
  const issued = await api(fixture, ca, `admin/units/${fixture.unitId}/enrollment`, 'POST', { name }, headers);
  assert.equal(issued.status, 201, 'Synthetic named pairing issuance');
  const preview = await api(fixture, ca, 'installations/preview', 'POST', { token: issued.body.token }, { 'x-installation-enrollment': '1' });
  assert.equal(preview.status, 201, 'Synthetic pairing preview');
  assert.equal(preview.body.installationName, name, 'Pairing must snapshot the administrator-selected fixture name');
  return issued;
}
