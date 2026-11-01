// Explicit setup of the checked-in fictional Ville fixture only; never real patients.
// Usage: node --env-file=.env.local scripts/cos-sandbox-patient.mjs verify|register DIR
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandboxClient, assertSuccessful } from './lib/cos-sandbox-client.mjs';

const profile = 'https://fhir.cambio.se/StructureDefinition/PatientSe/v1';
const system = 'urn:oid:1.2.752.129.2.1.3.3';
const value = '201304822172';
export function villePatient(bundle) {
  const patients = bundle.entry.filter(e => e.resource?.resourceType === 'Patient');
  assert.equal(patients.length, 1);
  const p = patients[0].resource;
  assert.deepEqual(p.identifier, [{ system: 'http://electronichealth.se/identifier/samordningsnummer', value }]);
  assert.equal(p.birthDate, '2013-04-22');
  assert.equal(p.gender, 'male');
  assert.equal(p.name.length, 1);
  // PatientSe forbids EPS name.use/name.text and has read-only address/telecom.
  return { resourceType: 'Patient', meta: { profile: [profile] }, identifier: [{ system, value }],
    name: p.name.map(({ family, given }) => ({ family, given })), gender: p.gender, birthDate: p.birthDate };
}
export function verifyVillePatient(bundle, expected) {
  assert.equal(bundle.resourceType, 'Bundle');
  assert.equal(bundle.type, 'searchset');
  assert.ok(!bundle.link?.some(l => l.relation === 'next'), 'Ambiguous patient search');
  assert.equal(bundle.entry?.length, 1, 'Expected exactly one patient');
  const p = bundle.entry[0].resource;
  assert.equal(p.resourceType, 'Patient');
  assert.match(p.id, /^[A-Za-z0-9.-]{1,100}$/);
  assert.ok(p.identifier?.some(i => i.system === system && i.value === value), 'Coordination identity mismatch');
  assert.deepEqual(p.name.map(({ family, given }) => ({ family, given })), expected.name);
  assert.equal(p.birthDate, expected.birthDate);
  assert.equal(p.gender, expected.gender);
  return p.id;
}
export async function ensureVillePatient(request, expected, { register = false, recordIntent, recordReceipt } = {}) {
  const path = 'fhir/Patient/_search?' + new URLSearchParams({ identifier: `${system}|${value}`, _profile: profile });
  const before = await request(path);
  if (before.status === 200) return verifyVillePatient(before.body, expected);
  const issues = before.body?.issue;
  const absent = before.status === 404 && before.body?.resourceType === 'OperationOutcome' &&
    issues?.length === 1 && issues[0].severity === 'error' && issues[0].code === 'processing' &&
    issues[0].diagnostics === 'Patient Not found for the given identifier';
  assert.ok(absent && register, 'Patient lookup failed; no registration performed');
  // Exclusive durable intent prevents retrying an ambiguous POST even after restart.
  await recordIntent({ method: 'POST', path: 'fhir/Patient', resource: expected });
  const receipt = await request('fhir/Patient', { method: 'POST', body: expected });
  await recordReceipt(receipt);
  assertSuccessful(receipt);
  const after = await request(path);
  assertSuccessful(after);
  return verifyVillePatient(after.body, expected);
}
async function main() {
  const [command, directory] = process.argv.slice(2);
  assert.ok(['verify', 'register'].includes(command) && directory, 'Usage: verify|register DIR');
  const bundle = JSON.parse(await readFile(new URL('../apps/api/tests/fixtures/hospital/ville.json', import.meta.url), 'utf8'));
  const expected = villePatient(bundle);
  const request = await sandboxClient(process.env, { write: command === 'register' });
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const save = (name, data) => writeFile(join(dir, name), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
  const id = await ensureVillePatient(request, expected, { register: command === 'register',
    recordIntent: data => save('patient-intent.json', data), recordReceipt: data => save('patient-receipt.json', data) });
  console.log(JSON.stringify({ patientVerified: true, remoteId: id }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
