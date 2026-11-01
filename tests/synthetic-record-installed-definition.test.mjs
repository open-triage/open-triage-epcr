import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileMetricLibrary, compileValidationRule } from '@open-triage/contracts';
import { generateDocument, randomFromSeed, validationProblems } from '@open-triage/contracts/synthetic-record-generator';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

function installedFixture(patientIndex = 0) {
  const catalog = read('../defines/catalog/catalog_nemsis-3.5.1.json');
  const validation = read('../defines/validation/validation_nemsis-full.json');
  const codes = catalog.elements.flatMap(element => [
    ...(element.valueSource.values ?? []).map(choice => ({ elementId: element.id, ...choice, codeSystem: '' })),
    ...catalog.bundledLists.filter(list => element.valueSource.bundledListIds?.includes(list.id))
      .flatMap(list => list.values.map(choice => ({ elementId: element.id, ...choice }))),
  ]);
  const compileCatalog = {
    codes,
    elements: catalog.elements.map(element => ({ elementId: element.id, label: element.name,
      baseDatatype: element.datatype.base, groupPath: element.groupPath, intrinsicOccurrence: element.occurrence })),
    groups: catalog.groups.map(group => ({ groupId: group.id, label: group.name, repeating: group.repeating,
      ...(group.parentId ? { parentGroupId: group.parentId } : {}), intrinsicOccurrence: group.occurrence })),
  };
  const library = compileMetricLibrary(validation.metrics, 'demo-validation', compileCatalog);
  assert.deepEqual(library.diagnostics, []);
  const rules = validation.rules.filter(rule => rule.enabled).map(rule => {
    const result = compileValidationRule(rule, 'demo-validation', compileCatalog, library.metrics);
    assert.deepEqual(result.diagnostics, [], rule.name);
    return result.compiled;
  });
  const bundle = { schemaVersion: 2, languageVersion: '2.0.0', validationVersionId: 'demo-validation',
    catalogReleaseId: 'nemsis-3.5.1', metrics: library.metrics, rules };
  const configuration = { definition: read('../defines/forms/form_nemsis-full.json').definition,
    catalogFields: Object.fromEntries(catalog.elements.map(element => [element.id, {
      codeChoices: codes.filter(code => code.elementId === element.id),
    }])) };
  const model = {
    elements: catalog.elements.map(element => ({ id: element.id, base: element.datatype.base,
      path: element.groupPath, minimum: element.occurrence.min,
      maximum: element.occurrence.max === 'unbounded' ? null : element.occurrence.max, definition: element })),
    groups: catalog.groups.map(group => ({ id: group.id, parent: group.parentId })),
  };
  const source = read('../apps/web/app/data/synthetic-encounter-document.json');
  if (patientIndex) {
    const dispatch = read(`../packages/contracts/examples/dispatch/synthetic-assignment-${String(patientIndex + 1).padStart(2, '0')}.json`);
    source.groups = source.groups.filter(group => !group.id.startsWith('ePatient'))
      .concat(dispatch.groups.filter(group => group.id.startsWith('ePatient')));
  }
  // Opening a dispatch assigns its report number on the server before Populate.
  source.groups.push({ id: 'eRecordSection', instances: [{ instanceId: 'server-record',
    parentInstanceId: source.groups.find(group => group.id === 'PatientCareReportGroup').instances[0].instanceId,
    elements: [{ id: 'eRecord.01', values: [{ kind: 'scalar', occurrenceId: 'server-pcr-number', value: 'PCR-000000001' }] }],
  }] });
  const dispatchedAt = new Date(source.groups.flatMap(group => group.instances.flatMap(instance => instance.elements))
    .find(element => element.id === 'eTimes.03').values[0].value);
  return { source, configuration, model, bundle, dispatchedAt, now: new Date('2026-10-06T12:00:00Z') };
}

for (const preserveExisting of [true, false]) {
  test(`${preserveExisting ? 'Populate' : 'CLI'} satisfies the full installed validation definition`, () => {
    const input = installedFixture();
    const original = structuredClone(input.source);
    const { document } = generateDocument({ ...input, preserveExisting, random: randomFromSeed(1) });
    assert.deepEqual(validationProblems(input.bundle, document, input.now.toISOString()), []);
    assert.deepEqual(input.source, original);
    if (preserveExisting) {
      for (const group of original.groups) {
        for (const instance of group.instances) {
          const populated = document.groups.find(item => item.id === group.id).instances
            .find(item => item.instanceId === instance.instanceId);
          for (const element of instance.elements) {
            assert.deepEqual(populated.elements.find(item => item.id === element.id), element);
          }
        }
      }
    }
  });
}

const patientValue = (document, id) => document.groups.flatMap(group => group.instances.flatMap(instance => instance.elements))
  .find(element => element.id === id)?.values[0];
const patients = ['andrea', 'arne', 'ville'].map(name => read(`../packages/contracts/examples/hospital/${name}-patient.json`));
const usedPatients = new Set();
for (let index = 0; index < 10; index++) {
  const fixture = read(`../packages/contracts/examples/dispatch/synthetic-assignment-${String(index + 1).padStart(2, '0')}.json`);
  const identifier = patientValue(fixture, 'ePatient.01').value;
  const patient = patients.find(patient => patient.identifier[0].value === identifier);
  assert.ok(patient, `Dispatch ${index + 1} must use a hackathon patient`);
  usedPatients.add(identifier);
  const name = patient.name[0].given[0];
  for (const preserveExisting of [false, true]) {
    test(`${index + 1} ${name}: ${preserveExisting ? 'Populate' : 'CLI'} retains the service identity and derives coherent age`, () => {
      const input = installedFixture(index);
      for (const seed of (index < 2 ? [1, 17, 49] : [1])) {
        const { document } = generateDocument({ ...input, preserveExisting, random: randomFromSeed(seed) });
        assert.equal(patientValue(document, 'ePatient.01').value, patient.identifier[0].value);
        assert.equal(patientValue(document, 'ePatient.02').value, patient.name[0].family);
        assert.equal(patientValue(document, 'ePatient.03').value, patient.name[0].given[0]);
        assert.equal(patientValue(document, 'ePatient.04')?.value, patient.name[0].given[1]);
        assert.equal(patientValue(document, 'ePatient.17').value, patient.birthDate);
        assert.equal(patientValue(document, 'ePatient.18').value, patient.telecom.find(item => item.system === 'phone').value);
        const home = patient.address.find(address => address.use === 'home');
        assert.equal(patientValue(document, 'ePatient.05').value, home.line[0]);
        assert.equal(patientValue(document, 'ePatient.09').value, home.postalCode.replaceAll(' ', ''));
        for (const id of ['ePatient.06', 'ePatient.07', 'ePatient.08', 'ePatient.10']) {
          assert.ok(!patientValue(document, id) || patientValue(document, id).kind === 'null', `${id} must not invent a US locality`);
        }
        assert.equal(patientValue(document, 'ePatient.25').code, patient.gender === 'female' ? '9919001' : '9919003');
        assert.equal(patientValue(document, 'ePatient.15').value, { '200207252388': 24, '194302096997': 83, '201304822172': 13 }[identifier]);
        assert.equal(patientValue(document, 'ePatient.16').code, '2516009');
        assert.deepEqual(validationProblems(input.bundle, document, input.now.toISOString()), []);
        assert.equal(document.encounter.synthetic, true);
      }
    });
  }
}

test('all three hackathon identities occur in dispatch samples', () => {
  assert.equal(usedPatients.size, 3);
});

test('a documented care disposition incompatible with absent locality fails without inventing demographics or changing care', () => {
  const input = installedFixture();
  input.source.groups.push({ id: 'eDispositionSection', instances: [{ instanceId: 'documented-disposition', elements: [
    { id: 'eDisposition.28', values: [{ kind: 'coded', occurrenceId: 'documented-care', code: '4228001' }] },
  ] }] });
  const original = structuredClone(input.source);
  assert.throws(() => generateDocument({ ...input, preserveExisting: true, maxPasses: 2, random: randomFromSeed(1) }),
    /Could not satisfy active validation.*Home County/);
  assert.deepEqual(input.source, original);
});
