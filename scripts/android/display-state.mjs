import { execFileSync } from 'node:child_process';

/** Host-owned restoration also runs when the instrumented Android process crashes. */
export function captureAndroidDisplay({ adb, serial, execute = execFileSync }) {
  const shell = args => execute(adb, ['-s', serial, 'shell', ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 }).trim();
  const size = shell(['wm', 'size']);
  const override = /Override size: (\d+x\d+)/.exec(size)?.[1];
  if (!/Physical size: \d+x\d+/.test(size) || (size.includes('Override size:') && !override)) throw new Error('Cannot capture Android display size');
  // AOSP WindowManagerShellCommand exposes the actual rotation lock, independently of Settings.
  const rotation = shell(['wm', 'user-rotation']);
  if (!/^(?:free|lock [0-3])$/.test(rotation)) throw new Error('Cannot capture Android rotation lock');
  const commands = [['size', ['wm', 'size', override ?? 'reset']], ['rotation', ['wm', 'user-rotation', ...rotation.split(' ')]]];
  for (const name of ['font_scale', 'accelerometer_rotation', 'user_rotation']) {
    const value = shell(['settings', 'get', 'system', name]);
    if (value !== 'null' && !/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Cannot capture Android display setting ${name}`);
    commands.push([name, value === 'null' ? ['settings', 'delete', 'system', name] : ['settings', 'put', 'system', name, value]]);
  }
  return () => {
    const failed = [];
    for (const [name, command] of commands) {
      try { shell(command); } catch { failed.push(name); }
    }
    return failed;
  };
}

export function restoreAndroidDisplay(restore) {
  const failed = restore?.() ?? [];
  if (failed.length) {
    console.error(`Android display restoration failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}
