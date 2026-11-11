import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm, writeFile, chmod, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createTlsFixtures } from '../scripts/android/tls-fixtures.mjs';
import { privateCommand, publicCertificates, readTlsFile, validateTlsMaterial, verifyApplicationConnection } from '../scripts/tls-material.mjs';
import { provisionServerTls, tlsOptions } from '../scripts/provision-server-tls.mjs';
import { installTlsFixtureControl } from '../scripts/android/tls-fixture-control.mjs';
import { redactAndroidDiagnostics } from '../scripts/android/diagnostics.mjs';

let directory, fixtures;
before(async () => { directory = await mkdtemp(join(tmpdir(), 'android-tls-test-')); fixtures = await createTlsFixtures(directory); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('TLS instrumentation keeps opaque evidence while removing credentials and supplied artifact arguments',()=>{
  const digest='a'.repeat(64),artifact='synthetic-fresh-pairing-artifact';
  const output=redactAndroidDiagnostics(`pending_token_sha256=${digest}\npending_intent_sha256=${digest}\nAuthorization: Bearer synthetic-native-secret\n${artifact}`, [artifact]);
  assert(output.includes(`pending_token_sha256=${digest}`));assert(output.includes(`pending_intent_sha256=${digest}`));
  assert(!output.includes('synthetic-native-secret'));assert(!output.includes(artifact));
});

test('operator subprocess timeout kills a SIGTERM-resistant child and never exposes its streams', { timeout: 5000 }, async () => {
  const started = Date.now();
  await assert.rejects(privateCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('SYNTHETIC-PRIVATE-OUTPUT');process.stderr.write('SYNTHETIC-PRIVATE-ERROR');setInterval(()=>{},1000)"],
    { input: 'SYNTHETIC-PRIVATE-INPUT', timeoutMs: 200, killGraceMs: 50 }), error => !error.message.includes('SYNTHETIC-PRIVATE') && /timed out|failed/.test(error.message));
  assert(Date.now() - started < 3000);
});

test('operator validation checks matching key, every SAN, server purpose, chain and validity without printing material', async () => {
  const good = await validateTlsMaterial(fixtures.first);
  assert.match(good.fingerprint, /^[a-f0-9]{64}$/);
  assert(!good.ca.includes('PRIVATE KEY'));
  for (const bad of [
    { ...fixtures.first, privateKey: fixtures.renewed.privateKey },
    { ...fixtures.first, ca: fixtures.replacement.ca },
    { ...fixtures.first, hosts: ['other.invalid'] },
    { ...fixtures.first, ca: fixtures.first.certificate },
    { ...fixtures.first, certificate: fixtures.first.certificate + fixtures.first.privateKey },
    { ...fixtures.first, now: Date.now() + 3 * 24 * 3600 * 1000 },
    fixtures['wrong-host'], fixtures['wrong-purpose'], fixtures.expired,
  ]) await assert.rejects(validateTlsMaterial(bad), error => !error.message.includes('BEGIN') && !error.message.includes('MII'));
  assert.throws(() => publicCertificates(fixtures.first.ca + '\nprivate-extra-data'));
});

test('same CA renewal and explicit overlapping/new CA trust work while unauthorized replacement and wrong host fail', async () => {
  const server = https.createServer({ key: fixtures.first.privateKey, cert: fixtures.first.certificate }, (_req, res) => {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', service: 'open-triage-api' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `https://127.0.0.1:${server.address().port}/api/health`;
  try {
    const first = await validateTlsMaterial(fixtures.first);
    await verifyApplicationConnection(url, first);
    server.setSecureContext({ key: fixtures.renewed.privateKey, cert: fixtures.renewed.certificate });
    const renewed = await validateTlsMaterial(fixtures.renewed);
    assert.notEqual(renewed.fingerprint, first.fingerprint);
    await verifyApplicationConnection(url, renewed);
    // A handshake still trusts the old CA; the operator also checks the exact new leaf.
    await assert.rejects(verifyApplicationConnection(url, first));
    server.setSecureContext({ key: fixtures.replacement.privateKey, cert: fixtures.replacement.certificate });
    await assert.rejects(verifyApplicationConnection(url, renewed));
    const replacement = await validateTlsMaterial(fixtures.replacement);
    await verifyApplicationConnection(url, replacement);
    const overlap = await validateTlsMaterial({ ...fixtures.replacement, ca: fixtures.first.ca + fixtures.replacement.ca });
    await verifyApplicationConnection(url, overlap);
    server.setSecureContext({ key: fixtures['wrong-host'].privateKey, cert: fixtures['wrong-host'].certificate });
    await assert.rejects(verifyApplicationConnection(url, { ...first, fingerprint: publicCertificates(fixtures['wrong-host'].certificate)[0].fingerprint256.replaceAll(':', '').toLowerCase() }));
    server.setSecureContext({ key: fixtures.expired.privateKey, cert: fixtures.expired.certificate });
    await assert.rejects(verifyApplicationConnection(url, { ...first, fingerprint: publicCertificates(fixtures.expired.certificate)[0].fingerprint256.replaceAll(':', '').toLowerCase() }));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('provisioning uses existing TLS Secret with validated bytes on stdin and exports public CA only', async () => {
  const certificate = join(directory, 'operator-chain.pem'), key = join(directory, 'operator-private.key'), ca = join(directory, 'operator-ca.pem'), output = join(directory, 'pairing-public.pem');
  await writeFile(certificate, fixtures.first.certificate); await writeFile(key, fixtures.first.privateKey, { mode: 0o600 }); await writeFile(ca, fixtures.first.ca);
  const options = tlsOptions(['--cert', certificate, '--key', key, '--hosts', 'localhost,127.0.0.1', '--ca', ca, '--pairing-ca-out', output,
    '--context', 'approved-context', '--namespace', 'open-triage', '--secret', 'open-triage-tls', '--apply']);
  const calls = [], logs = [];
  await provisionServerTls(options, { execute: async (command, args, settings) => calls.push({ command, args, settings }), log: { info: message => logs.push(message) } });
  assert.equal(calls.length, 1); assert.equal(calls[0].command, 'kubectl');
  assert(calls[0].args.includes('--server-side')); assert(calls[0].args.includes('--context'));
  const secret = JSON.parse(calls[0].settings.input);
  assert.equal(secret.type, 'kubernetes.io/tls'); assert.equal(secret.metadata.name, 'open-triage-tls');
  assert.equal(Buffer.from(secret.data['tls.key'], 'base64').toString(), fixtures.first.privateKey);
  assert.equal(Buffer.from(secret.data['tls.crt'], 'base64').toString(), fixtures.first.certificate);
  assert(!JSON.stringify(calls[0].args).includes('BEGIN')); assert(!logs.join('').includes('BEGIN'));
  assert.equal(await readFile(output, 'utf8'), fixtures.first.ca);
  await assert.rejects(provisionServerTls(options, { execute: async () => assert.fail('must not apply when export already exists') }), /EEXIST/);
  await chmod(key, 0o644); await assert.rejects(readTlsFile(key, true), /owner-only/);
  await chmod(key, 0o600); const link = join(directory, 'key-link'); await symlink(key, link); await assert.rejects(readTlsFile(link, true));
  for (const argv of [[], ['--cert', certificate, '--key', key, '--hosts', 'localhost'], ['--cert', certificate, '--key', key, '--hosts', 'localhost', '--ca', ca, '--system-ca'],
    ['--cert', certificate, '--key', key, '--hosts', 'localhost', '--ca', ca, '--apply']]) assert.throws(() => tlsOptions(argv));
});

test('explicit system trust exports an empty pairing CA and names the Android platform trust requirement', async () => {
  const certificate = join(directory, 'system-chain.pem'), key = join(directory, 'system-private.key'), ca = join(directory, 'test-host-platform-roots.pem'), output = join(directory, 'system-pairing-ca.pem');
  await writeFile(certificate, fixtures.first.certificate); await writeFile(key, fixtures.first.privateKey, { mode: 0o600 }); await writeFile(ca, fixtures.first.ca);
  const previous = process.env.SSL_CERT_FILE;
  try {
    // Supply only this test process's synthetic OpenSSL platform root, not app CA material.
    process.env.SSL_CERT_FILE = ca;
    const logs = [];
    await provisionServerTls(tlsOptions(['--cert', certificate, '--key', key, '--hosts', 'localhost', '--system-ca', '--pairing-ca-out', output]),
      { execute: async () => assert.fail('read-only validation must not invoke kubectl'), log: { info: message => logs.push(message) } });
    assert.equal(await readFile(output, 'utf8'), '');
    assert(logs.some(message => message.includes('Android platform roots') && message.includes('empty')));
  } finally { if (previous === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = previous; }
});

test('synthetic TLS control accepts only predeclared IPC variants and discloses no path or material', async () => {
  const channel = new EventEmitter(), reads = [], contexts = [], replies = [];
  channel.send = message => { replies.push(message); channel.emit('reply', message); };
  const remove = installTlsFixtureControl({ setSecureContext: context => contexts.push(context) }, { approved: { keyPath: 'private-predeclared-key', certPath: 'public-predeclared-chain' } }, channel,
    async path => { reads.push(path); return Buffer.from(path); }, () => 17);
  try {
    const rejected = once(channel, 'reply');
    channel.emit('message', { type: 'android-fixture-tls', requestId: randomUUID(), variant: 'attacker', keyPath: 'outside-key', certPath: 'outside-chain' });
    await rejected;
    assert.equal(reads.length, 0); assert.equal(contexts.length, 0); assert.equal(replies[0].changed, false);
    const accepted = once(channel, 'reply');
    channel.emit('message', { type: 'android-fixture-tls', requestId: randomUUID(), variant: 'approved', keyPath: 'outside-key' });
    await accepted;
    assert.deepEqual(reads, ['private-predeclared-key', 'public-predeclared-chain']); assert.equal(contexts.length, 1);
    assert.equal(replies[1].changed, true); assert(!JSON.stringify(replies).includes('predeclared'));
    const observed = once(channel, 'reply');
    channel.emit('message', { type: 'android-fixture-tls-observe', requestId: randomUUID() }); await observed;
    assert.equal(replies[2].acceptedRequests, 17); assert.equal(contexts.length, 1);
  } finally { remove(); }
});
