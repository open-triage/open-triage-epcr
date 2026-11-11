import assert from 'node:assert/strict';
import test from 'node:test';
import { androidFetch, configureNativeConnection, pollAndroidAuthenticationReturn } from '../app/android-runtime';
test('shared API requests preserve CSRF/agency/body through the native connection and surface HTTP failures', async () => {
  let received: unknown;
  const transport = androidFetch(async () => { throw new Error('API escaped the native boundary'); }, async options => {
    received = options;
    return { status: 401, headers: { 'Content-Type': 'application/json' }, bodyBase64: btoa('{"message":"Expired"}') };
  }, 'https://localhost');
  const response = await transport('/api/sessions/current', { method: 'DELETE', headers: { 'x-csrf-token': 'csrf', 'x-organization-id': 'agency' } });
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { message: 'Expired' });
  assert.deepEqual(received, { path: '/api/sessions/current', method: 'DELETE', headers: { 'x-csrf-token': 'csrf', 'x-organization-id': 'agency' }, bodyBase64: '' });
});
test('bundled assets and external origins never receive native credentials', async () => {
  const observed: unknown[] = [];
  const transport = androidFetch(async input => { observed.push(input); return new Response('asset'); }, async () => { throw new Error('Unapproved native URL'); }, 'https://localhost');
  for (const path of ['/_next/static/app.js', 'https://other.example/api/sessions', 'https://localhost.evil.test/api/sessions']) assert.equal(await (await transport(path)).text(), 'asset');
  assert.equal(observed.length, 3);
});
test('native fetch honors aborted callers and empty no-content responses', async () => {
  let calls = 0;
  const transport = androidFetch(fetch, async () => { calls++; return { status: 204, headers: {}, bodyBase64: '' }; }, 'https://localhost');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transport('/api/test', { signal: abort.signal })); assert.equal(calls, 0);
  const response = await transport('/api/test'); assert.equal(response.status, 204); assert.equal(await response.text(), '');
});

test('native transport preserves Request inputs and explicit JSON bodies', async () => {
  let body: string | undefined;
  const transport = androidFetch(fetch, async request => { body = request.bodyBase64; return { status: 200, headers: {}, bodyBase64: btoa('{}') }; }, 'https://localhost');
  await transport(new Request('https://localhost/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":"synthetic"}' }));
  assert.equal(atob(body!), '{"username":"synthetic"}');
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) test(`native ${method} preserves arbitrary bytes and binary responses`, async () => {
  const bytes = Uint8Array.of(0, 255, 254, 128, 195, 40, 13, 10);
  const transport = androidFetch(fetch, async request => {
    assert.deepEqual(Uint8Array.from(atob(request.bodyBase64!), char => char.charCodeAt(0)), bytes);
    return { status: 200, headers: { 'content-type': 'image/jpeg' }, bodyBase64: btoa(String.fromCharCode(...bytes)) };
  }, 'https://localhost');
  const response = await transport('/api/reports/photo/image', { method, body: bytes });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
});
for (const status of [204, 205, 304]) test(`native ${status} has no response body`, async () => {
  const response = await androidFetch(fetch, async () => ({ status, headers: {}, bodyBase64: '' }), 'https://localhost')('/api/test');
  assert.equal(response.body, null);
});
test('native HEAD has no body even when the native response includes bytes', async () => {
  const response = await androidFetch(fetch, async () => ({ status: 200, headers: {}, bodyBase64: btoa('ignored') }), 'https://localhost')('/api/test', { method: 'HEAD' });
  assert.equal(response.body, null);
});

test('default-size media transfers through bridge bytes and declared oversize fails before native dispatch', async () => {
  const bytes = new Uint8Array(10 * 1024 * 1024); bytes.fill(255); bytes[1] = 216;
  let calls = 0;
  const transport = androidFetch(fetch, async request => {
    calls++;
    return { status: 200, headers: { 'content-type': 'image/jpeg' }, bodyBase64: request.bodyBase64! };
  }, 'https://localhost');
  assert.deepEqual(new Uint8Array(await (await transport('/api/media', { method: 'POST', body: bytes })).arrayBuffer()), bytes);
  await assert.rejects(transport('/api/media', { method: 'POST', headers: { 'content-length': String(16 * 1024 * 1024 + 1) }, body: 'small' }), /Oversized/);
  assert.equal(calls, 1);
});

test('a delayed native reply cannot revive the previous installation context', async () => {
  configureNativeConnection({configured:true,origin:'https://old.example',storageScope:'A'.repeat(43),connectionContext:'old'});
  let release!: (value:{status:number;headers:Record<string,string>;bodyBase64:string})=>void;
  const transport=androidFetch(fetch,async options=>{assert.equal(options.connectionContext,'old');return new Promise(resolve=>{release=resolve;});},'https://localhost');
  const pending=transport('/api/sessions/current');
  configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'new'});
  release({status:200,headers:{},bodyBase64:btoa('old context')});
  await assert.rejects(pending,/Installation changed/);
  configureNativeConnection({configured:false});
});

test('stale authentication success and failure cannot navigate a replacement or newly paired installation', async () => {
  for (const outcome of ['succeeded','pending','denied','failed'] as const) {
    configureNativeConnection({configured:true,origin:'https://old.example',storageScope:'A'.repeat(43),connectionContext:'old'});
    let release!: (result:{outcome:typeof outcome})=>void;
    const redirects:string[]=[];
    const pending=pollAndroidAuthenticationReturn(()=>new Promise(resolve=>{release=resolve;}),path=>{redirects.push(path);});
    configureNativeConnection({configured:false,replacementPending:true,connectionContext:'replacement'});
    release({outcome});await pending;assert.deepEqual(redirects,[]);
  }
  configureNativeConnection({configured:true,origin:'https://current.example',storageScope:'B'.repeat(43),connectionContext:'current'});
  const redirects:string[]=[];
  await pollAndroidAuthenticationReturn(async()=>({outcome:'succeeded'}),path=>{redirects.push(path);});
  assert.deepEqual(redirects,['/?authentication=completed']);
  configureNativeConnection({configured:false});
});

test('connection replacement during binary body preparation prevents native dispatch', async () => {
  configureNativeConnection({configured:true,origin:'https://old.example',storageScope:'A'.repeat(43),connectionContext:'old'});
  let release!: () => void;
  const body = new ReadableStream<Uint8Array>({start(controller) {release=()=>{controller.enqueue(Uint8Array.of(0,255));controller.close();};}});
  let calls=0;
  const transport=androidFetch(fetch,async()=>{calls++;return {status:204,headers:{},bodyBase64:''};},'https://localhost');
  const request=new Request('https://localhost/api/media',{method:'POST',body,duplex:'half'} as RequestInit);
  const pending=transport(request);
  configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'new'});
  release();
  await assert.rejects(pending,/Installation changed/);
  assert.equal(calls,0);

  configureNativeConnection({configured:false});
});
