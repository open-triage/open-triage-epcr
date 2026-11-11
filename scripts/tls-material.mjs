import { X509Certificate, createPrivateKey } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import https from 'node:https';

const MAX_PEM = 1024 * 1024;
export async function readTlsFile(file, privateKey = false) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PEM || privateKey && ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid())) {
      throw new Error('TLS inputs must be bounded regular files; the private key must be owner-only (chmod 600).');
    }
    const bytes = await handle.readFile();
    if (bytes.length > MAX_PEM) throw new Error('TLS input is too large.');
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}

export function publicCertificates(pem) {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length || blocks.length > 16 || pem.replace(/-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g, '').trim()) {
    throw new Error('Supply only public PEM certificates, with the server certificate first in the full chain.');
  }
  try { return blocks.map(block => new X509Certificate(block)); }
  catch { throw new Error('A public certificate could not be parsed.'); }
}

/** Commands never echo PEM, private keys, rendered Secrets, or child stderr. */
export function privateCommand(command, args, { input, timeoutMs = 30_000, killGraceMs = 2_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let size = 0;
    let killTimer;
    const clearTimers = () => { clearTimeout(timer); clearTimeout(killTimer); };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        // Also settle when an inherited pipe remains open in a credential helper.
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        clearTimers(); reject(new Error(`${command} timed out. No private material was printed.`));
      }, killGraceMs);
    }, timeoutMs);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_PEM) child.kill('SIGTERM'); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimers(); reject(new Error(`Cannot run ${command}. Install the documented operator prerequisites.`)); });
    child.once('close', code => { clearTimers(); code === 0 ? resolve() : reject(new Error(`${command} validation or application failed. No private material was printed.`)); });
    child.stdin.end(input);
  });
}

export async function validateTlsMaterial({ certificate, privateKey, ca = '', hosts, now = Date.now() }, { execute = privateCommand } = {}) {
  if (!Array.isArray(hosts) || !hosts.length || hosts.some(host => typeof host !== 'string' || !host || host.includes('*') || host.includes('\n'))) throw new Error('Supply every exact ingress hostname.');
  const chain = publicCertificates(certificate), roots = ca ? publicCertificates(ca) : [];
  const leaf = chain[0];
  if (leaf.ca || [...chain, ...roots].some(cert => Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) || roots.some(cert => !cert.ca)) throw new Error('Certificates must be currently valid; public trust must contain CA certificates.');
  for (const host of hosts) {
    if (!(isIP(host) ? leaf.checkIP(host) : leaf.checkHost(host, { subject: 'never' }))) throw new Error('The server certificate must cover every exact ingress hostname in its SANs.');
  }
  try {
    if (!leaf.checkPrivateKey(createPrivateKey(privateKey))) throw new Error();
  } catch { throw new Error('The unencrypted private key must match the server certificate.'); }
  const directory = await mkdtemp(join(tmpdir(), 'open-triage-tls-validation-'));
  try {
    // Only public certificates are written. The private key stays in memory.
    const leafPath = join(directory, 'leaf.pem'), chainPath = join(directory, 'chain.pem'), caPath = join(directory, 'ca.pem');
    await writeFile(leafPath, leaf.toString(), { mode: 0o600 });
    if (chain.length > 1) await writeFile(chainPath, chain.slice(1).map(cert => cert.toString()).join(''), { mode: 0o600 });
    if (roots.length) await writeFile(caPath, roots.map(cert => cert.toString()).join(''), { mode: 0o600 });
    for (const host of hosts) await execute('openssl', ['verify', '-purpose', 'sslserver', '-attime', String(Math.floor(now / 1000)),
      ...(roots.length ? ['-CAfile', caPath, '-no-CApath', '-no-CAstore'] : []),
      ...(chain.length > 1 ? ['-untrusted', chainPath] : []), isIP(host) ? '-verify_ip' : '-verify_hostname', host, leafPath]);
  } finally { await rm(directory, { recursive: true, force: true }); }
  return { certificate, privateKey, ca: roots.map(cert => cert.toString()).join(''), hosts: [...new Set(hosts)],
    fingerprint: leaf.fingerprint256.replaceAll(':', '').toLowerCase(), expiresAt: new Date(leaf.validTo).toISOString() };
}

export async function verifyApplicationConnection(url, material, { timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || target.search || target.pathname !== '/api/health' ||
      !material.hosts.includes(target.hostname)) throw new Error('Health verification requires https://<validated-host>/api/health.');
  await new Promise((resolve, reject) => {
    let request, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) { request?.destroy(); reject(error); } else resolve();
    };
    const fail = () => finish(new Error('Verified application connection failed. Check ingress rollout, certificate chain, hostname and API readiness.'));
    // A socket inactivity timeout alone lets a slow response extend this operation forever.
    const deadline = setTimeout(fail, timeoutMs);
    try { request = https.get(target, { ...(material.ca ? { ca: material.ca } : {}), rejectUnauthorized: true, agent: false, timeout: timeoutMs }, response => {
      const peer = response.socket.getPeerCertificate();
      let body = '', size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 16384) fail(); else body += chunk; });
      response.on('error', fail);
      response.on('aborted', fail);
      response.on('close', () => { if (!response.complete) fail(); });
      response.on('end', () => {
        try {
          const health = JSON.parse(body);
          if (!response.complete || size > 16384 || response.statusCode !== 200 || health.status !== 'ok' || health.service !== 'open-triage-api' ||
              peer.fingerprint256?.replaceAll(':', '').toLowerCase() !== material.fingerprint) return fail();
          finish();
        } catch { fail(); }
      });
    }); } catch { fail(); return; }
    request.on('timeout', fail);
    request.on('error', fail);
  });
}
