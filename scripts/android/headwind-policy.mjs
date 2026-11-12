import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Operator/test adapter only. The clinical application consumes Android Bundles.
export function headwindPolicySetting(configuration) {
  if (!configuration || Object.getPrototypeOf(configuration) !== Object.prototype) {
    throw new Error('Expected a managed configuration JSON object');
  }
  const keys = Object.keys(configuration).sort();
  const empty = keys.length === 0;
  if (!empty && (keys.join(',') !== 'configurationVersion,publicCaPem,serverOrigin'
      || configuration.configurationVersion !== 1
      || typeof configuration.serverOrigin !== 'string'
      || typeof configuration.publicCaPem !== 'string')) {
    throw new Error('Supply exactly configurationVersion: 1, serverOrigin: string and publicCaPem: string; use {} only for explicit policy removal');
  }
  if (!empty) {
    let origin;
    try { origin = new URL(configuration.serverOrigin); } catch { /* Rejected below. */ }
    if (!origin || origin.protocol !== 'https:' || origin.origin !== configuration.serverOrigin) {
      throw new Error('serverOrigin must be an HTTPS origin without credentials, path, query or fragment');
    }
    if (configuration.publicCaPem.length > 48_000 || /PRIVATE KEY/.test(configuration.publicCaPem)) {
      throw new Error('publicCaPem must contain public CA material only, within the application limit');
    }
  }
  return {
    applicationPkg: 'org.opentriage.android', name: 'managedConfig', type: 'STRING',
    value: JSON.stringify(configuration), readonly: true, variable: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/android/headwind-policy.mjs <managed-configuration.json>');
    const text = await readFile(process.argv[2], 'utf8');
    let configuration;
    try { configuration = JSON.parse(text); } catch { throw new Error('Input is not valid managed configuration JSON'); }
    const setting = headwindPolicySetting(configuration);
    process.stdout.write(`${JSON.stringify(setting, null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
