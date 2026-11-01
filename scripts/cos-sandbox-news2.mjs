// Synthetic fixture only; no database, production configuration, or app live-mode changes.
// Build API first. Commands: prepare FILE | submit FILE | verify FILE [RECEIPT]
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sandboxClient, sandboxUrl, assertSuccessful, searchAll } from './lib/cos-sandbox-client.mjs';
import { verifyNews2 } from './lib/cos-sandbox-verification.mjs';

const profileBase = 'https://fhir.cambio.se/StructureDefinition/';
const patient = '194609073277', patientReference = 'Patient/456';
const coding = (loinc, snomed) => ({ coding: [
  ...(loinc ? [{ system: 'http://loinc.org', code: loinc }] : []),
  { system: 'http://snomed.info/sct', code: snomed },
] });
const quantity = (value, unit) => ({ value, unit, system: 'http://unitsofmeasure.org', code: unit });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value, exclusive = false) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function prepare(file) {
  const { buildCosVitals } = await import('../apps/api/dist/hospital/cos-vitals.js');
  const time = process.env.COS_SANDBOX_MEASUREMENT_TIME;
  assert.ok(time && Number.isFinite(Date.parse(time)), 'Set COS_SANDBOX_MEASUREMENT_TIME to a complete, past timestamp');
  assert.ok(Date.parse(time) <= Date.now(), 'Measurement/update time must not be in the future');
  const encounterReference = process.env.COS_SANDBOX_PREHOSPITAL_ENCOUNTER_REFERENCE;
  assert.match(encounterReference ?? '', /^Encounter\/\d+$/, 'Set the verified synthetic ambulance encounter reference');
  const id = randomUUID();
  const source = { reportId:id, signedAt: time, amendments: [], groups: [{ id: 'vitals', group_id: 'eVitals.VitalGroup', documented_time: time }], occurrences: [
    { id: 'pulse', element_id: 'eVitals.10', group_instance_id: 'vitals', value_kind: 'integer', value_integer: 78 },
    { id: 'respiration', element_id: 'eVitals.14', group_instance_id: 'vitals', value_kind: 'integer', value_integer: 17 },
    { id: 'temperature', element_id: 'eVitals.24', group_instance_id: 'vitals', value_kind: 'numeric', value_numeric: '36.9' },
  ] };
  const mappings = [
    { id: 'pulse', source: { kind: 'nemsis', elementId: 'eVitals.10' }, vital: 'heartRate', unit: '/min', linkId: '364075005' },
    { id: 'respiration', source: { kind: 'nemsis', elementId: 'eVitals.14' }, vital: 'respiratoryRate', unit: '/min', linkId: '86290005' },
    { id: 'temperature', source: { kind: 'nemsis', elementId: 'eVitals.24' }, vital: 'bodyTemperature', unit: 'Cel', linkId: '276885007' },
  ];
  const { entries,findings } = buildCosVitals(source, mappings, {
    deliveryId: id, patient: { system: 'urn:oid:1.2.752.129.2.1.3.1', value: patient },
    encounter: { system: 'urn:opentriage:cos:sandbox:encounter', value: id },
    staff: 'SE20260202-EXTERNTEST', careUnit: 'SE-123testambulansstationO',
  }, 100);
  assert.equal(findings.length,0,'Synthetic vital projection must be complete');
  const vitals = entries.map(e => e.resource);
  for (const r of vitals) {
    // Read-confirmed sandbox IDs, not an invented business identifier for an existing contact.
    r.subject = { type: 'Patient', reference: patientReference };
    r.encounter = { type: 'Encounter', reference: encounterReference };
    r.performer = [{ type: 'Practitioner', reference: 'Practitioner/1038' }, { type: 'Organization', reference: 'Organization/2152' }];
  }
  const base = (profile, code) => {
    const r = structuredClone(vitals[0]); r.id = randomUUID();
    r.meta.profile = [profileBase + profile + '/v1']; r.code = code; delete r.valueQuantity;
    return r;
  };
  const bp = base('ObservationBPLite', coding('85354-9', '75367002'));
  bp.component = [
    { code: coding('8480-6', '271649006'), valueQuantity: quantity(120, 'mm[Hg]') },
    { code: coding('8462-4', '271650006'), valueQuantity: quantity(80, 'mm[Hg]') },
  ];
  const acvpu = base('ObservationAcvpuLite', coding(null, '1104441000000107'));
  acvpu.valueCodeableConcept = coding(null, '248234008');
  const spo2 = base('ObservationOxygenSaturationLite', coding('2708-6', '103228002'));
  spo2.valueQuantity = quantity(98, '%');
  spo2.extension = [{ url: profileBase + 'saturation-hypercapnicRespiratoryFailure/v1', valueBoolean: false }];
  vitals.push(bp, acvpu, spo2);
  const news = base('ObservationNews2Lite', coding(null, '1104051000000101'));
  delete news.category; news.performer = [{ type: 'Practitioner', reference: 'Practitioner/1038' }];
  news.derivedFrom = vitals.map(r => ({ type: 'Observation', reference: `urn:uuid:${r.id}` }));
  // Deliberately omit the score: COS calculates it from the complete fictional set.
  write(file, { resourceType: 'Bundle', id, type: 'collection', meta: {
    profile: [profileBase + 'BundleNews2/v1'], lastUpdated: time,
  }, entry: [news, ...vitals].map(resource => ({ fullUrl: `urn:uuid:${resource.id}`, resource })) }, true);
  console.log(`Prepared fictional NEWS2 fixture: ${file}. No request sent.`);
}

async function run() {
  const [command, path, receiptPath] = process.argv.slice(2);
  assert.ok(['prepare', 'submit', 'verify'].includes(command) && path, 'Usage: cos-sandbox-news2.mjs prepare|submit|verify FILE [RECEIPT]');
  const file = resolve(path), receiptFile = receiptPath ? resolve(receiptPath) : `${file}.receipt.json`;
  if (command === 'prepare') return prepare(file);
  const bundle = read(file);
  assert.equal(bundle.meta?.profile?.[0], profileBase + 'BundleNews2/v1');
  assert.match(bundle.id, /^[a-zA-Z0-9.-]{1,64}$/);
  assert.equal(bundle.entry?.length, 7, 'Expected NEWS2 plus six fictional vitals');
  const encounterReference = bundle.entry[0].resource.encounter?.reference;
  assert.match(encounterReference ?? '', /^Encounter\/\d+$/);
  for (const { resource } of bundle.entry) {
    assert.equal(resource.resourceType, 'Observation');
    assert.equal(resource.subject?.reference, patientReference, 'Only the documented synthetic fixture is allowed');
    assert.equal(resource.encounter?.reference, encounterReference);
  }
  const request = await sandboxClient(process.env, { write: command === 'submit' });
  const query = new URL('fhir/Encounter', 'https://api.openservices.cambio.se/api/open/');
  query.searchParams.set('subject.identifier', `urn:oid:1.2.752.129.2.1.3.1|${patient}`);
  query.searchParams.set('_profile', profileBase + 'EncounterOutpatientReadSe');
  query.searchParams.set('_id', encounterReference.split('/')[1]);
  const encounterSearch = await searchAll(request, query);
  const encounters = encounterSearch.resources.filter(r => r.resourceType === 'Encounter' && `Encounter/${r.id}` === encounterReference);
  assert.equal(encounters.length, 1, 'The selected encounter must be readable');
  assert.equal(encounters[0].subject?.reference, patientReference);
  assert.ok(encounters[0].identifier?.some(i => i.system === 'urn:opentriage:cos:sandbox:encounter'), 'Use our dedicated synthetic prehospital encounter');
  if (command === 'submit') {
    assert.ok(!existsSync(receiptFile), 'Receipt already exists; run verify instead of resending');
    write(`${file}.attempt.json`, { payloadSha256: hash(bundle), attemptedAt: new Date().toISOString() }, true);
    const receipt = await request(`fhir/subscription/Bundle/${bundle.id}`, { method: 'PUT', body: bundle });
    write(receiptFile, { ...receipt, payloadSha256: hash(bundle) }, true);
    assertSuccessful(receipt);
    assert.equal(receipt.status, 201, 'Expected new creation; inspect OperationOutcome before treating HTTP 200 as success');
    console.log(`Created: ${receipt.contentLocation}. Receipt: ${receiptFile}`);
    // No automatic retries: a timeout/500 may have committed, and an unchanged PUT may be ignored.
  }
  const receipt = read(receiptFile); assertSuccessful(receipt);
  if (receipt.payloadSha256) assert.equal(receipt.payloadSha256, hash(bundle), 'Payload changed since submission');
  const location = sandboxUrl(receipt.contentLocation ?? receipt.location);
  const match = location.pathname.match(/\/fhir\/Observation\/(\d+)$/);
  assert.ok(match, 'A stored NEWS2 Observation ID is required for verification');
  const resources = [], searches = [];
  for (const { resource } of bundle.entry) {
    const time = new Date(resource.effectiveDateTime);
    assert.ok(Number.isFinite(time.getTime()), 'Invalid measurement time');
    const url = new URL('fhir/Observation/_search', 'https://api.openservices.cambio.se/api/open/');
    url.searchParams.set('patient', '456');
    url.searchParams.append('date', 'ge' + new Date(time.getTime() - 86400000).toISOString().slice(0, 10));
    url.searchParams.append('date', 'le' + new Date(time.getTime() + 86400000).toISOString().slice(0, 10));
    url.searchParams.set('_profile', resource.meta.profile[0]);
    const result = await searchAll(request, url); resources.push(...result.resources); searches.push(...result.receipts);
  }
  const report = verifyNews2(bundle, resources, match[1], patientReference, encounterReference);
  write(`${file}.verification.json`, { report, encounter: encounterSearch.receipts, searches });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Independent read-back evidence: ${file}.verification.json`);
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
