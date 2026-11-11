import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const execute = promisify(execFile);
const MAX_BYTES = 256 * 1024;

/** Only disposable synthetic-emulator diagnostics; never dump argv, vaults, files or bugreports. */
export async function captureAndroidFailure({ root, adb, serial, applicationId = 'org.opentriage.development', executeCommand = execute, secrets = [] }) {
  const directory = join(root, 'android/app/build/reports/android-failure');
  await mkdir(directory, { recursive: true });
  const probes = {
    'crash.txt': ['logcat', '-b', 'crash', '-d', '-t', '500', '-v', 'threadtime'],
    'runtime.txt': ['logcat', '-d', '-t', '500', '-v', 'threadtime', 'AndroidRuntime:E', 'libc:F', 'DEBUG:F', 'chromium:E', 'ActivityManager:I', 'lmkd:I', '*:S'],
    'exit-info.txt': ['shell', 'dumpsys', 'activity', 'exit-info', applicationId],
    'memory.txt': ['shell', 'dumpsys', 'meminfo', applicationId],
    'webview.txt': ['shell', 'dumpsys', 'webviewupdate'],
  };
  await Promise.all(Object.entries(probes).map(async ([name, args]) => {
    let output;
    try {
      const result = await executeCommand(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: MAX_BYTES });
      output = result.stdout;
    } catch (error) {
      // Do not stringify child errors: their command can contain credentials in other callers.
      output = `${error.stdout ?? ''}\nDiagnostic probe unavailable (${error.code ?? 'unknown'})`;
    }
    await writeFile(join(directory, name), Buffer.from(redactAndroidDiagnostics(String(output), secrets)).subarray(0, MAX_BYTES));
  }));
  console.error(`Android failure evidence: ${directory}`);
}

export async function preserveAndroidFailure(error, options) {
  try { await captureAndroidFailure(options); }
  catch { console.error('Android failure diagnostics could not be written'); }
  throw error;
}

export function redactAndroidDiagnostics(output, secrets = []) {
  for (const secret of secrets) if (typeof secret === 'string' && secret.length > 3) output = output.split(secret).join('[redacted]');
  return output.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted PEM]')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?[redacted]')
    .replace(/(["'][\w.-]*(?:password|authorization|cookie|token|secret|artifactBase64|caCertificateBase64)["']\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi, '$1"[redacted]"')
    .replace(/((?:authorization|proxy-authorization)\s*[=:]\s*)(?:Bearer|Basic)\s+[^\s"',;]+/gi, '$1[redacted]')
    .replace(/(open_triage_(?:session|installation|oidc_[A-Za-z0-9_]+)\s*=\s*)[^;\s,"']+/gi, '$1[redacted]')
    .replace(/((?:password|authorization|cookie|token|secret|artifactBase64|caCertificateBase64)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9+/_=-]{100,}/g, '[redacted opaque value]');
}
