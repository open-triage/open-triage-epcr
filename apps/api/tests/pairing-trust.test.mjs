import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pairingCaPem } from '../dist/admin/pairing-trust.js';
import { InstallationEnrollmentService } from '../dist/admin/installation-enrollment.service.js';
import { agencyRequest } from '../dist/sessions/agency-context.js';

const ca = await readFile(new URL('../../../android/app/src/test/resources/tls/ca.pem', import.meta.url), 'utf8');
const now = Date.parse(new X509Certificate(ca).validFrom) + 1000;
test('pairing uses platform trust by default and only operator-provisioned public CA roots', async () => {
  assert.equal(pairingCaPem({}), '');
  const directory = await mkdtemp(join(tmpdir(), 'pairing-trust-'));
  const file = join(directory, 'ca.pem');
  try {
    await writeFile(file, ca);
    assert.equal(pairingCaPem({PAIRING_CA_FILE:file}, now), ca);
    await writeFile(file, ca + ca);
    assert.equal(pairingCaPem({PAIRING_CA_FILE:file}, now), ca + ca);
    assert.throws(() => pairingCaPem({PAIRING_CA_FILE:file}, 0), /unavailable/);
    assert.throws(() => pairingCaPem({PAIRING_CA_FILE:file}, Date.parse(new X509Certificate(ca).validTo) + 1), /unavailable/);
    const leaf = execFileSync('openssl', ['pkcs12', '-in', fileURLToPath(new URL('../../../android/app/src/test/resources/tls/server.p12', import.meta.url)), '-passin', 'pass:synthetic-only', '-clcerts', '-nokeys'], {encoding:'utf8'}).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)[0];
    for (const invalid of ['', ca + '\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----', 'invalid', leaf, ' '.repeat(48001)]) {
      await writeFile(file, invalid);
      assert.throws(() => pairingCaPem({PAIRING_CA_FILE:file}, now), /unavailable/);
    }
    assert.throws(() => pairingCaPem({PAIRING_CA_FILE:directory}), /unavailable/);
    assert.throws(() => pairingCaPem({PAIRING_CA_FILE:join(directory,'missing')}), /unavailable/);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

test('issuance supplies server trust with the authorization and never accepts caller CA claims', async () => {
  const original = process.env.PAIRING_CA_FILE;
  const directory = await mkdtemp(join(tmpdir(), 'pairing-issue-'));
  delete process.env.PAIRING_CA_FILE;
  try {
    const manager = {query:async query => query.includes('returning expires_at') ? [{expiresAt:'2099-01-01T00:00:00Z'}] : []};
    const service = new InstallationEnrollmentService({transaction:async fn => fn(manager)},
      {requireCapability:async()=>({organization:{id:'organization'},user:{id:'actor'}})}, {allowsOrigin:async()=>true});
    service.unit = async()=>({});
    const issue = input => agencyRequest.run({origin:'https://localhost:3443'}, () => service.issue('session','unit',input));
    assert.equal((await issue()).caPem, '');
    await writeFile(join(directory,'ca.pem'), ca);
    process.env.PAIRING_CA_FILE = join(directory,'ca.pem');
    assert.equal((await issue()).caPem, ca);
    await assert.rejects(issue({caPem:ca}), /Pairing expiry/);
    process.env.PAIRING_CA_FILE = '/nonexistent/pairing-ca.pem';
    await assert.rejects(issue(), /Pairing trust configuration is unavailable/);
  } finally {
    await rm(directory, {recursive:true,force:true});
    if (original === undefined) delete process.env.PAIRING_CA_FILE;
    else process.env.PAIRING_CA_FILE = original;
  }
});
