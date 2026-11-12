import assert from 'node:assert/strict';

/** Prior native journeys legitimately open/modify this call; never assume revision zero. */
export function oidcReportContext(rows, {callNumber, userId, assignmentId}) {
  assert.equal(rows.length, 1, 'OIDC acceptance requires the exact seeded clinical call');
  const row = rows[0];
  assert.equal(row.call_number, callNumber);
  if(assignmentId)assert.equal(row.assignment_id,assignmentId,'OIDC must retain its own exact assignment');
  if (row.report_id === null) return {openAction: 'Open call', callNumber, baselineRevision: null};
  assert.equal(row.status,'draft','OIDC protected work requires its own unsigned draft, never an earlier signed report');
  assert.equal(row.documenting_user_id, userId, 'Only the original clinician report may be reused');
  assert(Number.isSafeInteger(Number(row.revision)) && Number(row.revision) >= 0, 'Existing revision must be explicit');
  return {openAction: 'Reopen report', callNumber, reportId: row.report_id, baselineRevision: Number(row.revision)};
}

export function oidcInstrumentationContext(context, extra) {
  if(!context)return extra;
  if(extra.callNumber!==undefined)assert.equal(extra.callNumber,context.callNumber,'OIDC cannot switch its owned clinical call between phases');
  if(context.reportId&&extra.reportId!==undefined)assert.equal(extra.reportId,context.reportId,'OIDC cannot substitute another report between phases');
  return {callNumber:context.callNumber,...(context.reportId?{reportId:context.reportId}:{}),...extra};
}
