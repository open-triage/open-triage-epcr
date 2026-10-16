import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthenticationPolicyService, validateLocalPolicy } from '../dist/authentication/authentication-policy.service.js';
const command = { expectedRevision: 1, maximumSessionHours: 8, temporaryPasswordHours: 24, accountAttemptsPer15Minutes: 10, networkAttemptsPer5Minutes: 40 };
const row = { group_id: 'root', revision: 1, maximum_session_hours: 12, temporary_password_hours: 72, account_attempt_limit: 20, network_attempt_limit: 60 };
function setup({ denied = false, recent = true } = {}) {
  const events = [];
  const manager = { query: async (sql, parameters) => { events.push({ sql, parameters }); return sql.includes('select * from app_identity.group_authentication_policy') ? [row] : []; } };
  const database = { manager, query: manager.query, transaction: async work => work(manager) };
  const sessions = { requireCapability: async () => { if (denied) throw new Error('denied'); return { user: { id: 'actor' }, organization: { id: 'child', groupId: 'root' } }; }, requireRecentReauthentication: async () => { if (!recent) throw new Error('recent authentication required'); } };
  return { events, service: new AuthenticationPolicyService(database, sessions) };
}
test('policy validation rejects forged scope, fractions, omissions and bounds', () => {
  assert.deepEqual(validateLocalPolicy(command), command);
  for (const mutation of [{ toString: "forged" }, { groupId: 'foreign' }, { maximumSessionHours: 0 }, { temporaryPasswordHours: 169 }, { accountAttemptsPer15Minutes: 2.1 }, { networkAttemptsPer5Minutes: '20' }, { expectedRevision: undefined }]) assert.throws(() => validateLocalPolicy({ ...command, ...mutation }));
});
test('child reads the root policy and changes target the root with attributable values', async () => {
  const { service, events } = setup();
  const policy = await service.get('token'); assert.equal(policy.inherited, true); assert.equal(policy.groupId, 'root'); assert.equal(policy.minimumPasswordLength, 12);
  await service.update('token', command);
  const update = events.find(event => event.sql.startsWith('update app_identity.group_authentication_policy'));
  assert.deepEqual(update.parameters, ['root', 8, 24, 10, 40]);
  const audit = events.find(event => event.sql.includes('insert into app_identity.authentication_event'));
  assert.deepEqual(audit.parameters.slice(0,2), ['root','actor']); assert.doesNotMatch(audit.parameters[2], /"password"|credential|token/i);
});
test('missing capability and stale revisions block policy writes', async () => {
  for (const options of [{ denied: true }, {}]) {
    const { service, events } = setup(options);
    await assert.rejects(service.update('token', options.denied ? command : { ...command, expectedRevision: 2 }));
    assert.equal(events.some(event => event.sql.startsWith('update ')), false);
  }
});

test('policy writes use existing login authority without fresh confirmation',async()=>{await setup({recent:false}).service.update('token',command);});
