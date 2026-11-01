import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { villePatient, verifyVillePatient, ensureVillePatient } from '../scripts/cos-sandbox-patient.mjs';
const fixture = JSON.parse(await readFile(new URL('../apps/api/tests/fixtures/hospital/ville.json', import.meta.url)));
const patient = villePatient(fixture);
const found = () => ({ status: 200, body: { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: { ...structuredClone(patient), id: '6905' } }] } });
const absent = { status: 404, body: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'processing', diagnostics: 'Patient Not found for the given identifier' }] } };
test('EPS coordination fixture maps to COS without changing identity or prohibited name fields', () => {
  assert.deepEqual(patient.identifier, [{ system: 'urn:oid:1.2.752.129.2.1.3.3', value: '201304822172' }]);
  assert.deepEqual(patient.name, [{ family: 'Söderberg', given: ['Vilhelm', 'Erik'] }]);
  assert.equal(patient.birthDate, '2013-04-22');
  assert.equal(patient.telecom, undefined);
  const changed = structuredClone(fixture);
  changed.entry.find(e => e.resource.resourceType === 'Patient').resource.identifier[0].value = '194609073277';
  assert.throws(() => villePatient(changed));
});
test('existing patient is verified without a write; wrong scheme and duplicates cannot pass', async () => {
  assert.equal(await ensureVillePatient(async () => found(), patient), '6905');
  const wrong = found().body; wrong.entry[0].resource.identifier[0].system = 'urn:oid:1.2.752.129.2.1.3.1';
  assert.throws(() => verifyVillePatient(wrong, patient));
  const duplicate = found().body; duplicate.entry.push(duplicate.entry[0]);
  assert.throws(() => verifyVillePatient(duplicate, patient));
});
test('empty 201 receipt requires independent readback, with intent persisted before POST', async () => {
  const actions = [];
  const id = await ensureVillePatient(async (path, options) => {
    if (options?.method === 'POST') { actions.push('POST'); return { status: 201, body: '' }; }
    actions.push('GET'); return actions.length === 1 ? absent : found();
  }, patient, { register: true, recordIntent: async () => actions.push('intent'), recordReceipt: async () => actions.push('receipt') });
  assert.equal(id, '6905'); assert.deepEqual(actions, ['GET', 'intent', 'POST', 'receipt', 'GET']);
});
test('lookup errors, read-only mode, and existing intent prevent patient creation', async () => {
  for (const reply of [absent, { status: 403 }, { status: 500 }, { status: 404, body: {} }]) {
    let writes = 0;
    await assert.rejects(ensureVillePatient(async (_, options) => { if (options) writes++; return reply; }, patient));
    assert.equal(writes, 0);
  }
  let writes = 0;
  await assert.rejects(ensureVillePatient(async (_, options) => { if (options) writes++; return absent; }, patient,
    { register: true, recordIntent: async () => { throw Error('EEXIST'); } }), /EEXIST/);
  assert.equal(writes, 0);
});
test('a successful POST with missing readback does not claim verified or retry', async () => {
  let writes = 0;
  await assert.rejects(ensureVillePatient(async (_, options) => {
    if (options) { writes++; return { status: 201, body: '' }; } return absent;
  }, patient, { register: true, recordIntent: async () => {}, recordReceipt: async () => {} }));
  assert.equal(writes, 1);
});
