import { expectedApiUrl } from "./helpers/api-url";
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchReportPhoto } from '../app/report-photo-api';

test('photo locations cannot forward clinical credentials to arbitrary origins or non-API paths', async () => {
  for (const location of ['https://attacker.test/api/photo', '//attacker.test/api/photo', '/outside', '/api/../outside', '/api/%2e%2e/outside', '/api/photo#secret', '/api/\\attacker']) {
    await assert.rejects(fetchReportPhoto('report', 'note', location), /Unapproved photo location/);
  }
});
test('authorized photos reject redirects and retain exact canonical image bytes', async () => {
  const original = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(input, expectedApiUrl('/api/reports/report/photos/note/image'));
    assert.equal(init?.redirect, 'error');
    return new Response(Uint8Array.of(255, 216, 0, 254, 128, 255, 217), { headers: { 'content-type': 'image/jpeg' } });
  };
  try { assert.deepEqual(new Uint8Array(await (await fetchReportPhoto('report', 'note')).arrayBuffer()), Uint8Array.of(255, 216, 0, 254, 128, 255, 217)); }
  finally { global.fetch = original; }
});
