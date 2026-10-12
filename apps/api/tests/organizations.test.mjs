import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DEFAULT_AGENCY_APPEARANCE } from '@open-triage/contracts';
import { agencyHostname, validateCreateAgency, validateUpdateAgency } from '../dist/admin/organizations.validation.js';
import { browserOrigin, agencyRequest } from '../dist/sessions/agency-context.js';
import { AgencyDirectoryService } from '../dist/sessions/agency-directory.service.js';

const command = () => ({ name: 'EMS', hostname: 'Test.OpenTriage.org', parentOrganizationId: null,
  catalogReleaseId: randomUUID(), timeZone: 'Europe/Stockholm', agencyNumber: '1', agencyUniqueStateId: '1', stateCode: 'TEST' });
test('agency configuration accepts exact hostnames and rejects URLs, wildcards and invalid group changes', () => {
  assert.equal(validateCreateAgency(command()).hostname, 'test.opentriage.org');
  assert.equal(agencyHostname(''), null);
  for (const value of ['https://test.opentriage.org', 'test.opentriage.org:443', '*.opentriage.org', 'a..test', '-bad.test', 'a'.repeat(64)+'.test', 'test.org/path'])
    assert.throws(() => agencyHostname(value));
  assert.throws(() => validateCreateAgency({ ...command(), timeZone: 'Mars/Base' }));
  assert.throws(() => validateCreateAgency({ ...command(), parentOrganizationId: 'not-an-id' }));
  assert.throws(() => validateUpdateAgency({ name: 'EMS', active: true, expectedRevision: 1, parentOrganizationId: null }), /Existing agencies cannot move between agency groups/);
});
test('request context ignores forwarded hostnames and isolates simultaneous requests', async () => {
  assert.equal(browserOrigin({ protocol: 'https', headers: { host: 'test.opentriage.org', 'x-forwarded-host': 'untrusted.test' } }), 'https://test.opentriage.org');
  assert.throws(() => browserOrigin({ headers: { origin: 'https://user:password@test.org' } }));
  assert.throws(() => browserOrigin({ headers: { origin: 'null' } }));
  const values = await Promise.all(['one', 'two'].map(origin => agencyRequest.run({ origin }, async () => {
    await new Promise(resolve => setTimeout(resolve, 1)); return agencyRequest.getStore().origin;
  })));
  assert.deepEqual(values, ['one', 'two']);
  assert.equal(agencyRequest.getStore(), undefined);
});
test('disabled registered portal hosts cannot fall back to generic login', async () => {
  const original = process.env.WEB_ORIGIN;
  process.env.WEB_ORIGIN = 'https://test.opentriage.org';
  try {
    const service = new AgencyDirectoryService({ manager: { query: async () => [{ active: false, root_active: true }] } });
    await assert.rejects(agencyRequest.run({ origin: process.env.WEB_ORIGIN }, () => service.forLogin()), /No active agency/);
  } finally {
    if (original === undefined) delete process.env.WEB_ORIGIN; else process.env.WEB_ORIGIN = original;
  }
});

test('starting configurations are optional but must be a valid form and validation pair', () => {
  assert.equal(validateCreateAgency(command()).startingFormVersionId, null);
  const form = randomUUID(), validation = randomUUID();
  const result = validateCreateAgency({ ...command(), startingFormVersionId: form, startingValidationVersionId: validation });
  assert.equal(result.startingFormVersionId, form);
  assert.equal(result.startingValidationVersionId, validation);
  for (const pair of [{ startingFormVersionId: form }, { startingValidationVersionId: validation },
    { startingFormVersionId: 'bad', startingValidationVersionId: validation },
    { startingFormVersionId: form, startingValidationVersionId: {} }]) {
    assert.throws(() => validateCreateAgency({ ...command(), ...pair }));
  }
});

test('short hostnames resolve consistently for creation and editing against the configured installation domain', () => {
  const priorDomain = process.env.AGENCY_BASE_DOMAIN, priorOrigin = process.env.WEB_ORIGIN;
  try {
    process.env.WEB_ORIGIN = 'https://admin.example.test';
    delete process.env.AGENCY_BASE_DOMAIN;
    assert.equal(agencyHostname(' Ambulance '), 'ambulance.admin.example.test');
    process.env.AGENCY_BASE_DOMAIN = 'Example.Test';
    assert.equal(validateCreateAgency({ ...command(), hostname: 'Ambulance' }).hostname, 'ambulance.example.test');
    assert.equal(validateUpdateAgency({ name: 'EMS', hostname: 'ambulance', active: true, expectedRevision: 1 }).hostname, 'ambulance.example.test');
    assert.equal(agencyHostname('custom.other.test'), 'custom.other.test');
    for (const name of ['https://host', 'a/b', '*', '-bad', 'x'.repeat(64)]) assert.throws(() => agencyHostname(name));
    delete process.env.AGENCY_BASE_DOMAIN;
    process.env.WEB_ORIGIN = 'http://127.0.0.1:3000';
    assert.throws(() => agencyHostname('ambulance'));
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    assert.equal(agencyHostname('ambulance'), 'ambulance.localhost');
  } finally {
    if (priorDomain === undefined) delete process.env.AGENCY_BASE_DOMAIN; else process.env.AGENCY_BASE_DOMAIN = priorDomain;
    if (priorOrigin === undefined) delete process.env.WEB_ORIGIN; else process.env.WEB_ORIGIN = priorOrigin;
  }
});

test('creation validates the shared agency settings and derives demographics and timezone from them', () => {
  const settings = { language: 'sv', regionalFormat: 'sv-SE', timeZone: 'Europe/Stockholm',
    appearance: DEFAULT_AGENCY_APPEARANCE, reportMediaAllowanceBytes: 50 * 1024 * 1024, imageMediaLimitBytes: 10 * 1024 * 1024,
    demographics: { agencyUniqueStateId: 'STATE', agencyNumber: 'AGENCY', stateCode: '36',
      stateDisplay: 'New York', stateCodeSystem: 'ANSI-STATE', stateTerminologyVersion: null } };
  const validated = validateCreateAgency({ ...command(), timeZone: 'UTC', settings });
  assert.equal(validated.agencyNumber, 'AGENCY');
  assert.equal(validated.stateCode, '36');
  assert.equal(validated.timeZone, 'Europe/Stockholm');
  assert.equal(validated.settings.language, 'sv');
  assert.throws(() => validateCreateAgency({ ...command(), settings: { ...settings, timeZone: 'Invalid/Zone' } }));
  assert.throws(() => validateCreateAgency({ ...command(), settings: { ...settings, demographics: { ...settings.demographics, stateCode: 'TEST' } } }));
});

test('local agency origins require the web port, an active agency and development mode', async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, WEB_ORIGIN: process.env.WEB_ORIGIN };
  let row = { active: true, root_active: true };
  let parameters;
  const service = new AgencyDirectoryService({ manager: { query: async (_, values) => { parameters = values; return row ? [row] : []; } } });
  try {
    process.env.NODE_ENV = 'development';
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    assert.equal(await service.allowsOrigin('http://test.localhost:3000'), true);
    assert.deepEqual(parameters, ['test.localhost', null]);
    assert.equal(await service.allowsOrigin('http://demo.localhost:3000'), true);
    assert.ok(parameters[1]);
    await agencyRequest.run({ origin: 'http://demo.localhost:3000' }, () => service.forLogin());
    assert.ok(parameters[1]);
    for (const origin of ['http://test.localhost:3001', 'http://test.localhost.evil.test:3000', 'http://test.localhost:3000/path']) {
      assert.equal(await service.allowsOrigin(origin), false);
    }
    row = { active: true, root_active: false };
    assert.equal(await service.allowsOrigin('http://test.localhost:3000'), false);
    row = undefined;
    assert.equal(await service.allowsOrigin('http://unknown.localhost:3000'), false);
    await assert.rejects(agencyRequest.run({ origin: 'http://unknown.localhost:3000' }, () => service.forLogin()), /No active agency/);
    process.env.NODE_ENV = 'production';
    row = { active: true, root_active: true };
    assert.equal(await service.allowsOrigin('http://demo.localhost:3000'), false);
    assert.equal(await service.allowsOrigin('https://agency.example.org'), true);
    assert.deepEqual(parameters, ['agency.example.org', null]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
