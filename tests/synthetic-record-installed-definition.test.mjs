import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileMetricLibrary, compileValidationRule } from '@open-triage/contracts';
import { generateDocument, randomFromSeed, validationProblems } from '@open-triage/contracts/synthetic-record-generator';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

function installedFixture() {
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
