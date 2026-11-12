import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bundledPath = name => name === 'ffmpeg' ? require('ffmpeg-static') : require('ffprobe-static').path;

// Follow ReportAudioNormalizer: explicit override, otherwise PATH, with the
// bundled dependency used only when the PATH executable does not exist.
export function verifyAudioToolchain({ env = process.env, execute = spawnSync, bundled = bundledPath } = {}) {
  for (const name of ['ffmpeg', 'ffprobe']) {
    const configured = env[`${name.toUpperCase()}_PATH`];
    const probe = command => execute(command, ['-version'], { env, encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true });
    try {
      let result = probe(configured || name);
      if (!configured && result.error?.code === 'ENOENT') result = probe(bundled(name));
      if (result.error || result.status !== 0 || !new RegExp(`^${name} version `, 'm').test(result.stdout ?? '')) throw new Error('Executable unavailable or invalid');
    } catch {
      throw new Error(`Audio preflight requires a working ${name}. Check ${name.toUpperCase()}_PATH/PATH, or restore bundled tools with npm rebuild ffmpeg-static ffprobe-static (installation scripts must be enabled).`);
    }
  }
}
