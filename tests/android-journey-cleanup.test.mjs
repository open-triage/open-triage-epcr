import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAndroidJourney } from '../scripts/android/journey-cleanup.mjs';

test('device cleanup failures still close the database and preserve the original journey error', async () => {
  const calls = [], original = new Error('emulator exited');
  const journey = async () => {
    try { throw original; }
    finally {
      await cleanupAndroidJourney([
        () => { calls.push('wifi'); throw new Error('device offline'); },
        async () => { calls.push('data'); throw new Error('device offline'); },
        async () => { calls.push('database closed'); },
      ], original);
    }
  };
  await assert.rejects(journey, error => error === original);
  assert.deepEqual(calls, ['wifi', 'data', 'database closed']);
});

test('cleanup failures fail a successful journey after all resources are released', async () => {
  let closed = false;
  const failure = new Error('radio restore failed');
  await assert.rejects(cleanupAndroidJourney([
    () => { throw failure; },
    async () => { closed = true; },
  ]), error => error instanceof AggregateError && error.errors[0] === failure);
  assert.equal(closed, true);
});

test('successful cleanup completes without an original failure', async () => {
  await cleanupAndroidJourney([() => {}, async () => {}]);
});
