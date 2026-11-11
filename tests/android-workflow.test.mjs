import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';

const workflows = new URL('../.github/workflows/', import.meta.url);
test('every Android SDK setup declares current packages rather than relying on retired action defaults', async () => {
  let setups = 0;
  for (const file of await readdir(workflows)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const workflow = yaml.load(await readFile(new URL(file, workflows), 'utf8'));
    for (const job of Object.values(workflow.jobs ?? {})) for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith('android-actions/setup-android@')) continue;
      setups++;
      assert.equal(typeof step.with?.packages, 'string', `${file}: explicitly configure Android SDK packages`);
      const packages = step.with.packages.trim().split(/\s+/);
      assert(packages.includes('platform-tools'), `${file}: platform-tools required for actual device checks`);
      assert(!packages.includes('tools'), `${file}: retired SDK tools package is unavailable`);
      assert(packages.every(name => /^(platform-tools|platforms;android-\d+|build-tools;\d+\.\d+\.\d+|emulator|system-images;android-\d+;[^;\s]+;[^;\s]+)$/.test(name)), `${file}: unsupported/implicit SDK package`);
    }
  }
  assert(setups > 0);
});
test('Android PR validation uses the same compile SDK, native build and minimum-runtime journey as local checks', async () => {
  const workflow = yaml.load(await readFile(new URL('android.yml', workflows), 'utf8'));
  const variables = await readFile(new URL('../android/variables.gradle', import.meta.url), 'utf8');
  const compile = /compileSdkVersion = (\d+)/.exec(variables)[1], minimum = /minSdkVersion = (\d+)/.exec(variables)[1];
  const steps = workflow.jobs['android-13'].steps;
  const setup = steps.find(step => step.uses?.startsWith('android-actions/setup-android@'));
  assert(setup.with.packages.split(/\s+/).includes(`platforms;android-${compile}`));
  assert(steps.some(step => step.run === 'npm run android:build'));
  assert(steps.findIndex(step => step.run === 'node --test tests/android-*.test.mjs') < steps.findIndex(step => step.run === 'npm run android:build'));
  assert(steps.some(step => step.run === 'node --test tests/android-*.test.mjs'));
  const emulator = steps.find(step => step.uses?.startsWith('reactivecircus/android-emulator-runner@'));
  assert.equal(String(emulator.with['api-level']), minimum);
  assert.equal(emulator.with.script, 'npm run android:test -- --skip-build');
  assert(workflow.on.pull_request.branches.includes('feature/android_app'));
});

test('Android declares network observation so WebView emits real online/offline transitions', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /<uses-permission\s+android:name="android\.permission\.ACCESS_NETWORK_STATE"\s*\/>/);
});

test('Android browser regressions are included in the full deployment preflight', async () => {
  const directory = new URL('../apps/web/e2e/', import.meta.url);
  const deployment = await readFile(new URL('../apps/web/playwright.deployment.config.ts', import.meta.url), 'utf8');
  const androidSuites = (await readdir(directory)).filter(name => /^android-.*\.spec\.ts$/.test(name));
  assert(androidSuites.length > 0);
  for (const file of androidSuites) assert(deployment.includes(JSON.stringify(file)), `${file}: include Android browser regression in npm run check:ci`);
});

test('production publication is serialized, gated by preflight and protected environment, and uploads no instrumentation', async () => {
  const workflow = yaml.load(await readFile(new URL('android-release.yml', workflows), 'utf8'));
  assert.deepEqual(workflow.on.push.tags, ['android-v*']);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.release.environment, 'android-release');
  assert.equal(workflow.jobs.release.needs, 'preflight');
  assert(workflow.jobs.preflight.steps.some(step => step.run === 'npm run check:ci'));
  const emulator = workflow.jobs.release.steps.find(step => step.uses?.startsWith('reactivecircus/android-emulator-runner@'));
  assert.equal(emulator.with.script, 'node scripts/android-release-candidate.mjs');
  assert.equal(String(emulator.with['api-level']), '33');
  assert(!workflow.jobs.release.steps.some(step => step.uses?.startsWith('actions/upload-artifact@')));
  const publication = await readFile(new URL('../scripts/android-release-publish.mjs', import.meta.url), 'utf8');
  assert(!publication.includes('androidTest.apk'));
  assert.match(publication, /published\.immutable, true/);
});


test('Android audio declares optional microphone access and keeps real saved/unfinished media acceptance in the default journey', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /<uses-permission\s+android:name="android\.permission\.RECORD_AUDIO"\s*\/>/);
  assert.match(manifest, /<uses-feature\s+android:name="android\.hardware\.microphone"\s+android:required="false"\s*\/>/);
  const runner = await readFile(new URL('../scripts/android-emulator-test.mjs', import.meta.url), 'utf8');
  assert.match(runner, /fixture: fixtures\[0\][^\n]*audio: true/);
  assert.match(runner, /fixture: fixtures\[1\][^\n]*audio: true[^\n]*unsavedAudio: true/);
});
