import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preserveAndroidFailure, redactAndroidDiagnostics } from '../scripts/android/diagnostics.mjs';

for (const category of ['instrumentation process crash', 'nonzero adb exit', 'instrumentation timeout']) {
  test(`${category} preserves bounded native evidence and the original failure`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-diagnostics-'));
    const original = new Error(category), calls = [];
    try {
      await assert.rejects(preserveAndroidFailure(original, { root, adb: 'fake-adb', serial: 'synthetic',
        executeCommand: async (command, args, options) => {
          calls.push(args);
          assert.equal(options.timeout, 10000); assert.equal(options.maxBuffer, 262144);
          if (args.includes('meminfo')) throw Object.assign(new Error('probe failed'), { code: 'ETIMEDOUT' });
          return { stdout: `FATAL EXCEPTION: main\njava.lang.IllegalStateException: synthetic\n${'x'.repeat(300000)}` };
        } }), error => error === original);
      assert.equal(calls.length, 5);
      const directory = join(root, 'android/app/build/reports/android-failure');
      assert((await readFile(join(directory, 'crash.txt'))).length <= 262144);
      assert.match(await readFile(join(directory, 'crash.txt'), 'utf8'), /FATAL EXCEPTION/);
      assert.match(await readFile(join(directory, 'memory.txt'), 'utf8'), /ETIMEDOUT/);
      assert(calls.some(args => args.includes('exit-info')));
      assert(calls.every(args => !args.includes('bugreport') && !args.includes('run-as')));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('crashed instrumentation output, nonzero child and timeout collect evidence before rethrowing', async () => {
  const execute = promisify(execFile);
  for (const script of ["console.log('INSTRUMENTATION_RESULT: shortMsg=Process crashed.');", 'process.exit(7)', 'setInterval(()=>{},1000)']) {
    const root = await mkdtemp(join(tmpdir(), 'android-crash-child-'));
    let collected = 0, original;
    try {
      try {
        const { stdout } = await execute(process.execPath, ['-e', script], {timeout: 1000});
        assert.match(stdout, /OK \(1 test\)/);
      } catch (error) { original = error; }
      assert(original, 'Every instrumentation failure must remain a failure');
      await assert.rejects(preserveAndroidFailure(original, { root, adb: 'fake-adb', serial: 'synthetic',
        executeCommand: async () => { collected++; return {stdout: 'synthetic crash evidence'}; } }), error => error === original);
      assert.equal(collected, 5);
      assert.match(await readFile(join(root, 'android/app/build/reports/android-failure/crash.txt'), 'utf8'), /crash evidence/);
    } finally { await rm(root, {recursive: true, force: true}); }
  }
});
test('collector write failure cannot mask the original instrumentation failure', async () => {
  const original = new Error('process crashed');
  await assert.rejects(preserveAndroidFailure(original, {root: '/dev/null', adb: 'unused', serial: 'synthetic'}), error => error === original);
});
test('exported diagnostics redact credentials, private material and URL queries while retaining stack frames', () => {
  const output = redactAndroidDiagnostics('FATAL EXCEPTION main\n at org.opentriage.Camera.take(Camera.java:42)\npassword=hunter2 Authorization=BearerSecret https://fixture/api?token=querysecret\n-----BEGIN PRIVATE KEY-----\nprivatekey\n-----END PRIVATE KEY-----\nopaque-enrollment', ['opaque-enrollment']);
  for (const secret of ['hunter2','BearerSecret','querysecret','privatekey','opaque-enrollment']) assert(!output.includes(secret));
  assert.match(output, /Camera.java:42/);
});
test('standard authorization headers and quoted JSON credentials are redacted completely', () => {
  const bearer = 'synthetic-short-session-token', nativeSecret = 'synthetic-short-native-secret';
  const output = redactAndroidDiagnostics([
    'at org.opentriage.Camera.take(Camera.java:42)',
    `Authorization: Bearer ${bearer}`,
    'Proxy-Authorization: Basic synthetic-basic-value',
    'Cookie: open_triage_session=synthetic-cookie-one; open_triage_installation=synthetic-cookie-two',
    JSON.stringify({ Authorization: `Bearer ${bearer}`, nativeSecret,
      access_token: 'synthetic-escaped-"credential-value', csrfToken: 'synthetic-csrf-value' }),
  ].join('\n'));
  for (const secret of [bearer, nativeSecret, 'synthetic-basic-value', 'synthetic-cookie-one',
    'synthetic-cookie-two', 'credential-value', 'synthetic-csrf-value']) {
    assert(!output.includes(secret), `Diagnostic credential must be removed: ${secret}`);
  }
  assert.match(output, /Camera.java:42/);
  assert.match(output, /nativeSecret/);
});
test('native runners capture before fixture teardown and CI preserves their report directory', async () => {
  for (const file of ['android-emulator-test.mjs', 'android-release-upgrade.mjs']) {
    const source = await readFile(new URL('../scripts/'+file, import.meta.url), 'utf8');
    assert(source.indexOf('await preserveAndroidFailure(error') < source.lastIndexOf('} finally {'));
  }
  const workflow = await readFile(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: always\(\)/); assert.match(workflow, /android\/app\/build\/reports\//);
});

test('OIDC records bounded asynchronous crash evidence before its own CA/provider cleanup', async () => {
  const source = await readFile(new URL('../scripts/android/oidc-journey.mjs', import.meta.url), 'utf8');
  assert(source.indexOf('await captureAndroidFailure(') < source.lastIndexOf('} finally {'));
  assert.match(source, /error.androidFailureCaptured=true/);
  assert.match(source, /await runInstrumentation\(/);
});
