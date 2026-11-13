import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

/** The synthetic HTTPS server hosts the clinical UI; it is never copied into the APK. */
export function buildHostedUi(root) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('NEXT_PUBLIC_')) delete env[name];
  Object.assign(env, { NEXT_PUBLIC_API_URL: 'same-origin', NEXT_PUBLIC_BASE_PATH: '', NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: 'false' });
  const result = spawnSync('npm', ['run', 'build', '-w', '@open-triage/web'], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Hosted clinical UI build failed');
}
