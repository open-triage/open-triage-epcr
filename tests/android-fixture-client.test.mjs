import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureApi } from '../scripts/android/fixture-client.mjs';

test('Android fixture requests retain validated TLS and fresh connections across synchronous instrumentation waits without retrying mutations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'android-fixture-client-'));
  let worker;
  try {
    const keyPath = join(directory, 'server.key'), certPath = join(directory, 'server.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=agency.example.test', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:agency.example.test', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
    const key = await readFile(keyPath, 'utf8'), cert = await readFile(certPath, 'utf8');
    // The API clock keeps running while the fixture caller blocks in an adb subprocess.
    worker = new Worker(`
      const {createServer}=require('node:https');const {workerData,parentPort}=require('node:worker_threads');
      let connections=0,calls=0;const ids=new WeakMap();
      const server=createServer(workerData,(request,response)=>{
        let body='';request.setEncoding('utf8');request.on('data',chunk=>body+=chunk);request.on('end',()=>{
          response.setHeader('content-type','application/json');
          response.end(JSON.stringify({connection:ids.get(request.socket),call:++calls,method:request.method,path:request.url,origin:request.headers.origin,host:request.headers.host,cookie:request.headers.cookie,requestBody:body}));
        });
      });
      server.on('secureConnection',socket=>ids.set(socket,++connections));
      server.keepAliveTimeout=25;server.keepAliveTimeoutBuffer=0;
      server.listen(0,'127.0.0.1',()=>parentPort.postMessage(server.address().port));
    `, { eval: true, workerData: { key, cert } });
    const [port] = await once(worker, 'message');
    const fixture = { port, origin: `https://agency.example.test:${port}` };
    const signedIn = await fixtureApi(fixture, cert, 'sessions', 'POST', { username: 'synthetic', password: 'synthetic-only' });
    assert.equal(signedIn.status, 200);
    // Deliberately block only this caller; a separate real HTTPS server expires idle connections.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    const inventory = await fixtureApi(fixture, cert, 'admin/units/synthetic/installations', 'GET', undefined, { Cookie: 'fixture=synthetic-only' });
    assert.equal(inventory.status, 200);
    const enrollment = await fixtureApi(fixture, cert, 'installations/enroll', 'POST', { token: 'synthetic-only' });
    assert.equal(new Set([signedIn.body.connection, inventory.body.connection, enrollment.body.connection]).size, 3);
    assert.deepEqual([signedIn.body.call, inventory.body.call, enrollment.body.call], [1, 2, 3]);
    assert.equal(inventory.body.cookie, 'fixture=synthetic-only');
    assert.equal(inventory.body.origin, fixture.origin);
    assert.equal(inventory.body.host, new URL(fixture.origin).host);
    assert.equal(enrollment.body.path, '/api/installations/enroll');
    const withdrawn = await fixtureApi(fixture, cert, 'admin/users/synthetic/sessions/synthetic', 'DELETE', { reason: 'synthetic only å' });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.method, 'DELETE');
    assert.deepEqual(JSON.parse(withdrawn.body.requestBody), { reason: 'synthetic only å' });
    const falseBody = await fixtureApi(fixture, cert, 'synthetic-false', 'DELETE', false);
    assert.equal(falseBody.status, 200);
    assert.equal(falseBody.body.requestBody, 'false');
    assert.deepEqual([withdrawn.body.call, falseBody.body.call], [4, 5], 'Mutations are sent exactly once');
    assert.equal(new Set([signedIn.body.connection, inventory.body.connection, enrollment.body.connection, withdrawn.body.connection, falseBody.body.connection]).size, 5);
    await assert.rejects(fixtureApi(fixture, undefined, 'sessions', 'POST', {}), /self-signed certificate/);
  } finally { await worker?.terminate(); await rm(directory, { recursive: true, force: true }); }
});
