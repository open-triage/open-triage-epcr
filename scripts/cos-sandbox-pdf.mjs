// Fictional fixture only. No database access, application live-mode change or automatic write retry.
// Build the API first. prepare DIR | submit DIR [--inline] | verify DIR
// Optional hosted diagnostics: serve DIR [PORT] | submit DIR URL [--allow-http-synthetic]
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sandboxClient, assertSuccessful, searchAll } from './lib/cos-sandbox-client.mjs';
import { createSyntheticPdfServer } from './lib/cos-sandbox-pdf-server.mjs';
import { cosPdfItem, verifyCosPdfNote } from '../apps/api/dist/hospital/cos-pdf.js';

const patient = '194609073277', encounterId = '106952', externalId = '0f25a0cd-998c-48bb-8898-05e430fb1f7d';
const profile = 'https://fhir.cambio.se/StructureDefinition/';
const time = '2026-10-23T12:00:00+02:00';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, data, exclusive = false) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n',
  { mode: 0o600, flag: exclusive ? 'wx' : 'w' });

async function prepare(dir) {
  const { renderSignedReportPdf } = await import('../apps/api/dist/reports/signed-report-pdf.js');
  const { signedPdfFixture } = await import('../apps/api/tests/fixtures/signed-pdf-source.mjs');
  const { commandSha256 } = await import('../apps/api/dist/reports/draft-report.validation.js');
  const { buildCosVitals } = await import('../apps/api/dist/hospital/cos-vitals.js');
  const { source } = signedPdfFixture();
  const marker = 'FICTIONAL COS PDF CHECK ' + randomBytes(16).toString('hex');
  Object.assign(source, { reportId: externalId, signedAt: time, amendments: [], amendmentSequence: 0,
    signerDisplayName: 'EXTERNTEST — fictional COS sandbox clinician', photoBytes: {} });
  source.groups = [{ id: 'vitals', group_id: 'eVitals.VitalGroup', ordinal: 0, documented_time: time }];
  source.occurrences = [
    { id: 'given', element_id: 'ePatient.03', value_kind: 'text', value_text: 'Richard' },
    { id: 'family', element_id: 'ePatient.02', value_kind: 'text', value_text: 'Lindeskog (FICTIONAL COS SANDBOX)' },
    { id: 'pulse', element_id: 'eVitals.10', group_instance_id: 'vitals', value_kind: 'integer', value_integer: 72 },
    { id: 'respiration', element_id: 'eVitals.14', group_instance_id: 'vitals', value_kind: 'integer', value_integer: 16 },
    { id: 'temperature', element_id: 'eVitals.24', group_instance_id: 'vitals', value_kind: 'numeric', value_numeric: '36.7' },
  ];
  source.configuration.catalogFields['eVitals.14'] = { ...source.configuration.catalogFields['eVitals.10'], name: 'Respiratory rate (/min)', localization: undefined };
  source.configuration.catalogFields['eVitals.24'] = { ...source.configuration.catalogFields['eVitals.10'], name: 'Temperature (Cel)', localization: undefined };
  source.notes = [{ ...source.notes[0], capturedAt: time, normalizedText: marker + '\nFictional PDF ingestion test; no real patient data.' }];
  source.canonicalSha256 = commandSha256({ reportId: source.reportId, groups: source.groups, occurrences: source.occurrences, notes: source.notes });
  const mappings = [
    { id: 'pulse', source: { kind: 'nemsis', elementId: 'eVitals.10' }, vital: 'heartRate', unit: '/min', linkId: '364075005' },
    { id: 'respiration', source: { kind: 'nemsis', elementId: 'eVitals.14' }, vital: 'respiratoryRate', unit: '/min', linkId: '86290005' },
    { id: 'temperature', source: { kind: 'nemsis', elementId: 'eVitals.24' }, vital: 'bodyTemperature', unit: 'Cel', linkId: '276885007' },
  ];
  const context = { deliveryId: externalId, patient: { system: 'urn:oid:1.2.752.129.2.1.3.1', value: patient },
    encounter: { system: 'urn:opentriage:cos:sandbox:encounter', value: externalId },
    staff: 'SE20260202-EXTERNTEST', careUnit: 'SE-123testambulansstationO' };
  const vitals = buildCosVitals(source, mappings, context, 100);
  assert.equal(vitals.findings.length,0,'Synthetic vital projection must be complete');
  const pdf = await renderSignedReportPdf(source, 'en');
  mkdirSync(dir, { mode: 0o700 });
  writeFileSync(join(dir, 'report.pdf'), pdf, { mode: 0o600, flag: 'wx' });
  write(join(dir, 'source.json'), source, true);
  write(join(dir, 'manifest.json'), { synthetic: true, patient, encounterId, externalId, marker, time,
    sha256: hash(pdf), path: '/pdf/' + randomBytes(32).toString('hex') + '/report.pdf',
    expiresAt: Date.now() + 90 * 60 * 1000, context, vitals }, true);
  console.log(`Prepared fictional signed-report PDF and matching note vitals in ${dir}; no request sent.`);
}

function load(dir) {
  const m = read(join(dir, 'manifest.json'));
  assert.equal(m.synthetic, true); assert.equal(m.patient, patient); assert.equal(m.encounterId, encounterId);
  assert.equal(m.externalId, externalId); assert.match(m.marker, /^FICTIONAL COS PDF CHECK [a-f0-9]{32}$/);
  const pdf = readFileSync(join(dir, 'report.pdf'));
  assert.equal(hash(pdf), m.sha256, 'Prepared PDF changed');
  return { m, pdf };
}

async function verify(dir, m, request) {
  const expected = { patientId: '456', patientIdentifier: patient, encounterId, marker: m.marker,
    pdfKeyword: 'Fullständig ambulansanteckning' };
  const end = new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T00:00:00';
  const path = 'journalnotes/?' + new URLSearchParams({ 'api-version': 'v2',
    fromDateTime: m.time.slice(0, 10) + 'T00:00:00', toDateTime: end });
  // The journal read can briefly return the preceding active note after a 201.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await delay(5000);
    const r = await request(path, { extraHeaders: { patient } }); assertSuccessful(r);
    const extracts = (Array.isArray(r.body) ? r.body : [r.body]).flatMap(b => b.journalNoteEHRExtract ?? []);
    const own = extracts.filter(e => String(e.patient?.patientInternalID) === '456' &&
      String(e.hCMContact?.hCMContactInternalID) === encounterId);
    write(join(dir, `journal-read-${attempt}.json`), own);
    const result = verifyCosPdfNote(own, expected);
    write(join(dir, 'verification.json'), { ...result, sourcePdfSha256: m.sha256 });
    if (result.state !== 'pending' || attempt === 4) {
      console.log(JSON.stringify(result));
      if (result.state !== 'document-recorded') process.exitCode = 2;
      return result;
    }
    console.log('Current test note is not visible yet; waiting before read-only verification.');
  }
}

async function main() {
  const [command, folder, value, option] = process.argv.slice(2);
  assert.ok(['prepare', 'serve', 'submit', 'verify'].includes(command) && folder,
    'Usage: cos-sandbox-pdf.mjs prepare DIR | serve DIR [PORT] | submit DIR [--inline|URL] [--allow-http-synthetic] | verify DIR');
  const dir = resolve(folder);
  if (command === 'prepare') return prepare(dir);
  const { m, pdf } = load(dir);
  if (command === 'serve') {
    const port = Number(value ?? '18764'); assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
    assert.ok(m.expiresAt > Date.now(), 'PDF capability expired; prepare a new fixture');
    const server = createSyntheticPdfServer({ bytes: pdf, path: m.path, expiresAt: m.expiresAt,
      onRequest: r => appendFileSync(join(dir, 'requests.jsonl'), JSON.stringify(r) + '\n', { mode: 0o600 }) });
    const stop = () => server.close(() => process.exit(0));
    server.listen(port, '127.0.0.1', () => console.log(`Serving one fictional PDF on loopback port ${port}; path is in manifest.json.`));
    server.on('error', () => { console.error('PDF server could not listen'); process.exitCode = 1; });
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    setTimeout(stop, m.expiresAt - Date.now()).unref(); return;
  }
  if (command === 'verify') return verify(dir, m, await sandboxClient());
  const inline = !value || value === '--inline';
  assert.ok(inline ? !option : (!option || option === '--allow-http-synthetic'));
  let item, transport;
  if (inline) {
    item = cosPdfItem('772786005', { kind: 'inline', bytes: pdf }); transport = 'inline';
  } else {
    assert.ok(m.expiresAt > Date.now(), 'PDF capability expired; prepare a new fixture');
    const url = new URL(value), diagnostic = url.protocol === 'http:' && option === '--allow-http-synthetic';
    // Plaintext is permitted only for this fixed fictional-patient diagnostic.
    // The shared application builder accepts inline bytes or HTTPS URLs.
    item = cosPdfItem('772786005', { kind: 'https', url: diagnostic ? value.replace(/^http:/, 'https:') : value });
    transport = url.protocol;
    if (diagnostic) { item.answer[0].valueUri = value; console.log('HTTP diagnostic enabled for the fixed fictional fixture only.'); }
    const preflight = await fetch(value, { redirect: 'error', headers: { 'User-Agent': 'OpenTriage-PDF-preflight' }, signal: AbortSignal.timeout(20000) });
    assert.equal(preflight.status, 200); assert.match(preflight.headers.get('content-type') ?? '', /^application\/pdf(?:;|$)/i);
    assert.equal(hash(Buffer.from(await preflight.arrayBuffer())), m.sha256, 'Public endpoint must return the exact prepared PDF');
  }
  const request = await sandboxClient(process.env, { write: true });
  const q = new URLSearchParams({ 'subject.identifier': m.context.patient.system + '|' + patient,
    _profile: profile + 'EncounterOutpatientReadSe', _id: encounterId });
  const found = await searchAll(request, 'fhir/Encounter?' + q);
  assert.ok(found.resources.some(r => r.id === encounterId && r.identifier?.some(i =>
    i.system === m.context.encounter.system && i.value === externalId)), 'Owned fictional contact not verified');
  const lastUpdated = new Date(Date.now() - 120000).toISOString();
  const bundle = { resourceType: 'Bundle', id: externalId, type: 'collection',
    meta: { profile: [profile + 'BundlePrehospitalNote/v2'], lastUpdated }, entry: [
      { fullUrl: 'urn:uuid:' + externalId, resource: { resourceType: 'QuestionnaireResponse', id: externalId,
        meta: { profile: [profile + 'QuestionnaireResponsePreHospitalNote/v2'], lastUpdated },
        identifier: { system: 'urn:opentriage:cos:sandbox-test', value: externalId }, status: 'completed',
        subject: { type: 'Patient', identifier: m.context.patient }, encounter: { identifier: m.context.encounter },
        authored: m.time, author: { type: 'Practitioner', identifier: { system: 'urn:oid:1.2.752.129.2.1.4.1', value: m.context.staff } },
        item: [...m.vitals.items, { linkId: '263490005', answer: [{ valueString: m.marker }] }, item] } },
      ...structuredClone(m.vitals.entries),
    ] };
  for (const entry of bundle.entry) entry.resource.meta.lastUpdated = lastUpdated;
  const { COS_SIMULATOR_LIMITS } = await import('../apps/api/dist/hospital/cos-payload.js');
  assert.ok(Buffer.byteLength(JSON.stringify(bundle)) <= COS_SIMULATOR_LIMITS.bundleBytes, 'Encoded bundle exceeds local export limit');
  write(join(dir, 'payload.json'), bundle, true);
  write(join(dir, 'attempt.json'), { at: new Date().toISOString(), sourcePdfSha256: m.sha256,
    payloadSha256: hash(JSON.stringify(bundle)), transport }, true);
  const receipt = await request('fhir/subscription/Bundle/' + externalId, { method: 'PUT', body: bundle });
  write(join(dir, 'receipt.json'), receipt); assertSuccessful(receipt);
  console.log(`COS accepted HTTP ${receipt.status}; checking document storage separately.`);
  await verify(dir, m, request);
}

main().catch(() => { console.error('PDF test stopped; inspect private local evidence. No automatic write retry was performed.'); process.exitCode = 1; });
