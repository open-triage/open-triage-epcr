import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSyntheticPdfServer } from '../scripts/lib/cos-sandbox-pdf-server.mjs';

test('synthetic PDF capability serves only immutable bytes by GET/HEAD and expires without exposing other paths', async t => {
  let now = 1000;
  const logs = [], bytes = Buffer.from('%PDF-1.4\nfictional test'), path = '/pdf/' + 'a'.repeat(64) + '/report.pdf';
  const server = createSyntheticPdfServer({ bytes, path, expiresAt: 2000, now: () => now, onRequest: x => logs.push(x) });
  bytes.fill(0); // Caller changes cannot change the published artifact.
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = await fetch(base + path);
  assert.equal(get.status, 200); assert.equal(get.headers.get('content-type'), 'application/pdf');
  assert.equal(get.headers.get('cache-control'), 'no-store'); assert.equal(await get.text(), '%PDF-1.4\nfictional test');
  const head = await fetch(base + path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/.env.local')).status, 404);
  assert.equal((await fetch(base + path + '?other=value')).status, 404);
  assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
  now = 2000; assert.equal((await fetch(base + path)).status, 410);
  assert.ok(logs.every(x => !JSON.stringify(x).includes(path)));
});
