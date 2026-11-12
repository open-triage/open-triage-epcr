import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyAudioToolchain } from '../scripts/audio-toolchain.mjs';

const missing = { error: { code: 'ENOENT' }, status: null };
const version = name => ({ status: 0, stdout: `${name} version synthetic\n` });

test('system audio tools do not require bundled executables', () => {
  const seen = [];
  verifyAudioToolchain({ env: {}, execute: name => { seen.push(name); return version(name); }, bundled: () => assert.fail('Unexpected fallback') });
  assert.deepEqual(seen, ['ffmpeg', 'ffprobe']);
});

test('missing PATH tools use the installed package executable', () => {
  const seen = [];
  verifyAudioToolchain({ env: {}, execute: name => { seen.push(name); return name.startsWith('/bundled/') ? version(name.split('/').at(-1)) : missing; }, bundled: name => `/bundled/${name}` });
  assert.deepEqual(seen, ['ffmpeg', '/bundled/ffmpeg', 'ffprobe', '/bundled/ffprobe']);
});

test('a present package with missing binary fails early with rebuild instructions', () => {
  assert.throws(() => verifyAudioToolchain({ env: {}, execute: () => missing, bundled: () => '/package-without-binary/ffmpeg' }), /npm rebuild ffmpeg-static ffprobe-static/);
});

test('explicit overrides are authoritative, including missing and invalid executables', () => {
  for (const result of [missing, { error: { code: 'EACCES' } }, { status: 1 }, { status: null, signal: 'SIGTERM' }, { status: 0, stdout: 'different executable' }]) {
    assert.throws(() => verifyAudioToolchain({ env: { FFMPEG_PATH: '/selected/ffmpeg' }, execute: command => { assert.equal(command, '/selected/ffmpeg'); return result; }, bundled: () => assert.fail('Explicit override must not fall back') }), /FFMPEG_PATH/);
  }
  const commands = [];
  verifyAudioToolchain({ env: { FFMPEG_PATH: '/selected/ffmpeg', FFPROBE_PATH: '/selected/ffprobe' }, execute: command => { commands.push(command); return version(command.split('/').at(-1)); } });
  assert.deepEqual(commands, ['/selected/ffmpeg', '/selected/ffprobe']);
});

test('a broken PATH executable cannot silently fall back', () => {
  assert.throws(() => verifyAudioToolchain({ env: {}, execute: () => ({ error: { code: 'EACCES' } }), bundled: () => assert.fail('Permission failure must not fall back') }), /Audio preflight/);
});

test('real invalid executable is rejected and preflight precedes long suites', async () => {
  assert.throws(() => verifyAudioToolchain({ env: { ...process.env, FFMPEG_PATH: process.execPath }, execute: spawnSync }), /Audio preflight/);
  const source = await readFile(new URL('../scripts/check-ci.mjs', import.meta.url), 'utf8');
  assert(source.indexOf('verifyAudioToolchain();') < source.indexOf('npm(["run", "check:workflows"]'));
});
