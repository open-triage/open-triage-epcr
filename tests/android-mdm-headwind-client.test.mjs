import assert from 'node:assert/strict';
import test from 'node:test';
import {HeadwindLabClient} from '../scripts/android/mdm-headwind-client.mjs';

test('console session stays on the selected origin and supported routes, including exact device overrides', async () => {
  const calls = [], client = new HeadwindLabClient('http://127.0.0.1:18080', 'JSESSIONID=synthetic', async (url, options) => {
    calls.push({url, options}); return Response.json({status: 'OK', data: []});
  });
  await client.configurations(); await client.configuration(4); await client.applications(); await client.devices(4);
  await client.saveConfiguration({id: 4, applications: [], applicationSettings: []}, 4);
  await client.deviceSettings(9); await client.saveDeviceSettings(9, []); await client.notifyDeviceSettings(9);
  assert.equal(calls.length, 8);
  assert(calls.every(({url, options}) => url.startsWith('http://127.0.0.1:18080/rest/private/') && options.redirect === 'manual' && options.credentials === 'omit' && options.headers.Cookie === 'JSESSIONID=synthetic'));
  assert.equal(JSON.parse(calls[3].options.body).sortBy, null, 'Actual server expects an optional enum sort, not SQL column names');
  assert.equal(calls[4].options.method, 'PUT'); assert.equal(calls[6].options.body, '[]'); assert.equal(calls[7].options.body, '{}');
  for (const id of ['../1', '4', 0, -1, NaN]) assert.throws(() => client.configuration(id));
  assert.throws(() => client.saveConfiguration({id: 9, applications: [], applicationSettings: []}, 4));
  assert.throws(() => client.saveDeviceSettings(9, {}));
});

test('console adapter refuses redirects, remote cleartext and rejected sessions without logging private bodies', async () => {
  for (const origin of ['http://remote.invalid', 'https://host.invalid/path', 'https://user:secret@host.invalid']) assert.throws(() => new HeadwindLabClient(origin, 'session'));
  for (const response of [new Response('private-response', {status: 302, headers: {location: 'https://other.invalid'}}), new Response('private-response'), Response.json({status: 'ERROR', data: 'private-response'})]) {
    const client = new HeadwindLabClient('http://127.0.0.1:18080', 'session', async () => response);
    await assert.rejects(client.configurations(), error => !String(error).includes('private-response'));
  }
});
