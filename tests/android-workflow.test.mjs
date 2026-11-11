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
  const emulator = steps.find(step => step.uses?.startsWith('reactivecircus/android-emulator-runner@'));
  assert.equal(String(emulator.with['api-level']), minimum);
  assert.equal(emulator.with.script, 'npm run android:test -- --skip-build');
  assert(workflow.on.pull_request.branches.includes('feature/android_app'));
});
test('Android browser regressions are included in the full deployment preflight', async () => {
  const directory = new URL('../apps/web/e2e/', import.meta.url);
  const deployment = await readFile(new URL('../apps/web/playwright.deployment.config.ts', import.meta.url), 'utf8');
  const androidSuites = (await readdir(directory)).filter(name => /^android-.*\.spec\.ts$/.test(name));
  assert(androidSuites.length > 0);
  for (const file of androidSuites) assert(deployment.includes(JSON.stringify(file)), `${file}: include Android browser regression in npm run check:ci`);
});
