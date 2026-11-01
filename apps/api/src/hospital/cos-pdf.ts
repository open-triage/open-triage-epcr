import { SIGNED_PDF_SIMULATOR_LIMITS } from '../reports/signed-report-pdf-media.js';

/** COS accepts PDF bytes as a data URI in valueUri. This avoids receiver-side URL
 * downloads; the data URI must only travel inside the authenticated HTTPS bundle.
 * Hosted alternatives require HTTPS; simulator URNs are explicitly separate. */
export function cosPdfItem(linkId: string, source:
  { kind: 'inline'; bytes: Buffer } | { kind: 'https'; url: string } |
  { kind: 'simulator'; deliveryId: string; sha256: string }) {
  if (!/^\d{6,18}$/.test(linkId)) throw new Error('Invalid COS PDF link ID');
  let uri: string;
  if (source.kind === 'inline') {
    if (!Buffer.isBuffer(source.bytes) || source.bytes.length > SIGNED_PDF_SIMULATOR_LIMITS.artifactBytes ||
        source.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('COS inline PDF requires a bounded PDF artifact');
    }
    uri = 'data:application/pdf;base64,' + source.bytes.toString('base64');
  } else if (source.kind === 'simulator') {
    if (!/^[a-zA-Z0-9.-]{1,100}$/.test(source.deliveryId) || !/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new Error('Invalid simulator PDF identity');
    }
    uri = `urn:opentriage:cos-simulator:pdf:${source.deliveryId}:${source.sha256}`;
  } else {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        source.url.trim() !== source.url || /[\u0000-\u0020\u007f]/.test(source.url)) {
      throw new Error('COS PDF requires an HTTPS URL without user credentials or a fragment');
    }
    uri = source.url;
  }
  return { linkId, answer: [{ valueUri: uri }] };
}

type JournalValue = { value?: unknown; journalValueType?: unknown };
type JournalRecord = { keyword?: unknown; value?: JournalValue[]; record?: JournalRecord[] };
type JournalExtract = {
  patient?: { patientInternalID?: unknown; patientID?: { extension?: unknown } };
  hCMContact?: { hCMContactInternalID?: unknown };
  note?: { noteActive?: unknown; noteId?: { extension?: unknown }; records?: { record?: JournalRecord[] } };
};
export type CosPdfNoteResult = { state: 'pending' | 'ambiguous' | 'failed' | 'document-recorded';
  noteId?: string; documentName?: string; pdfBytesReadBack: false;
  journalEvidence?: { httpStatus: number; bodyBytes: number; bodySha256: string;
    correlation: Record<string, string>; extractCount: number };
  reason?: 'pdfJournalEmpty' | 'pdfJournalUnavailable' | 'pdfIdentityUnavailable' | 'pdfNoteNotFound' | 'pdfNoteAmbiguous' | 'pdfNoteIdInvalid' | 'pdfInclusionFailed' | 'pdfDocumentAmbiguous' | 'pdfDocumentMissing' };

/** COS's FHIR QuestionnaireResponse read omits the PDF answer entirely. Verify the
 * REST journal's typed Document value and exact version marker instead. This proves
 * a document entry, not a byte-for-byte read-back of the stored PDF. */
export function verifyCosPdfNote(extracts: JournalExtract[], expected: {
  patientId: string; patientIdentifier: string; encounterId: string; marker: string; pdfKeyword: string;
}): CosPdfNoteResult {
  const result = (state: CosPdfNoteResult['state'], extra: Partial<CosPdfNoteResult> = {}): CosPdfNoteResult =>
    ({ state, pdfBytesReadBack: false, ...extra });
  const flatten = (records: JournalRecord[] = []): JournalRecord[] => records.flatMap(r => [r, ...flatten(r.record)]);
  const matches = extracts.filter(e => e.note?.noteActive === true &&
    String(e.patient?.patientInternalID) === expected.patientId &&
    e.patient?.patientID?.extension === expected.patientIdentifier &&
    String(e.hCMContact?.hCMContactInternalID) === expected.encounterId &&
    flatten(e.note?.records?.record).some(r => r.value?.some(v =>
      v.journalValueType === 'Text' && v.value === expected.marker)));
  // An empty journal cannot distinguish a missing note from an unreadable patient.
  if (!extracts.length) return result('pending', { reason: 'pdfJournalEmpty' });
  if (!matches.length) return result('pending', { reason: 'pdfNoteNotFound' });
  if (matches.length !== 1) return result('ambiguous', { reason: 'pdfNoteAmbiguous' });
  const note = matches[0]!.note!;
  const noteId = String(note.noteId?.extension ?? '').match(/:JournalNoteId:(\d+)$/)?.[1];
  if (!noteId) return result('ambiguous', { reason: 'pdfNoteIdInvalid' });
  const records = flatten(note.records?.record).filter(r => r.keyword === expected.pdfKeyword);
  const values = records.flatMap(r => r.value ?? []);
  if (values.some(v => typeof v.value === 'string' &&
    /PDF (?:could not be included|kunde inte inkluderas)/i.test(v.value))) return result('failed', { noteId, reason: 'pdfInclusionFailed' });
  const documents = values.filter(v => ['Document', 'PDFDocument'].includes(String(v.journalValueType)) &&
    typeof v.value === 'string' && /^.+\.pdf$/i.test(v.value));
  if (documents.length > 1) return result('ambiguous', { noteId, reason: 'pdfDocumentAmbiguous' });
  return documents.length === 1 ? result('document-recorded', { noteId, documentName: documents[0]!.value as string }) :
    result('pending', { noteId, reason: 'pdfDocumentMissing' });
}
