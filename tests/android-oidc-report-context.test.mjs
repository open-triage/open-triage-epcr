import assert from 'node:assert/strict';
import test from 'node:test';
import {oidcReportContext} from '../scripts/android/oidc-report-context.mjs';
const target = {callNumber: 'ANDROID-OFFLINE-1', userId: 'alpha'};
test('OIDC acceptance opens a fresh assignment and reopens the exact previously synchronized report', () => {
  assert.deepEqual(oidcReportContext([{call_number: target.callNumber, report_id: null}], target), {openAction: 'Open call', callNumber: target.callNumber, baselineRevision: null});
  assert.deepEqual(oidcReportContext([{call_number: target.callNumber, report_id: 'report-1', documenting_user_id: 'alpha', revision: 37}], target), {openAction: 'Reopen report', callNumber: target.callNumber, reportId: 'report-1', baselineRevision: 37});
});
test('OIDC acceptance cannot accidentally use a missing, ambiguous, wrong-call or wrong-owner report', () => {
  for (const rows of [[], [{}, {}], [{call_number: 'OTHER', report_id: null}], [{call_number: target.callNumber, report_id: 'report-1', documenting_user_id: 'beta', revision: 37}], [{call_number: target.callNumber, report_id: 'report-1', documenting_user_id: 'alpha', revision: -1}]]) assert.throws(() => oidcReportContext(rows, target));
});
