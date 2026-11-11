import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateCommand, readTlsFile, validateTlsMaterial, verifyApplicationConnection } from './tls-material.mjs';

const usage = 'node scripts/provision-server-tls.mjs --cert <fullchain.pem> --key <private/tls.key> --hosts <web-host,api-host> (--ca <public-ca.pem> | --system-ca) [--pairing-ca-out <new-public-ca.pem>] [--context <context> --namespace <namespace> --secret <tls-secret> --apply] [--check-url <https://api-host/api/health>]';
export function tlsOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (Object.hasOwn(options, key)) throw new Error(usage);
    if (['--apply', '--system-ca'].includes(key)) { options[key] = true; continue; }
    if (!['--cert', '--key', '--hosts', '--ca', '--pairing-ca-out', '--context', '--namespace', '--secret', '--check-url'].includes(key) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(usage);
    options[key] = argv[++index];
  }
  if (!options['--cert'] || !options['--key'] || !options['--hosts'] || Boolean(options['--ca']) === Boolean(options['--system-ca'])) throw new Error(usage);
  if (options['--apply'] && (!options['--context'] || !options['--namespace'] || !options['--secret'])) throw new Error(usage);
  for (const key of ['--namespace', '--secret']) if (options[key] && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(options[key])) throw new Error('Use valid Kubernetes namespace and Secret names.');
  return options;
}

export async function provisionServerTls(options, { execute = privateCommand, log = console } = {}) {
  const material = await validateTlsMaterial({ certificate: await readTlsFile(options['--cert']), privateKey: await readTlsFile(options['--key'], true),
    ca: options['--ca'] ? await readTlsFile(options['--ca']) : '', hosts: options['--hosts'].split(',') });
  if (options['--pairing-ca-out']) await writeFile(options['--pairing-ca-out'], material.ca, { mode: 0o644, flag: 'wx' });
  if (options['--apply']) {
    // Apply exactly the validated bytes, never re-read a file after validation.
    const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: options['--secret'], namespace: options['--namespace'] }, type: 'kubernetes.io/tls',
      data: { 'tls.crt': Buffer.from(material.certificate).toString('base64'), 'tls.key': Buffer.from(material.privateKey).toString('base64') } };
    await execute('kubectl', ['--context', options['--context'], '--namespace', options['--namespace'], '--request-timeout=30s', 'apply', '--server-side', '--field-manager=open-triage-tls', '--filename', '-', '--output=name'], { input: JSON.stringify(secret) });
    log.info('Validated TLS Secret applied. Wait for ingress rollout before checking every served endpoint.');
  }
  if (options['--check-url']) await verifyApplicationConnection(options['--check-url'], material);
  log.info(`TLS validated for ${material.hosts.join(', ')}; certificate SHA-256 ${material.fingerprint}; expires ${material.expiresAt}.`);
  if (!options['--apply']) log.info('No cluster resources changed.');
  return { fingerprint: material.fingerprint, expiresAt: material.expiresAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--help')) console.log(usage);
  else try { await provisionServerTls(tlsOptions(process.argv.slice(2))); }
  catch (error) { console.error(`TLS provisioning stopped: ${error.message}`); process.exitCode = 1; }
}
