import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNativeBootstrap } from '../apps/web/scripts/build-native-bootstrap.mjs';
import { verifyPackagedPairing } from '../scripts/android/packaged-pairing.mjs';

test('the actual APK bootstrap contains pairing/loading code and excludes the clinical application', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-bootstrap-'));
  try {
    await buildNativeBootstrap(directory);
    assert.doesNotThrow(() => verifyPackagedPairing(directory));
    assert.deepEqual((await readdir(directory)).sort(), ['404', 'admin-preview', 'enroll', 'index.html', 'manifest.webmanifest', 'native-bootstrap.css', 'native-bootstrap.js', 'review-call', 'sw.js'].sort());
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    assert(html.includes('/native-bootstrap.js')); assert(!html.includes('/_next/'));
    await mkdir(join(directory, '_next'));
    assert.throws(() => verifyPackagedPairing(directory), /Clinical UI chunks must never be included/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
