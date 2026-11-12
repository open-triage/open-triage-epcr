import assert from 'node:assert/strict';

/** Prior native journeys legitimately open/modify this call; never assume revision zero. */
export function oidcReportContext(rows, {callNumber, userId}) {
  assert.equal(rows.length, 1, 'OIDC acceptance requires the exact seeded clinical call');
  const row = rows[0];
  assert.equal(row.call_number, callNumber);
  if (row.report_id === null) return {openAction: 'Open call', callNumber, baselineRevision: null};
  assert.equal(row.documenting_user_id, userId, 'Only the original clinician report may be reused');
  assert(Number.isSafeInteger(Number(row.revision)) && Number(row.revision) >= 0, 'Existing revision must be explicit');
  return {openAction: 'Reopen report', callNumber, reportId: row.report_id, baselineRevision: Number(row.revision)};
}
