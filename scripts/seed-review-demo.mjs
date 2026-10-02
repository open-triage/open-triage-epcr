/** Local fictional Review scenarios. Run with `node --import tsx scripts/seed-review-demo.mjs`.
 * Uses a fixture-only published rule bundle; the installation's active configuration is preserved.
 */
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { compileValidationRule, compiledValidationBundleSha256, SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { AssignedCallsService } from '../apps/api/dist/calls/assigned-calls.service.js';
import { processReviewWork } from '../apps/api/dist/review/review-worker.js';
import { rolloutUuid } from '../packages/database/scripts/seed-initial-validation-versions.mjs';
import { populateStationaryDemoData } from '../apps/web/app/stationary-demo-data.ts';
import { encounterDocumentToDraftMutations, demoActionMutationDelta } from '../apps/web/app/draft-report.ts';

const base = process.env.REVIEW_DEMO_API_URL ?? 'http://localhost:3001';
const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
if (!process.env.DATABASE_URL || !local(process.env.DATABASE_URL) || !local(base))
  throw new Error('Review demo seeding requires a loopback DATABASE_URL and API URL');
let cookie = '', csrf = '';
async function api(path, body) {
  const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', cookie, 'x-csrf-token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (path === '/sessions') cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
const login = await api('/sessions', { username: 'demo', password: 'opentriagedemo' });
const session = login.session ?? login;
csrf = session.csrfToken;
if (session.organization.id !== SYNTHETIC_DEMO_FIXTURE.organizationId ||
    !['clinical:demo', 'review:admin'].every((capability) => session.capabilities.includes(capability)))
  throw new Error('The configured demo account needs clinical:demo and review:admin');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const query = async (sql, params) => (await client.query(sql, params)).rows;
const manager = { query };
const database = { query, transaction: async (level, callback) => {
  await client.query(typeof level === 'string' ? `begin isolation level ${level}` : 'begin');
  try { const result = await (callback ?? level)(manager); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); throw error; }
} };
const scenarios = [
  { key: 'low-oxygen', name: 'Low oxygen saturation', oxygen: 86, state: 'new' },
  { key: 'low-pressure', name: 'Low systolic pressure', pressure: 82, state: 'in-review' },
  { key: 'severe-pain', name: 'Pain follow-up', pain: 9, state: 'awaiting-clinician' },
  { key: 'multiple-findings', name: 'Multiple findings', oxygen: 88, pressure: 84, pain: 8, state: 'new' },
  { key: 'completed', name: 'Completed pain review', pain: 8, state: 'completed' },
  { key: 'normal', name: 'Normal observations — no review match', state: 'clear' },
  { key: 'unsigned', name: 'Unsigned draft', oxygen: 89, state: 'draft' },
];
try {
  await query('select pg_advisory_lock(hashtext($1))', ['review-demo-fixtures-v1']);
  await api('/calls/assigned'); // Includes normal expiry cleanup.
  const active = (await query('select * from app_identity.active_configuration_bundle where organization_id=$1', [session.organization.id]))[0];
  if (!active) throw new Error('Complete normal installation setup first');
  const versionId = rolloutUuid('review-demo-v1', session.organization.id, active.catalog_release_id);
  const definitions = [
    ['oxygen', 'Low oxygen saturation', 'eVitals.12', 'greater-or-equal', 92, 'high', 'Oxygen saturation below 92%. Review assessment and treatment.'],
    ['pressure', 'Low systolic pressure', 'eVitals.06', 'greater-or-equal', 90, 'medium', 'Systolic blood pressure below 90 mmHg. Review assessment and follow-up.'],
    ['pain', 'Pain follow-up', 'eVitals.27', 'less-than', 8, 'low', 'Pain score 8 or above. Review pain management and reassessment.'],
  ];
  const catalog = { elements: (await query('select element_id,name,base_datatype,group_path from catalog.element_definition where release_id=$1', [active.catalog_release_id]))
    .map((row) => ({ elementId: row.element_id, label: row.name, baseDatatype: row.base_datatype, groupPath: row.group_path })) };
  const rules = definitions.map(([key, name, element, comparison, value, priority, message]) => ({
    id: rolloutUuid('review-demo-rule-v1', session.organization.id, key), name, message,
    enabled: true, severity: 'warning', reviewPriority: priority, executionTargets: ['review'],
    primaryTargetElementId: element, source: `require compareValue("${element}", "${comparison}", ${value})`, sourceKind: 'agency',
  }));
  const compiled = rules.map((rule) => {
    const result = compileValidationRule(rule, versionId, catalog);
    if (!result.compiled) throw new Error(JSON.stringify(result.diagnostics));
    return result.compiled;
  });
  const bundle = { schemaVersion: 1, languageVersion: '1.0.0', validationVersionId: versionId,
    catalogReleaseId: active.catalog_release_id, rules: compiled };
  const hash = compiledValidationBundleSha256(bundle);
  await database.transaction(async () => {
    const existingVersion = (await query('select compiled_sha256 from validation.version where id=$1', [versionId]))[0];
    if (existingVersion && existingVersion.compiled_sha256 !== hash) throw new Error('Review demo version differs; use a new fixture version');
    if (!existingVersion) {
    await query('select pg_advisory_xact_lock(hashtext($1))', [`configuration:${session.organization.id}`]);
    for (const rule of rules) await query(`insert into validation.rule_identity(id,organization_id,created_by)
      values ($1,$2,$3) on conflict do nothing`, [rule.id, session.organization.id, session.user.id]);
    await query(`insert into validation.version
      (id,organization_id,catalog_release_id,rule_id,version,status,revision,display_name,source_rule,
       compiled_bundle,compiled_sha256,source_sha256,change_note,created_by,published_by,published_at)
      select $1,$2,$3,$4,coalesce(max(version),0)+1,'published',1,'Fictional Review demo scenarios',
        $5::jsonb,$6::jsonb,$7,$8,'Local demo fixtures only; not activated',$9,$9,now()
      from validation.version where organization_id=$2`, [versionId, session.organization.id, active.catalog_release_id,
      rules[0].id, JSON.stringify(rules), JSON.stringify(bundle), hash,
      createHash('sha256').update(JSON.stringify(rules)).digest('hex'), session.user.id]);
    }
    await query(`insert into validation.change_event
      (organization_id,actor_id,action,destination_version_id,catalog_release_id,change_note,rule_changes,source_sha256,compiled_sha256)
      select $1,$2,'validation.publish',$3,$4,'Local fictional Review fixtures; not activated',$5::jsonb,$6,$7
      where not exists(select 1 from validation.change_event where destination_version_id=$3 and action='validation.publish')`,
      [session.organization.id,session.user.id,versionId,active.catalog_release_id,
        JSON.stringify({ additions: rules.map(({ id, name }) => ({ ruleId: id, name })), modifications: [], disablements: [], executionTargetChanges: [] }),
        createHash('sha256').update(JSON.stringify(rules)).digest('hex'),hash]);
  });
  // Exercise the normal assignment-opening service with explicit fixture pins.
  // Only this in-process configuration read is overridden; no active installation setting changes.
  const fixtureManager = { query: async (sql, params) => {
    const rows = await query(sql, params);
    return sql.includes('from app_identity.active_configuration_bundle active')
      ? rows.map((row) => ({ ...row, validation_version_id: versionId, validation_compiled_sha256: hash })) : rows;
  } };
  const fixtureDatabase = { ...database, transaction: (level, callback) =>
    database.transaction(level instanceof Function ? () => level(fixtureManager) : level,
      callback ? () => callback(fixtureManager) : undefined) };
  const opener = new AssignedCallsService(fixtureDatabase, { requireCapability: async (_, capability) => {
    if (!session.capabilities.includes(capability)) throw new Error(`Missing ${capability}`);
    return session;
  } });
  const context = await api('/calls/synthetic-generation');
  if (!context.eligibleUnits.length) throw new Error('Demo account has no eligible unit');
  const created = [];
  for (const scenario of scenarios) {
    const marker = `Fictional Review demo v1: ${scenario.key}`;
    const existing = (await query(`select ca.id,ca.report_id,r.status from clinical.call_assignment ca
      left join clinical.report r on r.id=ca.report_id where ca.organization_id=$1 and ca.synthetic_generated_by=$2
        and ca.dispatch_reason=$3 and ca.expires_at>now() order by ca.created_at desc limit 1`,
    [session.organization.id, session.user.id, marker]))[0];
    if (existing?.status === 'signed' || existing?.report_id && scenario.state === 'draft') {
      console.log(JSON.stringify({ scenario: scenario.name, reportId: existing.report_id, reused: true })); created.push({ ...scenario, reportId: existing.report_id, reused: true }); continue;
    }
    let assignmentId = existing?.id;
    if (!assignmentId) {
      const generated = await api('/calls/synthetic-generation', { unitId: context.eligibleUnits[0].id });
      assignmentId = generated.assignment.id;
      await query('update clinical.call_assignment set dispatch_reason=$2,chief_complaint=$3 where id=$1',
        [assignmentId, marker, `Fictional demo: ${scenario.name}`]);
    }
    const { report } = await opener.open('fixture', assignmentId);
    const document = populateStationaryDemoData(report.document, report.clinicalForm.catalogFields);
    const values = { 'eVitals.12': scenario.oxygen ?? 98, 'eVitals.06': scenario.pressure ?? 120,
      'eVitals.27': scenario.pain ?? 1, 'eNarrative.01': `Fictional Review demo: ${scenario.name}. For interface testing only.` };
    for (const group of document.groups) for (const instance of group.instances) for (const element of instance.elements)
      if (Object.hasOwn(values, element.id)) for (const value of element.values)
        if (value.kind === 'scalar') value.value = typeof value.value === 'number' ? Number(values[element.id]) : String(values[element.id]);
    const before = encounterDocumentToDraftMutations(report.id, report.document);
    const changes = demoActionMutationDelta('populate', encounterDocumentToDraftMutations(report.id, document), before);
    const saved = await api(`/reports/${report.id}/draft-changes`, { commandId: randomUUID(), expectedRevision: report.revision,
      authorId: session.user.id, demoAction: 'populate', ...changes });
    if (scenario.state !== 'draft') await api(`/reports/${report.id}/sign`, { commandId: randomUUID(),
      expectedRevision: saved.revision, signerId: session.user.id, attestation: { meaning: 'Fictional demonstration report' } });
    created.push({ ...scenario, reportId: report.id });
    console.log(JSON.stringify({ scenario: scenario.name, reportId: report.id, state: scenario.state }));
  }
  await processReviewWork(database, 100);
  for (const scenario of created.filter((item) => ['in-review', 'awaiting-clinician', 'completed'].includes(item.state))) {
    const items = await query('select id from clinical.review_item where report_id=$1', [scenario.reportId]);
    for (const { id } of items) {
      let item = await api(`/review/items/${id}?dataset=synthetic`);
      if (scenario.state === 'awaiting-clinician' && item.status === 'awaiting-clinician' &&
          !(await query('select id from clinical.review_comment where item_id=$1', [id])).length)
        await api(`/review/items/${id}/comments`, { commandId: randomUUID(), expectedVersion: item.version,
          dataset: 'synthetic', body: 'Fictional demo: please document the pain reassessment and response to treatment.' });
      if (item.status !== 'new' || item.assigneeId && item.assigneeId !== session.user.id) continue;
      if (!item.assigneeId) item = await api(`/review/items/${id}/claim`, { commandId: randomUUID(), expectedVersion: item.version, dataset: 'synthetic' });
      if (scenario.state !== 'in-review') item = await api(`/review/items/${id}/progress`, {
        commandId: randomUUID(), expectedVersion: item.version, dataset: 'synthetic', status: 'in-review' });
      let outcomeOptionId;
      if (scenario.state === 'completed') {
        const outcomes = await api('/review/outcomes');
        const outcome = outcomes.find((entry) => entry.active) ?? await api('/review/outcomes', {
          commandId: randomUUID(), label: 'Reviewed — no action required', meaning: 'Demo review completed', active: true });
        outcomeOptionId = outcome.id;
      }
      item = await api(`/review/items/${id}/progress`, { commandId: randomUUID(), expectedVersion: item.version,
        dataset: 'synthetic', status: scenario.state, ...(outcomeOptionId ? { outcomeOptionId } : {}) });
      if (scenario.state === 'awaiting-clinician') await api(`/review/items/${id}/comments`, {
        commandId: randomUUID(), expectedVersion: item.version, dataset: 'synthetic', body: 'Fictional demo: please document the pain reassessment and response to treatment.' });
    }
  }
  console.log(JSON.stringify({ scenarios: scenarios.length, created: created.filter((item) => !item.reused).length,
    queue: (await api('/review/queue?dataset=synthetic')).total }));
} finally {
  await client.end();
}
