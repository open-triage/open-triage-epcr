import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { compileValidationRule } from '@open-triage/contracts';
import { parseOptions, seededRandom, serviceTime, operationalTimeline } from '../scripts/lib/synthetic-record-options.mjs';
import { generateDocument, documentMutations, validationProblems } from '../scripts/lib/synthetic-record-generator.mjs';
import { selectAgencyUser, agencyUserContext } from '../scripts/lib/synthetic-record-users.mjs';

const args = ['--agency', '32000000-0000-4000-8000-000000000001', '--username', 'demo', '--count', '25', '--from', '2026-09-01', '--to', '2026-09-30'];
test('CLI rejects malformed counts, dates, ranges and unknown options before connecting', () => {
  assert.equal(parseOptions(args, new Date('2026-10-04')).status, 'signed');
  for (const [key, invalid] of [['count', '0'], ['count', '-1'], ['count', '1.5'], ['count', '10001'],
    ['from', '2026-02-30'], ['from', '2026-10-01'], ['to', '2026-10-04'], ['status', 'final'], ['agency', 'wrong']]) {
    const changed = [...args];
    const index = changed.indexOf(`--${key}`);
    if (index >= 0) changed[index + 1] = invalid; else changed.push(`--${key}`, invalid);
    assert.throws(() => parseOptions(changed, new Date('2026-10-04')), /--/);
  }
  assert.throws(() => parseOptions([...args, '--surprise']), /Unknown option/);
  assert.deepEqual(parseOptions(['--help']), { help: true });
  const withoutUser = args.filter((value, index) => ![args.indexOf('--username'), args.indexOf('--username') + 1].includes(index));
  assert.equal(parseOptions(withoutUser, new Date('2026-10-04')).username, undefined);
  assert.throws(() => parseOptions([...withoutUser, '--username', ' '], new Date('2026-10-04')), /--username must be non-empty/);
});

test('assignment is uniform across users regardless of assigned unit count and repeatable with a seed', () => {
  const users = [{ id: 'a', units: [{ id: 'a1' }] }, { id: 'b', units: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] }];
  const random = seededRandom('assignment');
  const counts = { a: 0, b: 0 }, units = new Set();
  const first = selectAgencyUser(users, random);
  assert.deepEqual(first, selectAgencyUser(users, seededRandom('assignment')));
  for (let i = 0; i < 10000; i++) {
    const { user, unit } = selectAgencyUser(users, random);
    counts[user.id]++; units.add(unit.id);
  }
  assert.ok(counts.a > 4800 && counts.a < 5200);
  assert.equal(units.size, 4);
  assert.throws(() => selectAgencyUser([], random), /No active agency users/);
});

test('CLI authority rechecks current permissions and rejects unrelated capabilities and invalid tokens', async () => {
  let enabled = true;
  const user = { id: 'user', display_name: 'Fixture', organization_name: 'Agency', units: [{ id: 'unit' }] };
  const db = { query: async (_, parameters) => {
    assert.equal(parameters[0], 'agency');
    assert.equal(parameters[2], 'user');
    assert.equal(parameters[3], false);
    return enabled ? [user] : [];
  } };
  const context = agencyUserContext(db, 'agency', user);
  assert.equal((await context.sessions.requireCapability(context.sessionToken, 'clinical:demo')).user.id, 'user');
  await assert.rejects(context.sessions.requireCapability('bad-token', 'clinical:demo'), /Invalid synthetic CLI authority/);
  await assert.rejects(context.sessions.requireCapability(context.sessionToken, 'admin:users'), /Invalid synthetic CLI authority/);
  await assert.rejects(context.sessions.assertCsrf(context.sessionToken, 'bad-csrf'), /Invalid synthetic CLI CSRF/);
  enabled = false;
  await assert.rejects(context.sessions.requireCapability(context.sessionToken, 'clinical:document'), /no longer has/);
});

test('seeded service dates cover the range and favor daytime with varied, ordered, skewed durations', () => {
  const options = parseOptions(args, new Date('2026-10-04'));
  const random = seededRandom('distribution');
  const hours = new Array(24).fill(0), days = new Set(), durations = [], times = [];
  for (let index = 0; index < 2000; index++) {
    const at = serviceTime(options, random), timeline = operationalTimeline(at, random);
    days.add(at.toISOString().slice(0, 10)); hours[at.getUTCHours()]++;
    const ordered = ['01', '02', '03', '04', '05', '06', '07', '09', '11', '12', '13', '14', '15'].map(suffix => Date.parse(timeline[`eTimes.${suffix}`]));
    assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);
    assert.ok(Object.values(timeline).every(value => value.slice(0, 10) === at.toISOString().slice(0, 10)));
    durations.push((Date.parse(timeline['eTimes.06']) - Date.parse(timeline['eTimes.05'])) / 60000);
    times.push(at.toISOString());
  }
  assert.equal(days.size, 30);
  assert.ok(hours.slice(8, 20).reduce((a, b) => a + b) > 2 * hours.slice(0, 6).reduce((a, b) => a + b));
  durations.sort((a, b) => a - b);
  assert.ok(durations[1000] > 7 && durations[1000] < 11);
  assert.ok(durations[1900] > durations[1000] * 1.8);
  assert.ok(new Set(durations).size > 1000);
  const rerun = seededRandom('distribution');
  assert.equal(serviceTime(options, rerun).toISOString(), times[0]);
});

function fixture(sources = []) {
  const versionId = randomUUID(), releaseId = randomUUID();
  const model = { groups: [{ id: 'PatientCareReportGroup', parent: null }], elements: [
    { id: 'eVitals.10', base: 'integer', minimum: 0, maximum: 1, path: ['PatientCareReportGroup'],
      definition: { datatype: { constraints: { minInclusive: 20, maxInclusive: 250 } }, valueSource: { kind: 'scalar' } } },
    { id: 'eSituation.02', base: 'string', minimum: 0, maximum: 1, path: ['PatientCareReportGroup'],
      definition: { datatype: { constraints: {} }, valueSource: { kind: 'inline-enumerated' } } },
    { id: 'local.score', customId: 'custom', base: 'decimal', minimum: 0, maximum: 1, path: ['PatientCareReportGroup'],
      definition: { datatype: { constraints: { minimum: 2, maximum: 8 } }, valueSource: { kind: 'scalar' } } },
  ] };
  const configuration = { definition: { schemaVersion: 1, sections: [{ key: 'clinical', fields: [
    { key: 'pulse', source: { kind: 'nemsis', elementId: 'eVitals.10' } },
    { key: 'injury', source: { kind: 'nemsis', elementId: 'eSituation.02' }, choicePolicy: [
      { kind: 'code', code: 'B', codeSystem: 'test' }, { kind: 'code', code: 'C', codeSystem: 'test' },
    ] }, { key: 'score', source: { kind: 'custom', elementDefinitionId: 'custom' } },
  ] }] }, catalogFields: { 'eSituation.02': { codeChoices: ['A', 'B', 'C'].map(code => ({ code, label: code, codeSystem: 'test' })) } } };
  const rules = sources.map(source => {
    const result = compileValidationRule({ id: randomUUID(), name: source, enabled: true, severity: 'error',
      executionTargets: ['live', 'sign'], primaryTargetElementId: 'eVitals.10', message: source, source },
    versionId, new Set(model.elements.map(element => element.id)));
    assert.deepEqual(result.diagnostics, []);
    return result.compiled;
  });
  const bundle = { schemaVersion: 1, languageVersion: '1.0.0', validationVersionId: versionId, catalogReleaseId: releaseId, rules };
  return { source: { encounter: { id: randomUUID(), createdAt: '2026-10-04T10:00:00Z' }, groups: [] },
    model, configuration, bundle, dispatchedAt: new Date('2026-09-15T10:00:00Z'), now: new Date('2026-10-04T10:00:00Z') };
}
const value = (document, id) => document.groups.flatMap(group => group.instances.flatMap(instance => instance.elements)).find(element => element.id === id).values[0];

test('random codes honor form restrictions and numerical values have a distribution', () => {
  const input = fixture(), random = seededRandom('variety'), codes = new Set(), pulses = new Set();
  for (let i = 0; i < 100; i++) {
    const { document } = generateDocument({ ...input, random });
    codes.add(value(document, 'eSituation.02').code);
    pulses.add(value(document, 'eVitals.10').value);
    assert.ok(value(document, 'local.score').value >= 2 && value(document, 'local.score').value <= 8);
    const mutations = documentMutations(document, input.source, input.model);
    assert.equal(mutations.occurrences.find(item => item.elementId === 'local.score').value.kind, 'numeric');
  }
  assert.deepEqual(codes, new Set(['B', 'C']));
  assert.ok(pulses.size > 30);
});

test('authored equality is repaired and contradictory active rules fail with actionable rule IDs', () => {
  const input = fixture(['require equals("eVitals.10", 72)']);
  const { document } = generateDocument({ ...input, random: seededRandom('constraints') });
  assert.equal(value(document, 'eVitals.10').value, 72);
  assert.deepEqual(validationProblems(input.bundle, document, input.now.toISOString()), []);
  const impossible = fixture(['require equals("eVitals.10", 72)', 'require equals("eVitals.10", 90)']);
  assert.throws(() => generateDocument({ ...impossible, random: seededRandom('constraints'), maxPasses: 3 }), /Could not satisfy active validation.*ruleId/);
});

test('hidden fields are omitted and unsupported catalog formats fail explicitly', () => {
  const input = fixture();
  input.configuration.definition.sections[0].fields[2].rules = [{ kind: 'visibility', expression: { operator: 'equals', field: 'injury', value: 'A' } }];
  const { document } = generateDocument({ ...input, random: seededRandom('hidden') });
  assert.ok(!document.groups.flatMap(group => group.instances.flatMap(instance => instance.elements)).some(element => element.id === 'local.score'));
  const text = fixture();
  text.model.elements[2].base = 'string';
  text.model.elements[2].definition.datatype.constraints = { pattern: '(?=unusual)unusual-[xyz]{17}' };
  assert.throws(() => generateDocument({ ...text, random: seededRandom('unsupported') }), /unsupported catalog format/);
});
