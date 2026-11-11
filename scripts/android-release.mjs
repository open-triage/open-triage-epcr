import { verifyNativeStartup } from './android/native-startup.mjs';
import { verifyApkSignature } from './android/apk-signature.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { validateReleaseInputs, validateUpgrade, verifyApkMetadata, compatibility } from './android/release-contract.mjs';

const root = resolve(import.meta.dirname, '..'), env = { ...process.env, ANDROID_PRODUCTION_RELEASE: '1' };
const identity = validateReleaseInputs(env);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Release builds require a clean committed source tree');
const selected = JSON.parse(readFileSync(join(root, 'docs/releases/android/signing-identity.json'), 'utf8'));
assert.equal(identity.certificateSha256, selected.certificateSha256, 'Signing configuration must match the selected permanent production identity'); // Fail before expensive build or touching output.
const output = resolve(env.ANDROID_RELEASE_OUTPUT ?? join(root, '.local/android-releases', `${identity.versionCode}`));
assert(!existsSync(output), 'Release output already exists; immutable artifacts must not be overwritten');
const sdk = resolve(env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? ''), tools = join(sdk, 'build-tools/36.0.0');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed (${result.status ?? result.signal})`);
}
if (!process.argv.includes('--native-only')) {
  const buildEnv = { ...env, ANDROID_PRODUCTION_RELEASE: '0' };
  for (const name of Object.keys(buildEnv)) if (/^ANDROID_(KEY|CERTIFICATE)/.test(name)) delete buildEnv[name];
  const build = spawnSync('npm', ['run', 'android:build'], { cwd: root, env: buildEnv, stdio: 'inherit' });
  assert.equal(build.status, 0, 'Bundled UI/development validation failed');
}
const config = JSON.parse(readFileSync(join(root, 'android/app/src/main/assets/capacitor.config.json'), 'utf8'));
assert(!config.server?.url && !config.server?.cleartext && config.server?.hostname === 'localhost', 'APK must serve its installed assets');
assert(!existsSync(join(root, 'android/app/src/main/assets/public/sw.js')), 'APK must not contain an updateable service worker');
// Capacitor metadata matches the APK while the Java namespace remains stable.
config.appId = identity.applicationId; config.appName = 'OpenTriage';
writeFileSync(join(root, 'android/app/src/main/assets/capacitor.config.json'), JSON.stringify(config));
const tasks = [':app:testReleaseUnitTest', ':app:lintRelease', ':app:assembleRelease'];
if (env.ANDROID_RELEASE_INSTRUMENTATION === '1') tasks.push(':app:assembleReleaseAndroidTest');
run('./gradlew', ['--no-daemon', ...tasks], join(root, 'android'));
verifyNativeStartup(root, 'release', {instrumentation:env.ANDROID_RELEASE_INSTRUMENTATION === '1'});
const source = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const signature = verifyApkSignature(sdk, source, env);
const metadata = execFileSync(join(tools, 'aapt'), ['dump', 'badging', source], { env, encoding: 'utf8' });
verifyApkMetadata(metadata, signature, identity);
const bytes = readFileSync(source), apkSha256 = createHash('sha256').update(bytes).digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const jar = env.JAVA_HOME ? join(env.JAVA_HOME, 'bin/jar') : 'jar';
const packaged = execFileSync(jar, ['tf', source], { encoding: 'utf8' }).trim().split('\n').filter(name => name.startsWith('assets/public/') && !name.endsWith('/')).sort();
assert(packaged.length > 0 && packaged.every(name => !name.split('/').includes('..')), 'Packaged UI entries must be bounded assets');
const uiHash = createHash('sha256'), extracted = mkdtempSync(join(tmpdir(), 'android-packaged-ui-'));
try {
  execFileSync(jar, ['xf', source, 'assets/public'], { cwd: extracted });
  for (const name of packaged) { uiHash.update(name); uiHash.update('\0'); uiHash.update(readFileSync(join(extracted, name))); }
} finally { rmSync(extracted, { recursive: true, force: true }); }
const descriptor = { schemaVersion: 1, ...identity, apkSha256, apkBytes: bytes.length, uiSha256: uiHash.digest('hex'), sourceCommit, compatibility, minAndroidApi: 33, targetAndroidApi: 36, artifact: `opentriage-${identity.versionName}-${identity.versionCode}-${apkSha256}.apk` };
if (env.ANDROID_PREVIOUS_DESCRIPTOR) validateUpgrade(JSON.parse(readFileSync(env.ANDROID_PREVIOUS_DESCRIPTOR, 'utf8')), descriptor);
mkdirSync(output, { recursive: true, mode: 0o700 });
writeFileSync(join(output, descriptor.artifact), bytes, { flag: 'wx', mode: 0o644 });
writeFileSync(join(output, 'release.json'), JSON.stringify(descriptor, null, 2) + '\n', { flag: 'wx' });
writeFileSync(join(output, 'SHA256SUMS'), `${apkSha256}  ${descriptor.artifact}\n`, { flag: 'wx' });
console.log(`Verified production APK and descriptor: ${output}`);
