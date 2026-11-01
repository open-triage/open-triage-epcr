import assert from 'node:assert/strict';

const canonical = value => (value?.coding ?? []).map(c => `${c.system}|${c.code}`);
function codes(actual, expected) {
  const have = new Set(canonical(actual));
  return canonical(expected).length > 0 && canonical(expected).every(c => have.has(c));
}
function quantity(actual, expected) {
  return typeof actual?.value === 'number' && actual.value === expected?.value &&
    ['unit', 'system', 'code'].every(k => expected[k] === undefined || actual[k] === expected[k]) &&
    actual.comparator === expected.comparator;
}

/** Compare structured fields, never narrative or numeric strings in a note. */
export function matchesObservation(actual, expected, patientReference, encounterReference) {
  if (actual?.resourceType !== 'Observation' || actual.status !== 'final' ||
      actual.subject?.reference !== patientReference || actual.encounter?.reference !== encounterReference ||
      !actual.meta?.profile?.includes(expected.meta.profile[0]) || !codes(actual.code, expected.code) ||
      !Number.isFinite(Date.parse(expected.effectiveDateTime)) ||
      Date.parse(actual.effectiveDateTime) !== Date.parse(expected.effectiveDateTime)) return false;
  if (expected.valueQuantity && !quantity(actual.valueQuantity, expected.valueQuantity)) return false;
  if (expected.valueCodeableConcept && !codes(actual.valueCodeableConcept, expected.valueCodeableConcept)) return false;
  if (expected.component) {
    if (actual.component?.length !== expected.component.length) return false;
    if (!expected.component.every(e => actual.component.filter(a => codes(a.code, e.code) && quantity(a.valueQuantity, e.valueQuantity)).length === 1)) return false;
  }
  return true;
}

/** Internal IDs come from the write receipt and NEWS2.derivedFrom, not guessed IDs. */
export function verifyNews2(bundle, resources, newsId, patientReference, encounterReference) {
  const expectedNews = bundle.entry.find(e => e.resource.meta.profile[0].endsWith('/ObservationNews2Lite/v1'))?.resource;
  assert.ok(expectedNews, 'Missing expected NEWS2');
  const news = resources.filter(r => r.resourceType === 'Observation' && r.id === newsId);
  assert.equal(news.length, 1, 'The exact NEWS2 ID returned by COS must be readable');
  assert.ok(matchesObservation(news[0], expectedNews, patientReference, encounterReference), 'NEWS2 context/code/time mismatch');
  assert.equal(typeof news[0].valueQuantity?.value, 'number', 'NEWS2 score must be structured');
  const references = new Set(news[0].derivedFrom?.map(r => r.reference));
  assert.equal(references.size, 6, 'Expected six distinct stored vital references');
  const expectedVitals = bundle.entry.map(e => e.resource).filter(r => r !== expectedNews);
  assert.equal(expectedVitals.length, 6, 'A complete NEWS2 requires six actual vital measurements');
  const verified = expectedVitals.map(expected => {
    const matches = resources.filter(r => references.has(`Observation/${r.id}`) &&
      matchesObservation(r, expected, patientReference, encounterReference));
    assert.equal(matches.length, 1, `Missing or ambiguous structured ${expected.meta.profile[0]}`);
    const r = matches[0];
    return { id: r.id, profile: r.meta.profile[0], valueQuantity: r.valueQuantity,
      valueCodeableConcept: r.valueCodeableConcept, component: r.component };
  });
  assert.equal(new Set(verified.map(r => r.id)).size, 6, 'Each measurement must have its own stored observation');
  return { verified: true, patientReference, encounterReference, newsId, score: news[0].valueQuantity.value, observations: verified };
}
