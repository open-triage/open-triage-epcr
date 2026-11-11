import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import { seedReportFixture } from './report-fixture.mjs';

/** Real radio loss and host process termination; no mocked requests or key/crypto substitutions. */
export async function runReportRecoveryJourney({ root, fixture, adb, serial, run, api }) {
  const report = await seedReportFixture(root, fixture, run), ca = await readFile(fixture.caPath);
  const administrator = await api(fixture, ca, 'sessions', 'POST', { username: fixture.administrator.username, password: fixture.administratorPassword });
  assert.equal(administrator.status, 201);
  const cookie = administrator.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  const issued = await api(fixture, ca, `admin/units/${fixture.unitId}/enrollment`, 'POST', {}, {
    Cookie: cookie, 'x-csrf-token': administrator.body.csrfToken, 'x-organization-id': fixture.organizationId,
  });
  assert.equal(issued.status, 201);
  const artifact = { version: 1, ...issued.body, caPem: ca.toString('utf8') };
  const argumentsFor = (phase, username, password, extra = {}) => {
    const args = ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'org.opentriage.development.ReportRecoveryJourneyTest'];
    for (const [key, value] of Object.entries({ phase, username, password, apiOrigin: fixture.origin, callNumber: report.callNumber, ...extra })) args.push('-e', key, String(value));
    args.push('org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner');
    return args;
  };
  const instrument = (phase, username, password, extra = {}) => {
    const args = argumentsFor(phase, username, password, extra);
    const result = execFileSync(adb, args, { cwd: root, encoding: 'utf8', timeout: 600000 });
    console.log(result); assert.match(result, /OK \(1 test\)/, `Android protected-work phase ${phase}`);
  };
  const prepareUntilKilled = () => {
    const args = argumentsFor('prepare', fixture.clinician.username, fixture.clinicianPassword,
      { artifactBase64: Buffer.from(JSON.stringify(artifact)).toString('base64') });
    const child = spawn(adb, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', announced = false, readyResolve, readyReject, closedResolve;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const closed = new Promise(resolve => { closedResolve = resolve; });
    const timeout = setTimeout(() => { child.kill('SIGTERM'); readyReject(new Error('Android preparation did not reach the live-process checkpoint')); }, 600000);
    const collect = chunk => {
      output += chunk.toString(); process.stdout.write(chunk);
      if (!announced && output.includes('opentriage_phase=ready-for-process-kill')) {
        announced = true; clearTimeout(timeout); readyResolve();
      }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timeout); readyReject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (!announced) readyReject(new Error(`Android preparation exited before the live-process checkpoint (${code ?? signal})`));
      closedResolve({ code, signal });
    });
    return { ready, closed, child };
  };
  const db = new pg.Client({ connectionString: fixture.databaseUrl }); await db.connect();
  let preparation;
  try {
    run(adb, ['-s', serial, 'shell', 'pm', 'clear', 'org.opentriage.development']);
    preparation = prepareUntilKilled(); await preparation.ready;
    const { rows: [opened] } = await db.query(`select r.id,r.form_version_id,r.catalog_release_id,r.validation_version_id,
      envelope.recovery_deadline,envelope.wrapping_key_version from clinical.call_assignment assignment
      join clinical.report r on r.id=assignment.report_id
      join offline_recovery.report_key_envelope envelope on envelope.report_id=r.id
      where assignment.id=$1`, [report.assignmentId]);
    assert(opened, 'Opening the real assignment created its protected envelope');
    assert.equal(opened.form_version_id, report.formVersionId); assert.equal(opened.catalog_release_id, report.catalogReleaseId);
    assert.equal(opened.validation_version_id, report.validationVersionId); assert.equal(Number(opened.wrapping_key_version), 1);
    const firstName = async () => (await db.query(`select value_text from clinical.element_occurrence
      where report_id=$1 and element_id=$2 and tombstoned_at is null`, [opened.id, report.elementId])).rows[0]?.value_text;
    assert.equal(await firstName(), 'ANDROID-RECONNECTED-SYNTHETIC', 'Only the reconnected edit reached the server before process loss');
    const livePid = execFileSync(adb, ['-s', serial, 'shell', 'pidof', 'org.opentriage.development'], { encoding: 'utf8' }).trim();
    assert(livePid, 'The prepared clinical application must still be running before process termination');
    run(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'org.opentriage.development']);
    const remaining = spawnSync(adb, ['-s', serial, 'shell', 'pidof', 'org.opentriage.development'], { encoding: 'utf8' });
    assert.equal(remaining.stdout.trim(), '', 'Host force-stop must actually terminate the live application process');
    let closeTimedOut = false;
    const closeTimeout = setTimeout(() => { closeTimedOut = true; preparation.child.kill('SIGTERM'); }, 30000);
    await preparation.closed; clearTimeout(closeTimeout);
    assert.equal(closeTimedOut, false, 'Instrumentation must report termination after the host kills its live process');
    console.log('PASS abrupt process termination: all preparation assertions completed with a live clinical Activity before host force-stop');
    run(adb, ['-s', serial, 'shell', 'svc', 'wifi', 'disable']); run(adb, ['-s', serial, 'shell', 'svc', 'data', 'disable']);
    instrument('offline', fixture.clinician.username, fixture.clinicianPassword, { reportId: opened.id });
    // A second real termination separates offline relaunch from restored connectivity.
    run(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'org.opentriage.development']);
    run(adb, ['-s', serial, 'shell', 'svc', 'wifi', 'enable']); run(adb, ['-s', serial, 'shell', 'svc', 'data', 'enable']);
    instrument('other', report.secondClinician.username, report.secondClinicianPassword, { reportId: opened.id });
    instrument('recover', fixture.clinician.username, fixture.clinicianPassword);
    assert.equal(await firstName(), 'ANDROID-RETAINED-SYNTHETIC', 'Authorized online recovery synchronized the retained encrypted edit');
    const { rows: [after] } = await db.query(`select form_version_id,catalog_release_id,validation_version_id,
      (select recovery_deadline from offline_recovery.report_key_envelope where report_id=r.id) recovery_deadline
      from clinical.report r where id=$1`, [opened.id]);
    assert.equal(after.form_version_id, opened.form_version_id); assert.equal(after.catalog_release_id, opened.catalog_release_id);
    assert.equal(after.validation_version_id, opened.validation_version_id);
    assert.equal(after.recovery_deadline.toISOString(), opened.recovery_deadline.toISOString(), 'Recovery never renews the original deadline');
    console.log('PASS protected work: actual Android primitives/fallbacks, offline edits, foreground reconnect, retained ciphertext after process kill, different-user denial, online recovery, pinned versions and immutable deadline');
  } finally {
    preparation?.child.kill('SIGTERM');
    run(adb, ['-s', serial, 'shell', 'svc', 'wifi', 'enable']); run(adb, ['-s', serial, 'shell', 'svc', 'data', 'enable']);
    await db.end();
  }
}
