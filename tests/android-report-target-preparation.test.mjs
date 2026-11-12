import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReportJourneyTarget, validateReportTargetPreparation } from '../scripts/android/report-target-preparation.mjs';
import { runReportRecoveryJourney } from '../scripts/android/report-journey.mjs';

const target = { adb: '/sdk/adb', serial: 'leased-device', applicationId: 'org.opentriage.android' };

test('ordinary report preparation clears only the explicitly selected package and awaits completion', async () => {
  const calls = [];
  let finish;
  const completion = prepareReportJourneyTarget({ ...target, run: (...args) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); } });
  let continued = false;
  const joined = completion.then(() => { continued = true; });
  await Promise.resolve();
  assert.equal(continued, false);
  assert.deepEqual(calls, [['/sdk/adb', ['-s', 'leased-device', 'shell', 'pm', 'clear', 'org.opentriage.android']]]);
  finish(); await joined; assert.equal(continued, true);
});

test('explicit external preparation preserves genuine delivery and waits for its fresh-state verifier', async () => {
  let finish, observed, continued = false;
  const proof = { genuineDelivery: true };
  const completion = prepareReportJourneyTarget({ ...target, artifact: proof, mode: 'external', run: () => assert.fail('Must not clear or reinstall an externally prepared target'), prepareTarget: context => {
    observed = context;
    return new Promise(resolve => { finish = resolve; });
  } }).then(() => { continued = true; });
  await Promise.resolve();
  assert.equal(continued, false);
  assert.equal(observed.artifact, proof);
  assert.equal(observed.applicationId, target.applicationId);
  finish(); await completion; assert.equal(continued, true);
});

test('invalid or incomplete preparation contracts reject before any target action', async () => {
  for (const options of [
    { mode: 'external' }, { mode: 'external', prepareTarget: null },
    { mode: 'external', prepareTarget: true }, { mode: 'skip' },
    { prepareTarget: async () => assert.fail('Implicit hook must not run') },
  ]) {
    await assert.rejects(prepareReportJourneyTarget({ ...target, ...options, run: () => assert.fail('Invalid contract must not touch device') }));
  }
  assert.throws(() => validateReportTargetPreparation('external', undefined), /requires an awaited/);
  // No fixture/root/API is supplied: invalid contracts must fail before those are used.
  await assert.rejects(runReportRecoveryJourney({ targetPreparation: 'external' }), /requires an awaited/);
  await assert.rejects(runReportRecoveryJourney({ hooks: { prepareTarget: async () => {} } }), /requires explicit external/);
});

test('failed fresh-state proof aborts without clearing or allowing preparation to proceed', async () => {
  const failure = new Error('Previously enrolled target refused');
  let continued = false;
  const operation = prepareReportJourneyTarget({ ...target, mode: 'external', run: () => assert.fail('Must preserve refused target'), prepareTarget: async () => { throw failure; } })
    .then(() => { continued = true; });
  await assert.rejects(operation, error => error === failure);
  assert.equal(continued, false);
});
