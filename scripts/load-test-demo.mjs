#!/usr/bin/env node
// Bounded HTTP exercise for a fictional-data installation. No credentials or
// clinical response bodies are written to logs or the result artifact.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import fixture from '../packages/contracts/src/synthetic-demo-fixture.json' with { type: 'json' };

const { values } = parseArgs({ options: {
  'base-url': { type: 'string' }, users: { type: 'string', default: '50' },
  sessions: { type: 'string' }, seconds: { type: 'string', default: '120' },
  'interval-ms': { type: 'string', default: '5000' }, output: { type: 'string' },
  write: { type: 'boolean', default: false },
} });
if (!values['base-url']) throw new Error('--base-url is required; use only a fictional-data installation');
const base = new URL(values['base-url']);
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid API URL');
const users = Number(values.users), sessions = Number(values.sessions ?? values.users);
const seconds = Number(values.seconds), interval = Number(values['interval-ms']);
if (![users, sessions, seconds, interval].every(Number.isSafeInteger) || users < 1 || users > 100 ||
    sessions < 1 || sessions > users || seconds < 1 || seconds > 1800 || interval < 1000) throw new Error('Invalid load bounds');
const measurements = new Map();
const actors = [], reports = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let failure = null, phase = 'setup';

async function request(operation, path, actor, init = {}) {
  const key = `${phase}.${operation}`;
  const stats = measurements.get(key) ?? { durations: [], statuses: {}, bytes: 0 };
  measurements.set(key, stats);
  const start = performance.now();
  let status = 'network-error';
  try {
    const response = await fetch(new URL(path, base), {
      ...init, signal: AbortSignal.timeout(30_000), headers: {
        ...(actor ? { cookie: actor.cookie, 'x-csrf-token': actor.session.csrfToken } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers,
      },
    });
    status = String(response.status);
    const text = await response.text();
    stats.bytes += Buffer.byteLength(text);
    if (!response.ok && response.status !== 304) throw new Error(`${key}: HTTP ${response.status}`);
    let body = null;
    try { body = text ? JSON.parse(text) : null; }
    catch { throw new Error(`${key}: invalid JSON response`); }
    return { body, headers: response.headers };
  } catch (error) {
    if (status === 'network-error') throw new Error(`${key}: network error or timeout`);
    throw error;
  } finally {
    stats.durations.push(performance.now() - start);
    stats.statuses[status] = (stats.statuses[status] ?? 0) + 1;
  }
}

try {
  console.log(JSON.stringify({ event: 'start', origin: base.origin, users, sessions, seconds, write: values.write }));
  const logins = await Promise.allSettled(Array.from({ length: sessions }, async () => {
    const response = await request('login', '/api/sessions', null, { method: 'POST', body: JSON.stringify({
      username: process.env.LOAD_TEST_USERNAME ?? fixture.username,
      password: process.env.LOAD_TEST_PASSWORD ?? fixture.password,
    }) });
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('open_triage_session='))?.split(';')[0];
    if (!cookie || !response.body?.csrfToken) throw new Error('Login did not provide a session');
    const actor = { cookie, session: response.body };
    actors.push(actor);
    return actor;
  }));
  if (logins.some(result => result.status === 'rejected')) throw new Error(`${logins.filter(result => result.status === 'rejected').length} login(s) failed`);
  if (values.write) {
    const { body: context } = await request('generationContext', '/api/calls/synthetic-generation', actors[0]);
    if (!context.eligibleUnits?.length) throw new Error('No eligible demo unit');
    if (context.hasUnopenedCall) throw new Error('An existing unopened demo call must be handled before a write exercise');
    const unitId = context.eligibleUnits[0].id;
    // Generate and open in sequence, matching the agreed demo instructions.
    // The test never opens or edits a reused/pre-existing assignment.
    for (let index = 0; index < users; index++) {
      const actor = actors[index % actors.length];
      const { body: generated } = await request('generate', '/api/calls/synthetic-generation', actor,
        { method: 'POST', body: JSON.stringify({ unitId }) });
      if (generated.reused) throw new Error('Generator returned a pre-existing call; stopped before opening it');
      const { body: opened } = await request('open', `/api/calls/${generated.assignment.id}/open`, actor, { method: 'POST' });
      const report = { id: opened.report.id, revision: opened.report.revision, actor, etag: null };
      reports.push(report);
      for (const group of opened.report.document.groups) for (const instance of group.instances) {
        const element = instance.elements.find(element => element.id === 'eResponse.03');
        if (element?.values[0]?.kind === 'scalar') report.occurrence = {
          id: element.values[0].occurrenceId, elementId: element.id, groupInstanceId: instance.instanceId, ordinal: 0,
        };
      }
      if (!report.occurrence) throw new Error('Generated report has no editable incident number');
    }
  }
  phase = 'load';
  console.log(JSON.stringify({ event: 'load', users, seconds, reports: reports.length }));
  const deadline = Date.now() + seconds * 1000;
  const workers = await Promise.allSettled(Array.from({ length: users }, async (_, index) => {
    const actor = actors[index % actors.length], report = reports[index];
    let round = 0;
    // Begin together to exercise the instructed group-action burst.
    while (Date.now() < deadline) {
      const start = Date.now();
      if (round % 6 === 0) {
        await request('assignedCalls', '/api/calls/assigned', actor);
        await request('openCalls', '/api/reports/open', actor);
      }
      if (report) {
        const saved = await request('save', `/api/reports/${report.id}/draft-changes`, actor, { method: 'POST', body: JSON.stringify({
          commandId: randomUUID(), expectedRevision: report.revision, authorId: actor.session.user.id,
          occurrences: [{ ...report.occurrence, value: { kind: 'text', value: `LOAD-${index}-${round}` } }],
        }) });
        if (saved.body.status !== 'draft' || saved.body.revision <= report.revision) throw new Error('Save did not advance the draft');
        report.revision = saved.body.revision;
        if (round % 2 === 0) {
          const active = await request('activeReport', `/api/reports/${report.id}/active`, actor,
            { headers: report.etag ? { 'if-none-match': report.etag } : {} });
          report.etag = active.headers.get('etag');
          if (active.body && active.body.reportRevision !== report.revision) throw new Error('Saved revision was not visible');
        }
      } else await request('currentSession', '/api/sessions/current', actor);
      round++;
      await pause(Math.max(0, Math.min(deadline - Date.now(), interval - (Date.now() - start))));
    }
  }));
  const failed = workers.filter(result => result.status === 'rejected');
  if (failed.length) throw new Error(`${failed.length} worker(s) failed: ${failed[0].reason.message}`);
} catch (error) {
  failure = error.message;
} finally {
  phase = 'cleanup';
  for (const report of reports) {
    try { await request('deleteOwnDraft', `/api/reports/${report.id}`, report.actor, { method: 'DELETE' }); }
    catch { failure ??= 'Some generated drafts could not be cleaned up'; }
  }
  for (const actor of actors) {
    try { await request('logout', '/api/sessions/current', actor, { method: 'DELETE' }); }
    catch { failure ??= 'Some test sessions could not be signed out'; }
  }
  const result = { timestamp: new Date().toISOString(), origin: base.origin, users, sessions,
    seconds, write: values.write, generatedReports: reports.length, failure,
    operations: Object.fromEntries([...measurements].map(([key, stats]) => {
      const sorted = stats.durations.sort((a, b) => a - b);
      const percentile = p => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]);
      return [key, { requests: sorted.length, statuses: stats.statuses, p50Ms: percentile(.5), p95Ms: percentile(.95),
        maxMs: percentile(1), responseBytes: stats.bytes }];
    })) };
  if (values.output) await writeFile(values.output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (failure) process.exitCode = 1;
}
