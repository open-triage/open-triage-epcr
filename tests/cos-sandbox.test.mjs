import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalHeaders, sandboxUrl, searchAll, assertSuccessful } from '../scripts/lib/cos-sandbox-client.mjs';
import { matchesObservation, verifyNews2 } from '../scripts/lib/cos-sandbox-verification.mjs';

const profile = 'https://fhir.cambio.se/StructureDefinition/';
const code = value => ({ coding: [{ system: 'http://snomed.info/sct', code: value }] });
function fixture() {
  const common = { resourceType: 'Observation', status: 'final', subject: { reference: 'Patient/456' },
    encounter: { reference: 'Encounter/106952' }, effectiveDateTime: '2026-10-23T12:00:00+02:00' };
  const expected = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(common), id: `external-${index}`,
    meta: { profile: [profile + `TestVital${index}/v1`] }, code: code(String(index)),
    valueQuantity: { value: 70 + index, unit: '/min', system: 'http://unitsofmeasure.org', code: '/min' } }));
  const news = { ...structuredClone(common), id: 'external-news', meta: { profile: [profile + 'ObservationNews2Lite/v1'] }, code: code('1104051000000101') };
  const stored = expected.map((r, i) => ({ ...structuredClone(r), id: String(100 + i) }));
  const storedNews = { ...structuredClone(news), id: '200', valueQuantity: { value: 0 }, derivedFrom: stored.map(r => ({ reference: `Observation/${r.id}` })) };
  return { bundle: { entry: [news, ...expected].map(resource => ({ resource })) }, resources: [storedNews, ...stored], expected, stored };
}
const verify = f => verifyNews2(f.bundle, f.resources, '200', 'Patient/456', 'Encounter/106952');

test('clinical requests always negotiate the language that avoids COS clinical-module failures', () => {
  assert.equal(clinicalHeaders('test-token', 'test-key')['Accept-Language'], 'sv-SE');
  assert.equal(clinicalHeaders('test-token', 'test-key').Prefer, 'return=OperationOutcome');
});

test('read-back links cannot send credentials outside the expected sandbox API', () => {
  assert.equal(sandboxUrl('fhir/Observation/_search').origin, 'https://api.openservices.cambio.se');
  for (const bad of ['https://example.com/api/open/fhir', 'http://api.openservices.cambio.se/api/open/fhir',
    'https://user@api.openservices.cambio.se/api/open/fhir', '/auth/realms/COS', '../../elsewhere']) {
    assert.throws(() => sandboxUrl(bad));
  }
});

test('verification follows pagination and rejects cycles and failed FHIR responses', async () => {
  const calls = [];
  const result = await searchAll(async url => {
    calls.push(url);
    return { status: 200, body: { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: { id: String(calls.length) } }],
      link: calls.length === 1 ? [{ relation: 'next', url: 'https://api.openservices.cambio.se/api/open/fhir?page=2' }] : [] } };
  }, 'fhir/Observation/_search');
  assert.equal(result.resources.length, 2);
  await assert.rejects(searchAll(async url => ({ status: 200, body: { resourceType: 'Bundle', type: 'searchset', link: [{ relation: 'next', url }] } }), 'fhir/Observation/_search'), /cycle/);
  assert.throws(() => assertSuccessful({ status: 200, body: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', diagnostics: 'Older update ignored' }] } }));
});

test('six structured observations must be linked from the exact NEWS2 ID', () => {
  assert.equal(verify(fixture()).observations.length, 6);
  const f = fixture(); f.resources[0].derivedFrom[0].reference = 'Observation/999';
  assert.throws(() => verify(f), /Missing or ambiguous/);
  const g = fixture(); g.resources[0].id = '201';
  assert.throws(() => verify(g), /exact NEWS2 ID/);
});

test('matching numbers in text, another patient/contact, wrong time or wrong units never verify', () => {
  const changes = [
    r => { r.subject.reference = 'Patient/8'; }, r => { r.encounter.reference = 'Encounter/83499'; },
    r => { r.effectiveDateTime = '2026-10-23T13:00:00+02:00'; }, r => { r.valueQuantity.unit = 'Cel'; },
    r => { r.valueQuantity.value = '70'; }, r => { r.code = code('wrong'); },
    r => { r.status = 'entered-in-error'; }, r => { r.valueString = '70 /min'; delete r.valueQuantity; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f.resources[1]);
    assert.throws(() => verify(f));
  }
});

test('blood pressure component codes/units and coded ACVPU values must match', () => {
  const f = fixture(), expected = structuredClone(f.expected[0]);
  delete expected.valueQuantity;
  expected.component = [{ code: code('systolic'), valueQuantity: { value: 120, code: 'mm[Hg]', system: 'http://unitsofmeasure.org' } },
    { code: code('diastolic'), valueQuantity: { value: 80, code: 'mm[Hg]', system: 'http://unitsofmeasure.org' } }];
  const actual = structuredClone(expected);
  assert.ok(matchesObservation(actual, expected, 'Patient/456', 'Encounter/106952'));
  actual.component.reverse();
  assert.ok(matchesObservation(actual, expected, 'Patient/456', 'Encounter/106952'));
  actual.component[0].valueQuantity.value = 120;
  assert.ok(!matchesObservation(actual, expected, 'Patient/456', 'Encounter/106952'));
  delete expected.component; expected.valueCodeableConcept = code('248234008');
  assert.ok(matchesObservation(expected, expected, 'Patient/456', 'Encounter/106952'));
  assert.ok(!matchesObservation({ ...expected, valueCodeableConcept: code('422768004') }, expected, 'Patient/456', 'Encounter/106952'));
});
