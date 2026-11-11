import { captureAndroidFailure } from './diagnostics.mjs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import { seedReportFixture } from './report-fixture.mjs';

/** Real radio loss and host process termination; no mocked requests or key/crypto substitutions. */
export async function runReportRecoveryJourney({ root, fixture, adb, serial, run, api, applicationId = 'org.opentriage.development', afterProcessStop, upgrade = false, hooks = {}, audio = false, unsavedAudio = false }) {
  const report = await seedReportFixture(root, fixture, run); let ca = await readFile(fixture.caPath);
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
    for (const [key, value] of Object.entries({ phase, username, password, apiOrigin: fixture.origin, callNumber: report.callNumber, upgrade: upgrade ? '1' : '0', audio: audio ? '1' : '0', unsavedAudio: unsavedAudio ? '1' : '0', ...extra })) args.push('-e', key, String(value));
    args.push(`${applicationId}.test/androidx.test.runner.AndroidJUnitRunner`);
    return args;
  };
  const instrument = (phase, username, password, extra = {}) => {
    const args = argumentsFor(phase, username, password, extra);
    const result = execFileSync(adb, args, { cwd: root, encoding: 'utf8', timeout: 600000 });
    console.log(result); assert.match(result, /OK \(1 test\)/, `Android protected-work phase ${phase}`);
    return result;
  };
  const prepareUntilKilled = (phase = 'prepare', extra = {}) => {
    const args = argumentsFor(phase, fixture.clinician.username, fixture.clinicianPassword,
      { artifactBase64: Buffer.from(JSON.stringify(artifact)).toString('base64'), ...extra });
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
    run(adb, ['-s', serial, 'shell', 'pm', 'clear', applicationId]);
    preparation = prepareUntilKilled(); await preparation.ready;
    const { rows: [opened] } = await db.query(`select r.id,r.revision,r.form_version_id,r.catalog_release_id,r.validation_version_id,
      envelope.recovery_deadline,envelope.wrapping_key_version,envelope.ciphertext_revision from clinical.call_assignment assignment
      join clinical.report r on r.id=assignment.report_id
      join offline_recovery.report_key_envelope envelope on envelope.report_id=r.id
      where assignment.id=$1`, [report.assignmentId]);
    assert(opened, 'Opening the real assignment created its protected envelope');
    assert.equal(opened.form_version_id, report.formVersionId); assert.equal(opened.catalog_release_id, report.catalogReleaseId);
    assert.equal(opened.validation_version_id, report.validationVersionId); assert.equal(Number(opened.wrapping_key_version), 1);
    const firstName = async () => (await db.query(`select value_text from clinical.element_occurrence
      where report_id=$1 and element_id=$2 and tombstoned_at is null`, [opened.id, report.elementId])).rows[0]?.value_text;
    assert.equal(await firstName(), 'ANDROID-RECONNECTED-SYNTHETIC', 'Only the reconnected edit reached the server before process loss');
    await hooks.beforeProcessKill?.({ root, fixture, report, opened, applicationId, adb, serial, run, api, db, ca, setHostCa: value => { ca=value; }, prepareUntilKilled, instrument });
    const livePid = execFileSync(adb, ['-s', serial, 'shell', 'pidof', applicationId], { encoding: 'utf8' }).trim();
    assert(livePid, 'The prepared clinical application must still be running before process termination');
    run(adb, ['-s', serial, 'shell', 'am', 'force-stop', applicationId]);
    const remaining = spawnSync(adb, ['-s', serial, 'shell', 'pidof', applicationId], { encoding: 'utf8' });
    assert.equal(remaining.stdout.trim(), '', 'Host force-stop must actually terminate the live application process');
    let closeTimedOut = false;
    const closeTimeout = setTimeout(() => { closeTimedOut = true; preparation.child.kill('SIGTERM'); }, 30000);
    await preparation.closed; clearTimeout(closeTimeout);
    assert.equal(closeTimedOut, false, 'Instrumentation must report termination after the host kills its live process');
    if (afterProcessStop) await afterProcessStop();
    if (unsavedAudio) run(adb, ['-s', serial, 'shell', 'pm', 'revoke', applicationId, 'android.permission.RECORD_AUDIO']);
    console.log('PASS abrupt process termination: all preparation assertions completed with a live clinical Activity before host force-stop');
    run(adb, ['-s', serial, 'shell', 'svc', 'wifi', 'disable']); run(adb, ['-s', serial, 'shell', 'svc', 'data', 'disable']);
    const offlineResult = instrument('offline', fixture.clinician.username, fixture.clinicianPassword, { reportId: opened.id });
    const retainedSha256 = /retained_sha256=([a-f0-9]{64})/.exec(offlineResult)?.[1];
    assert(retainedSha256, 'Offline relaunch must publish only an opaque digest of its retained encrypted record');
    // Retained native credentials correctly restore their authorized clinician.
    // Withdraw that session through the ordinary administrator API while the
    // device is still offline, so reconnect cannot recover under the old user
    // before the different clinician signs in. Do not modify the native vault.
    const adminHeaders = { Cookie: cookie, 'x-csrf-token': administrator.body.csrfToken, 'x-organization-id': fixture.organizationId };
    const sessions = await api(fixture, ca, `admin/users/${fixture.clinician.userId}/sessions`, 'GET', undefined, adminHeaders);
    assert.equal(sessions.status, 200); assert(sessions.body.items.length > 0);
    for (const session of sessions.body.items) {
      const revoked = await api(fixture, ca, `admin/users/${fixture.clinician.userId}/sessions/${session.id}`, 'DELETE', {}, adminHeaders);
      assert.equal(revoked.status, 200, JSON.stringify(revoked.body)); assert.equal(revoked.body.revoked, true);
    }
    await hooks.beforeReconnect?.({ root, fixture, report, opened, applicationId, adb, serial, run, api, db, ca, setHostCa: value => { ca=value; }, adminHeaders, retainedSha256, prepareUntilKilled, instrument });
    // A second real termination separates offline relaunch from restored connectivity.
    run(adb, ['-s', serial, 'shell', 'am', 'force-stop', applicationId]);
    run(adb, ['-s', serial, 'shell', 'svc', 'wifi', 'enable']); run(adb, ['-s', serial, 'shell', 'svc', 'data', 'enable']);
    instrument('other', report.secondClinician.username, report.secondClinicianPassword, { reportId: opened.id, retainedSha256 });
    assert.equal(await firstName(), 'ANDROID-RECONNECTED-SYNTHETIC', 'Session withdrawal and another clinician must not synchronize the pending work');
    const beforeRecovery = (await db.query('select recovery_deadline from offline_recovery.report_key_envelope where report_id=$1', [opened.id])).rows[0];
    assert.equal(beforeRecovery.recovery_deadline.toISOString(), opened.recovery_deadline.toISOString(), 'Process restart, session withdrawal and another clinician never renew the deadline');
    const recoveryLogin = await api(fixture, ca, 'sessions', 'POST', { username: fixture.clinician.username, password: fixture.clinicianPassword });
    assert.equal(recoveryLogin.status, 201);
    const recoveryCookie = recoveryLogin.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    const recoveryHeaders = { Cookie: recoveryCookie, 'x-csrf-token': recoveryLogin.body.csrfToken, 'x-organization-id': fixture.organizationId };
    const grant = await api(fixture, ca, `reports/${opened.id}/recovery-grants`, 'POST', { schemaVersion: 1, envelopeVersion: 1 }, recoveryHeaders);
    assert.equal(grant.status, 201);
    const consumed = await api(fixture, ca, `reports/${opened.id}/recovery-grants/consume`, 'POST', { schemaVersion: 1, envelopeVersion: grant.body.envelopeVersion, grant: grant.body.grant }, recoveryHeaders);
    assert.equal(consumed.status, 200); assert.equal(consumed.body.wrappingKeyVersion, 1);
    const afterGrant = (await db.query('select recovery_deadline from offline_recovery.report_key_envelope where report_id=$1', [opened.id])).rows[0];
    assert.equal(afterGrant.recovery_deadline.toISOString(), opened.recovery_deadline.toISOString(), 'Authorized sign-in, grant and key restoration alone never renew the deadline');
    console.log('PASS authority-only recovery: restart, other clinician, original sign-in, grant and key restoration preserved the exact prior deadline');
    instrument('recover', fixture.clinician.username, fixture.clinicianPassword);
    assert.equal(await firstName(), 'ANDROID-RETAINED-SYNTHETIC', 'Authorized online recovery synchronized the retained encrypted edit');
    let synchronizedReceipt;
    for (let attempt = 0; attempt < 100; attempt++) {
      synchronizedReceipt = (await db.query('select ciphertext_revision from offline_recovery.report_key_envelope where report_id=$1', [opened.id])).rows[0];
      if (Number(synchronizedReceipt.ciphertext_revision) > Number(opened.ciphertext_revision)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(Number(synchronizedReceipt.ciphertext_revision) > Number(opened.ciphertext_revision), 'The recovered edit must record its new authenticated ciphertext receipt');
    const { rows: [after] } = await db.query(`select revision,form_version_id,catalog_release_id,validation_version_id,
      (select recovery_deadline from offline_recovery.report_key_envelope where report_id=r.id) recovery_deadline,
      (select least(max(event.occurred_at) + make_interval(hours=>organization.offline_recovery_window_hours),coalesce(r.expires_at,'infinity'::timestamptz))
       from offline_recovery.event event join app_identity.organization organization on organization.id=event.organization_id
       where event.report_id=r.id and event.event_type='ciphertext_written' group by organization.offline_recovery_window_hours) expected_deadline
      from clinical.report r where id=$1`, [opened.id]);
    assert(Number(after.revision) > Number(opened.revision), 'The actual retained edit advances the report revision');
    assert.equal(after.form_version_id, opened.form_version_id); assert.equal(after.catalog_release_id, opened.catalog_release_id);
    assert.equal(after.validation_version_id, opened.validation_version_id);
    assert.equal(after.recovery_deadline.toISOString(), after.expected_deadline.toISOString(), 'Only the synchronized retained edit receipt advances the deadline under the established policy and report expiry');
    console.log('PASS protected work: actual Android primitives/fallbacks, offline edits, foreground reconnect, retained ciphertext after process kill, different-user denial, online recovery, pinned versions and policy-bound deadline');
  } catch (error) {
    try { await captureAndroidFailure({ root, adb, serial, applicationId, secrets: [fixture.administratorPassword, fixture.clinicianPassword, report.secondClinicianPassword, issued.body.token] }); } catch { console.error('Android recovery diagnostics unavailable'); }
    const diagnostics = (await db.query(`select r.id,r.revision,envelope.ciphertext_revision,envelope.recovery_deadline,
      (select value_text from clinical.element_occurrence where report_id=r.id and element_id=$2 and tombstoned_at is null limit 1) first_name
      from clinical.call_assignment assignment join clinical.report r on r.id=assignment.report_id
      left join offline_recovery.report_key_envelope envelope on envelope.report_id=r.id where assignment.id=$1`, [report.assignmentId, report.elementId])).rows;
    console.log('Synthetic recovery database diagnostics', JSON.stringify(diagnostics));
    if (process.env.ANDROID_RECOVERY_DEBUG_PAUSE === '1') {
      const debugFile = '/tmp/android-003-recovery-debug.json', releaseFile = '/tmp/android-003-recovery-debug.release';
      await rm(releaseFile, { force: true });
      await writeFile(debugFile, JSON.stringify({ databaseUrl: fixture.databaseUrl, assignmentId: report.assignmentId, reportId: diagnostics[0]?.id }));
      console.log('Synthetic recovery fixtures held for up to 180 seconds; inspect /tmp/android-003-recovery-debug.json and create /tmp/android-003-recovery-debug.release to finish cleanup.');
      for (let attempt = 0; attempt < 180; attempt++) {
        try { await readFile(releaseFile); break; } catch { /* Wait only for the local diagnostic release file. */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await rm(debugFile, { force: true }); await rm(releaseFile, { force: true });
    }
    throw error;
  } finally {
    preparation?.child.kill('SIGTERM');
    run(adb, ['-s', serial, 'shell', 'svc', 'wifi', 'enable']); run(adb, ['-s', serial, 'shell', 'svc', 'data', 'enable']);
    await db.end();
  }
}
