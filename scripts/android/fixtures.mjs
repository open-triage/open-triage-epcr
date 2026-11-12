import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { DataSource } from 'typeorm';

/** Disposable synthetic identities only; no installation-owned accounts or databases are touched. */
export async function prepareFixtures(root, directory, run, docker, container) {
  run(docker, ['run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD=postgres', 'postgres:15']);
  const port = execFileSync(docker, ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1);
  const adminUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await client.connect(); ready = true; } catch { /* PostgreSQL startup. */ } finally { await client.end(); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Synthetic PostgreSQL did not start.');
  const caPath = join(directory, 'ca.pem'), keyPath = join(directory, 'server.key'), certPath = join(directory, 'server.pem');
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'ca.key'), '-out', caPath, '-days', '2', '-subj', '/CN=OpenTriage synthetic Android CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', join(directory, 'server.csr'), '-subj', '/CN=OpenTriage synthetic Android API']);
  const hostIps=Object.values(networkInterfaces()).flat().filter(value=>value?.family==='IPv4'&&!value.internal).map(value=>`IP:${value.address}`);
  await writeFile(join(directory, 'server.ext'), `subjectAltName=IP:10.0.2.2,IP:127.0.0.1,DNS:localhost,${hostIps.join(',')}\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n`);
  run('openssl', ['x509', '-req', '-in', join(directory, 'server.csr'), '-CA', caPath, '-CAkey', join(directory, 'ca.key'), '-CAcreateserial', '-out', certPath, '-days', '2', '-extfile', join(directory, 'server.ext')]);
  const { AccountService } = await import('../../apps/api/dist/identity/account.service.js');
  const administratorPassword = 'AndroidFixtureAdmin123!', clinicianPassword = 'AndroidFixtureClinician123!';
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  const fixtures = [];
  try {
    for (const index of [1, 2]) {
      const database = `android_${index}`; // Fixed identifiers inside this new disposable container.
      await admin.query(`create database ${database}`);
      const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`;
      run('npm', ['run', 'migrate:runtime', '-w', '@open-triage/database'], { ...process.env, DATABASE_URL: databaseUrl });
      const db = new DataSource({ type: 'postgres', url: databaseUrl }); await db.initialize();
      try {
        const organizationId = randomUUID(), unitId = randomUUID();
        await db.query('insert into app_identity.organization(id,name,deployment_timezone,hostname) values($1,$2,$3,$4)', [organizationId, `Android synthetic ${index}`, 'UTC', '10.0.2.2']);
        const accounts = new AccountService(db);
        await accounts.bootstrapOwner({ username: 'fixture.owner', displayName: 'Synthetic owner', temporaryPassword: 'AndroidFixtureOwner123!', operator: { operatorId: 'android-test', osAccount: 'synthetic', host: 'disposable' } });
        const administrator = await accounts.provision({ organizationId, username: 'android.admin', displayName: 'Synthetic Android admin', role: 'administrator', temporaryPassword: administratorPassword });
        const clinician = await accounts.provision({ organizationId, username: 'android.clinician', displayName: 'Synthetic Android clinician', role: 'clinician', temporaryPassword: clinicianPassword });
        // These test-only users represent ordinary existing accounts, not a temporary-password acceptance flow.
        await db.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null,password_changed_at=clock_timestamp() where user_id=any($1::uuid[])', [[administrator.userId, clinician.userId]]);
        await db.query('update app_identity.app_user set synthetic=true where id=any($1::uuid[])', [[administrator.userId, clinician.userId]]);
        await db.query('insert into app_identity.operational_unit(id,organization_id,call_sign,name,active,synthetic) values($1,$2,$3,$4,true,true)', [unitId, organizationId, `ANDROID-${index}`, `Synthetic Android unit ${index}`]);
        await db.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)', [organizationId, unitId, clinician.userId]);
        fixtures.push({ index, databaseUrl, organizationId, unitId, administrator, clinician, administratorPassword, clinicianPassword, origin: `https://10.0.2.2:${9442 + index}`, port: 9442 + index, keyPath, certPath, caPath });
      } finally { await db.destroy(); }
    }
  } finally { await admin.end(); }
  return fixtures;
}
