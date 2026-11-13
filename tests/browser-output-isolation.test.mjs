import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';

test('development and deployment browser runners cannot delete each other’s traces', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import development from './apps/web/playwright.config.ts';
    import deployment from './apps/web/playwright.deployment.config.ts';
    const config = value => value.default ?? value;
    console.log(JSON.stringify([config(development).outputDir, config(deployment).outputDir]));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const directories = JSON.parse(result.stdout).map(value => { assert.equal(typeof value, 'string'); return resolve('apps/web', value); });
  for (const [parent, child] of [directories, [...directories].reverse()]) {
    const path = relative(parent, child);
    assert(path.startsWith(`..${sep}`), 'Playwright cleans its output directory: browser runners need separate, non-nested directories');
  }
});
