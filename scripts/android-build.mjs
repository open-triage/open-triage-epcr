import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('NEXT_PUBLIC_')) delete env[name];
Object.assign(env, { NEXT_PUBLIC_API_URL: 'same-origin', NEXT_PUBLIC_BASE_PATH: '', NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: 'false' });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}
if (!existsSync(resolve(env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? '', 'platform-tools/adb'))) throw new Error('Set ANDROID_HOME to an Android SDK with platform-tools, platform 36 and build-tools 36.0.0.');
if (process.argv.includes('--native-only')) {
  if (!existsSync(resolve(root, 'android/app/src/main/assets/public/index.html'))) throw new Error('Run npm run android:build before native-only validation.');
} else {
  run('npm', ['run', 'build', '-w', '@open-triage/web']);
  // The APK never installs a service worker, and does not carry an updateable shell.
  rmSync(resolve(root, 'apps/web/out/sw.js'), { force: true });
  run(resolve(root, 'node_modules/.bin/cap'), ['sync', 'android']);
}
const config = JSON.parse(readFileSync(resolve(root, 'android/app/src/main/assets/capacitor.config.json'), 'utf8'));
if (config.server?.url || config.server?.cleartext || config.webDir !== 'apps/web/out' || config.appId !== 'org.opentriage.development') throw new Error('Android development build must use the generic bundled UI and development identity.');
run('./gradlew', ['--no-daemon', ':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug', ':app:assembleDebugAndroidTest'], resolve(root, 'android'));
console.log('Development APK: android/app/build/outputs/apk/debug/app-debug.apk');
