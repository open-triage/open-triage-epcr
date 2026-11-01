import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosPdfItem, verifyCosPdfNote } from '../dist/hospital/cos-pdf.js';
import { SIGNED_PDF_SIMULATOR_LIMITS } from '../dist/reports/signed-report-pdf-media.js';

const expected = { patientId: '456', patientIdentifier: '194609073277', encounterId: '106952',
  marker: 'Unique signed-version test marker', pdfKeyword: 'Fullständig ambulansanteckning' };
function fixture() {
  return [{ patient: { patientInternalID: '456', patientID: { extension: expected.patientIdentifier } },
    hCMContact: { hCMContactInternalID: '106952' }, note: { noteActive: true,
      noteId: { extension: 'cos-sandbox-2024:RcId:JournalNoteId:135084' }, records: { record: [
        { keyword: 'Status', value: [{ value: expected.marker, journalValueType: 'Text' }] },
        { keyword: 'Parent', record: [{ keyword: expected.pdfKeyword, keywordToolType: 'Text',
          value: [{ value: 'Komplett ambulansanteckning.pdf', journalValueType: 'Document' }] }] },
      ] } } }];
}
const pdfValue = f => f[0].note.records.record[1].record[0].value[0];
test('inline PDF preserves exact artifact bytes and rejects invalid or oversized artifacts', () => {
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0, 128, 255]), Buffer.from('\n%%EOF')]);
  const item = cosPdfItem('772786005', { kind: 'inline', bytes });
  assert.equal(item.linkId, '772786005');
  assert.match(item.answer[0].valueUri, /^data:application\/pdf;base64,/);
  assert.deepEqual(Buffer.from(item.answer[0].valueUri.split(',')[1], 'base64'), bytes);
  for (const invalid of [Buffer.alloc(0), Buffer.from('<html>not a PDF</html>'), '%PDF-string',
    Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(SIGNED_PDF_SIMULATOR_LIMITS.artifactBytes)])]) {
    assert.throws(() => cosPdfItem('772786005', { kind: 'inline', bytes: invalid }));
  }
});
test('live PDF URLs require HTTPS and simulator artifacts remain explicit', () => {
  assert.equal(cosPdfItem('772786005', { kind: 'https', url: 'https://example.org/pdf?token=opaque' }).answer[0].valueUri,
    'https://example.org/pdf?token=opaque');
  for (const url of ['http://example.org/report.pdf', 'data:application/pdf;base64,JVBERg==',
    'https://user:password@example.org/report.pdf', 'https://example.org/report.pdf#fragment', ' https://example.org/report.pdf']) {
    assert.throws(() => cosPdfItem('772786005', { kind: 'https', url }));
  }
  assert.equal(cosPdfItem('772786005', { kind: 'simulator', deliveryId: 'delivery', sha256: 'a'.repeat(64) }).answer[0].valueUri,
    'urn:opentriage:cos-simulator:pdf:delivery:' + 'a'.repeat(64));
});
test('PDF verification uses the active REST document value even when the keyword tool is Text', () => {
  assert.deepEqual(verifyCosPdfNote(fixture(), expected), { state: 'document-recorded', pdfBytesReadBack: false,
    noteId: '135084', documentName: 'Komplett ambulansanteckning.pdf' });
});
test('both observed localized PDF failures reject acceptance, including contradictory document entries', () => {
  for (const message of ['PDF could not be included in note.', 'PDF kunde inte inkluderas i anteckningen.']) {
    const f = fixture(); f[0].note.records.record[1].record[0].value.push({ value: message, journalValueType: 'Text' });
    assert.equal(verifyCosPdfNote(f, expected).state, 'failed');
  }
});
test('filenames in text, missing FHIR PDF answers, wrong identities and stale note versions never prove storage', () => {
  const changes = [f => { pdfValue(f).journalValueType = 'Text'; },
    f => { f[0].note.noteActive = false; }, f => { f[0].patient.patientInternalID = '457'; },
    f => { f[0].patient.patientID.extension = 'different'; }, f => { f[0].hCMContact.hCMContactInternalID = '83499'; },
    f => { f[0].note.records.record[0].value[0].value = 'older version'; },
    f => { f[0].note.records.record.pop(); }, f => { f[0].note.records.record[1].record[0].keyword = 'Other document'; }];
  for (const change of changes) { const f = fixture(); change(f); assert.equal(verifyCosPdfNote(f, expected).state, 'pending'); }
  assert.equal(verifyCosPdfNote([], expected).state, 'pending');
  assert.equal(verifyCosPdfNote([...fixture(), ...fixture()], expected).state, 'ambiguous');
});

test('PDF diagnostics distinguish missing evidence, ambiguity and explicit ingestion failure', () => {
  assert.equal(verifyCosPdfNote([], expected).reason, 'pdfJournalEmpty');
  const stale = fixture(); stale[0].note.records.record[0].value[0].value = 'older version';
  assert.equal(verifyCosPdfNote(stale, expected).reason, 'pdfNoteNotFound');
  assert.equal(verifyCosPdfNote([...fixture(), ...fixture()], expected).reason, 'pdfNoteAmbiguous');
  const invalid = fixture(); invalid[0].note.noteId.extension = 'unrecognized';
  assert.equal(verifyCosPdfNote(invalid, expected).reason, 'pdfNoteIdInvalid');
  const missing = fixture(); pdfValue(missing).journalValueType = 'Text';
  assert.equal(verifyCosPdfNote(missing, expected).reason, 'pdfDocumentMissing');
  const duplicate = fixture(); duplicate[0].note.records.record[1].record[0].value.push({...pdfValue(duplicate)});
  assert.equal(verifyCosPdfNote(duplicate, expected).reason, 'pdfDocumentAmbiguous');
  const failed = fixture(); pdfValue(failed).value = 'PDF could not be included in note.';
  assert.equal(verifyCosPdfNote(failed, expected).reason, 'pdfInclusionFailed');
});
