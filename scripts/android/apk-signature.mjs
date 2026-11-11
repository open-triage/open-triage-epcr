import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
/** SDK's shell launcher assumes java on PATH; honor the same JAVA_HOME as Gradle. */
export function verifyApkSignature(sdk, apk, env = process.env) {
  return execFileSync(env.JAVA_HOME ? join(env.JAVA_HOME, 'bin/java') : 'java',
    ['-jar', join(sdk, 'build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk],
    { env, encoding: 'utf8' });
}
