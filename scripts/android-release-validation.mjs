import { verifyApkSignature } from './android/apk-signature.mjs';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { verifyApkMetadata } from './android/release-contract.mjs';
// PR-safe native production configuration regression. This disposable key is never a release identity.
const root = resolve(import.meta.dirname, '..'), directory = mkdtempSync(join(tmpdir(), 'android-release-validation-'));
const password = randomBytes(32).toString('base64url');
const env = { ...process.env, ANDROID_PRODUCTION_RELEASE: '1', ANDROID_RELEASE_INSTRUMENTATION: '1', ANDROID_VERSION_CODE: '2', ANDROID_VERSION_NAME: '0.0.0-validation', ANDROID_KEYSTORE_PATH: join(directory, 'test.p12'), ANDROID_KEYSTORE_PASSWORD: password, ANDROID_KEY_PASSWORD: password, ANDROID_KEY_ALIAS: 'disposable-validation' };
function run(command, args, cwd = root) { const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' }); if (result.error) throw result.error; assert.equal(result.status, 0, `${command} failed`); }
try {
  assert(existsSync(join(root, 'android/app/src/main/assets/public/index.html')), 'Build the bundled UI first with npm run android:build');
  run(join(env.JAVA_HOME, 'bin/keytool'), ['-genkeypair', '-keystore', env.ANDROID_KEYSTORE_PATH, '-storetype', 'PKCS12', '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD', '-keypass:env', 'ANDROID_KEY_PASSWORD', '-alias', env.ANDROID_KEY_ALIAS, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=Disposable Android validation']);
  run('./gradlew', ['--no-daemon', ':app:testReleaseUnitTest', ':app:lintRelease', ':app:assembleRelease', ':app:assembleReleaseAndroidTest'], join(root, 'android'));
  const tools = join(env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT, 'build-tools/36.0.0'), apk = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
  const signature = verifyApkSignature(env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT, apk, env);
  const certificateSha256 = /Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/.exec(signature)[1];
  verifyApkMetadata(execFileSync(join(tools, 'aapt'), ['dump', 'badging', apk], { encoding: 'utf8' }), signature, { applicationId: 'org.opentriage.android', versionCode: 2, versionName: '0.0.0-validation', certificateSha256 });
  const refused = spawnSync('./gradlew', ['--no-daemon', ':app:assembleDebug'], { cwd: join(root, 'android'), env, encoding: 'utf8' });
  assert.notEqual(refused.status, 0, 'Production configuration must not expose a debug APK variant');
  assert.match(refused.stdout + refused.stderr, /assembleDebug.*not found|Cannot locate tasks.*assembleDebug/s);
  console.log('PASS disposable-key production build/signature regression; this is not permanent signing or device acceptance');
} finally { await rmSync(directory, { recursive: true, force: true }); }
