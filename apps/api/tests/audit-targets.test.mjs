import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuditTargets } from '../dist/admin/audit-targets.js';

const id = '10000000-0000-4000-8000-000000000001';
test('audit metadata resolves PCR and dispatch record identifiers alongside administrative names', async () => {
  const targets = [['report', 'PCR-123'], ['reviewItem', 'PCR-123'], ['call', 'DISPATCH-456'], ['user', 'Audit actor']];
  const manager = { query: async sql => {
    assert.match(sql, /eRecord\.01/);
    assert.match(sql, /t\.call_number/);
    assert.match(sql, /app_identity.agency_user/);
    return targets.map(([kind, label]) => ({ id, kind, label, version: null }));
  } };
  const result = await resolveAuditTargets(manager, id,
    targets.map(([target_kind]) => ({ target_kind, target_id: id })));
  for (const [kind, label] of targets) assert.equal(result.get(`${kind}:${id}`).label, label);
});
