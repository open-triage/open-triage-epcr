import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/** Exercise the validators actually shipped in the APK, rather than their source equivalents. */
export function verifyPackagedPairing(directory) {
  assert(existsSync(join(directory, 'native-bootstrap.js')), 'Packaged connection bootstrap is missing');
  assert(!existsSync(join(directory, '_next')), 'Clinical UI chunks must never be included in the APK');
  const context = { URL, TextEncoder, console, setTimeout, clearTimeout };
  runInNewContext(readFileSync(join(directory, 'native-bootstrap.js'), 'utf8'), context, { timeout: 5000 });
  const pairing = context.OpenTriageBootstrap;
  assert(pairing?.parseAndroidPairing && pairing?.parseAndroidPairingQr && pairing?.mount, 'Packaged connection bootstrap is incomplete');
  verifyPairingLifetimes(pairing);
}

export function verifyPairingLifetimes(pairing) {
  // Build entrypoints can import this verifier before contracts have been compiled.
  const { DEFAULT_PAIRING_EXPIRY_MINUTES, MAX_PAIRING_EXPIRY_MINUTES } = require('../../packages/contracts/dist/installation-enrollment.js');
  const now = Date.now();
  for (const minutes of [1, 5, DEFAULT_PAIRING_EXPIRY_MINUTES, MAX_PAIRING_EXPIRY_MINUTES]) {
    const artifact = JSON.stringify({version:1, origin:'https://localhost:3443', token:'A'.repeat(43),
      expiresAt:new Date(now + minutes * 60000).toISOString(), caPem:''});
    for (const name of ['parseAndroidPairing', 'parseAndroidPairingQr']) {
      assert.doesNotThrow(() => pairing[name](artifact, now), `Packaged ${name} must accept a ${minutes}-minute server code; rebuild the connection bootstrap`);
    }
  }
}
