import assert from 'node:assert/strict';
import test from 'node:test';
import { androidFetch, configureNativeConnection } from '../app/android-runtime';
import { ANDROID_TLS_STATUS_EVENT } from '../app/android-connection-failure';
test('shared API requests preserve CSRF/agency/body through the native connection and surface HTTP failures', async () => {
  let received: unknown;
  const transport = androidFetch(async () => { throw new Error('API escaped the native boundary'); }, async options => {
    received = options;
    return { status: 401, headers: { 'Content-Type': 'application/json' }, body: '{"message":"Expired"}' };
  }, 'https://localhost');
  const response = await transport('/api/sessions/current', { method: 'DELETE', headers: { 'x-csrf-token': 'csrf', 'x-organization-id': 'agency' } });
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { message: 'Expired' });
  assert.deepEqual(received, { path: '/api/sessions/current', method: 'DELETE', headers: { 'x-csrf-token': 'csrf', 'x-organization-id': 'agency' }, body: '' });
});
test('bundled assets and external origins never receive native credentials', async () => {
  const observed: unknown[] = [];
  const transport = androidFetch(async input => { observed.push(input); return new Response('asset'); }, async () => { throw new Error('Unapproved native URL'); }, 'https://localhost');
  for (const path of ['/_next/static/app.js', 'https://other.example/api/sessions', 'https://localhost.evil.test/api/sessions']) assert.equal(await (await transport(path)).text(), 'asset');
  assert.equal(observed.length, 3);
});
test('native fetch honors aborted callers and empty no-content responses', async () => {
  let calls = 0;
  const transport = androidFetch(fetch, async () => { calls++; return { status: 204, headers: {}, body: '' }; }, 'https://localhost');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transport('/api/test', { signal: abort.signal })); assert.equal(calls, 0);
  const response = await transport('/api/test'); assert.equal(response.status, 204); assert.equal(await response.text(), '');
});

test('native transport preserves Request inputs and explicit JSON bodies', async () => {
  let body: string | undefined;
  const transport = androidFetch(fetch, async request => { body = request.body; return { status: 200, headers: {}, body: '{}' }; }, 'https://localhost');
  await transport(new Request('https://localhost/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":"synthetic"}' }));
  assert.equal(body, '{"username":"synthetic"}');
});

test('a delayed native reply cannot revive the previous installation context', async () => {
  configureNativeConnection({configured:true,origin:'https://old.example',storageScope:'A'.repeat(43),connectionContext:'old'});
  let release!: (value:{status:number;headers:Record<string,string>;body:string})=>void;
  const transport=androidFetch(fetch,async options=>{assert.equal(options.connectionContext,'old');return new Promise(resolve=>{release=resolve;});},'https://localhost');
  const pending=transport('/api/sessions/current');
  configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'new'});
  release({status:200,headers:{},body:'old context'});
  await assert.rejects(pending,/Installation changed/);
  configureNativeConnection({configured:false});
});

test('TLS notices preserve typed failures and ignore aborted or stale native callbacks', async () => {
  const previous=globalThis.window, events=new EventTarget(), statuses:boolean[]=[];
  events.addEventListener(ANDROID_TLS_STATUS_EVENT,event=>statuses.push((event as CustomEvent<{failed:boolean}>).detail.failed));
  Object.defineProperty(globalThis,'window',{value:events,configurable:true,writable:true});
  try {
    const failure=Object.assign(new Error('Public failure category'),{code:'TLS_FAILED'});
    let reject!: (error:unknown)=>void;
    const transport=androidFetch(fetch,async()=>new Promise((_resolve,no)=>{reject=no;}),'https://localhost');
    const pending=transport('/api/health');reject(failure);await assert.rejects(pending,error=>error===failure);assert.deepEqual(statuses,[true]);
    const recovered=androidFetch(fetch,async()=>({status:200,headers:{},body:'{}'}),'https://localhost');await recovered('/api/health');assert.deepEqual(statuses,[true,false]);
    const abort=new AbortController(),cancelled=transport('/api/health',{signal:abort.signal});abort.abort();reject(failure);await assert.rejects(cancelled);assert.deepEqual(statuses,[true,false]);
    configureNativeConnection({configured:true,connectionContext:'old'});
    const stale=transport('/api/health');configureNativeConnection({configured:true,connectionContext:'new'});reject(failure);await assert.rejects(stale,/Installation changed/);assert.deepEqual(statuses,[true,false]);
  } finally {
    configureNativeConnection({configured:false});
    if(previous===undefined)Reflect.deleteProperty(globalThis,'window');else Object.defineProperty(globalThis,'window',{value:previous,configurable:true,writable:true});
  }
});
