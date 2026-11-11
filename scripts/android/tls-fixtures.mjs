import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Runtime-generated public/private synthetic PKI, never installation credentials. */
export async function createTlsFixtures(directory) {
  const run = args => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'ignore'] });
  const file = name => join(directory, name);
  for (const name of ['old', 'replacement']) run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', file(`${name}.key`), '-out', file(`${name}.pem`),
    '-days', '2', '-subj', `/CN=OpenTriage synthetic ${name} CA`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  for (const [name, issuer, purpose, san] of [
    ['first', 'old', 'serverAuth', 'DNS:localhost,IP:127.0.0.1,IP:10.0.2.2'],
    ['renewed', 'old', 'serverAuth', 'DNS:localhost,IP:127.0.0.1,IP:10.0.2.2'],
    ['replacement', 'replacement', 'serverAuth', 'DNS:localhost,IP:127.0.0.1,IP:10.0.2.2'],
    ['wrong-host', 'old', 'serverAuth', 'DNS:wrong.invalid'],
    ['wrong-purpose', 'old', 'clientAuth', 'DNS:localhost,IP:127.0.0.1,IP:10.0.2.2'],
  ]) {
    const stem = `server-${name}`;
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', file(`${stem}.key`), '-out', file(`${stem}.csr`), '-subj', '/CN=Synthetic Android TLS server']);
    await writeFile(file(`${stem}.ext`), `subjectAltName=${san}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=${purpose}\n`);
    run(['x509', '-req', '-in', file(`${stem}.csr`), '-CA', file(`${issuer}.pem`), '-CAkey', file(`${issuer}.key`), '-CAcreateserial', '-out', file(`${stem}.pem`), '-days', '2', '-extfile', file(`${stem}.ext`)]);
  }
  await writeFile(file('index.txt'), ''); await writeFile(file('serial'), '01\n');
  await writeFile(file('expired.cnf'), `[ca]\ndefault_ca=issuer\n[issuer]\ndatabase=${file('index.txt')}\nserial=${file('serial')}\nnew_certs_dir=${directory}\ncertificate=${file('old.pem')}\nprivate_key=${file('old.key')}\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n[server]\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
  run(['ca', '-batch', '-notext', '-config', file('expired.cnf'), '-startdate', '20200101000000Z', '-enddate', '20200102000000Z',
    '-in', file('server-first.csr'), '-out', file('server-expired.pem'), '-extensions', 'server']);
  const material = {};
  for (const name of ['first', 'renewed', 'replacement', 'wrong-host', 'wrong-purpose']) material[name] = {
    certificate: await readFile(file(`server-${name}.pem`), 'utf8'), privateKey: await readFile(file(`server-${name}.key`), 'utf8'),
    ca: await readFile(file(name === 'replacement' ? 'replacement.pem' : 'old.pem'), 'utf8'), hosts: ['localhost', '127.0.0.1', '10.0.2.2'],
  };
  material.expired = { ...material.first, certificate: await readFile(file('server-expired.pem'), 'utf8') };
  return material;
}
