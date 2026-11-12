import assert from 'node:assert/strict';
import test from 'node:test';
import { captureAndroidDisplay } from '../scripts/android/display-state.mjs';

for (const customized of [false, true]) test(`host restoration preserves ${customized ? 'custom' : 'default and unset'} display settings after Android process loss`, () => {
  const writes = [];
  const restore = captureAndroidDisplay({ adb: 'synthetic-adb', serial: 'emulator', execute: (_command, args, options) => {
    assert.equal(options.timeout, 10000);
    const command = args.slice(3);
    if (command.join(' ') === 'wm size') return `Physical size: 1080x2400\n${customized ? 'Override size: 900x1600\n' : ''}`;
    if (command.join(' ') === 'wm user-rotation') return customized ? 'lock 3' : 'free';
    if (command[1] === 'get') return customized ? { font_scale: '1.3', accelerometer_rotation: '0', user_rotation: '3' }[command[3]] : 'null';
    writes.push(command); return '';
  } });
  // The host still owns this closure if the application/instrumentation process has died.
  assert.deepEqual(restore(), []);
  assert.deepEqual(writes, [
    ['wm', 'size', customized ? '900x1600' : 'reset'],
    ['wm', 'user-rotation', ...(customized ? ['lock', '3'] : ['free'])],
    ...(customized ? [['settings', 'put', 'system', 'font_scale', '1.3'], ['settings', 'put', 'system', 'accelerometer_rotation', '0'], ['settings', 'put', 'system', 'user_rotation', '3']] :
      ['font_scale', 'accelerometer_rotation', 'user_rotation'].map(name => ['settings', 'delete', 'system', name])),
  ]);
});

test('a failed restore still attempts every captured setting and reports the affected names', () => {
  const attempts = [];
  const restore = captureAndroidDisplay({ adb: 'synthetic', serial: 'emulator', execute: (_command, args) => {
    const command = args.slice(3);
    if (command.join(' ') === 'wm size') return 'Physical size: 1080x2400';
    if (command.join(' ') === 'wm user-rotation') return 'free';
    if (command[1] === 'get') return '1';
    attempts.push(command);
    if (command[1] === 'size' || command.includes('font_scale')) throw new Error('Synthetic disconnected process');
    return '';
  } });
  assert.deepEqual(restore(), ['size', 'font_scale']);
  assert.equal(attempts.length, 5);
});
