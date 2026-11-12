import assert from 'node:assert/strict';

/** Parse actual `pm path` output for a single installed, nonsplit user APK. */
export function singleInstalledBaseApkPath(output) {
  assert.equal(typeof output, 'string', 'Installed APK path observation must be text');
  assert(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(output), 'Installed APK path contains control characters');
  const rows = output.split(/\r?\n/).filter(row => row !== '');
  assert.equal(rows.length, 1, 'Expected exactly one installed base APK; split or ambiguous packages are unsupported');
  assert(rows[0].startsWith('package:'), 'Expected an actual pm path package row');
  const path = rows[0].slice('package:'.length);
  assert(/^\/data\/app\/(?:[A-Za-z0-9_.+=~-]+\/){1,2}base\.apk$/.test(path), 'Installed base APK must have a safe user-package path');
  assert(path.split('/').every(segment => segment !== '.' && segment !== '..'), 'Installed APK path traversal is forbidden');
  return path;
}
