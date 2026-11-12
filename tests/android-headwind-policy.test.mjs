import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {headwindPolicySetting} from '../scripts/android/headwind-policy.mjs';

const policy = {configurationVersion: 1, serverOrigin: 'https://ems.example.invalid', publicCaPem: ''};

test('Headwind JSON setting preserves Android integer and string types, including empty and multiline CA', () => {
  for (const publicCaPem of ['', '-----BEGIN CERTIFICATE-----\nPUBLIC-FIXTURE\n-----END CERTIFICATE-----\n']) {
    const input = {...policy, publicCaPem};
    const setting = headwindPolicySetting(input);
    assert.equal(setting.applicationPkg, 'org.opentriage.android');
    assert.equal(setting.name, 'managedConfig');
    assert.equal(setting.type, 'STRING', 'Server setting type differs from the inner Android integer type');
    assert.equal(setting.variable, false, 'Headwind variable expansion must not alter policy bytes');
    assert.equal(setting.readonly, true);
    assert.deepEqual(JSON.parse(setting.value), input);
  }
});

test('explicit empty Bundle remains represented by a package setting rather than deleting it', () => {
  assert.equal(headwindPolicySetting({}).value, '{}');
  assert.equal(headwindPolicySetting({}).applicationPkg, 'org.opentriage.android');
});

test('operator conversion rejects accidental credentials, wrong types and incomplete configuration', () => {
  for (const input of [null, [], {...policy, configurationVersion: '1'}, {...policy, publicCaPem: null},
    {configurationVersion: 1}, {...policy, pairingToken: 'never-send'}, {...policy, publicCaPem: '-----BEGIN PRIVATE KEY-----'},
    {...policy, publicCaPem: 'x'.repeat(48_001)}]) assert.throws(() => headwindPolicySetting(input));
  for (const serverOrigin of ['http://ems.example.invalid', 'https://user:password@ems.example.invalid',
    'https://ems.example.invalid/', 'https://ems.example.invalid/api', 'https://ems.example.invalid?token=value',
    'https://ems.example.invalid#fragment']) assert.throws(() => headwindPolicySetting({...policy, serverOrigin}));
});

test('CLI emits a usable server template and does not echo malformed input or rejected credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'headwind-policy-'));
  const path = join(directory, 'policy.json');
  const run = () => spawnSync(process.execPath, ['scripts/android/headwind-policy.mjs', path], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  try {
    await writeFile(path, JSON.stringify(policy), {mode: 0o600});
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(JSON.parse(success.stdout), headwindPolicySetting(policy));
    for (const input of ['{"secret":"should-never-be-echoed",', JSON.stringify({...policy, pairingToken: 'should-never-be-echoed'})]) {
      await writeFile(path, input);
      const failure = run();
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, '');
      assert.doesNotMatch(failure.stderr, /should-never-be-echoed/);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
