import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';

/** Continue the real protected-work scenario with a committed enrollment reply loss. */
export async function runReassignmentTransition({fixture,report,applicationId='org.opentriage.development',adb,serial,run,api,db,ca,adminHeaders,retainedSha256,prepareUntilKilled,instrument}) {
  const {rows:[before]}=await db.query(`select id,installation_identity_id,credential_sha256 from app_identity.installation_registration where unit_id=$1 and revoked_at is null order by enrolled_at desc limit 1`,[fixture.unitId]);
  assert(before);
  const unitId=randomUUID();
  await db.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign,active,synthetic,default_form_id)
    select $1,organization_id,'Synthetic reassigned unit','ANDROID-REASSIGNED',true,true,default_form_id from app_identity.operational_unit where id=$2`,[unitId,fixture.unitId]);
  for(const userId of [fixture.clinician.userId,report.secondClinician.userId]) await db.query(`insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)`,[fixture.organizationId,unitId,userId]);
  const issued=await api(fixture,ca,`admin/units/${unitId}/enrollment`,'POST',{},adminHeaders);assert.equal(issued.status,201);
  const artifact={version:1,...issued.body,caPem:ca.toString('utf8')};
  const expiring=await api(fixture,ca,`admin/units/${unitId}/enrollment`,'POST',{},adminHeaders);assert.equal(expiring.status,201);
  const expiredArtifact={version:1,...expiring.body,caPem:ca.toString('utf8')};
  run(adb,['-s',serial,'shell','am','force-stop',applicationId]);
  for(const radio of ['wifi','data'])run(adb,['-s',serial,'shell','svc',radio,'enable']);
  const pending=prepareUntilKilled('reassign',{artifactBase64:Buffer.from(JSON.stringify(artifact)).toString('base64'),expiredArtifactBase64:Buffer.from(JSON.stringify(expiredArtifact)).toString('base64'),retainedSha256});
  try{
    await pending.ready;
    const live=execFileSync(adb,['-s',serial,'shell','pidof',applicationId],{encoding:'utf8'}).trim();assert(live);
    run(adb,['-s',serial,'shell','am','force-stop',applicationId]);
    assert.equal(spawnSync(adb,['-s',serial,'shell','pidof',applicationId],{encoding:'utf8'}).stdout.trim(),'');
    await pending.closed;
    const released=await api(fixture,ca,'__android-enrollment-drop-release','POST',{},adminHeaders);assert.equal(released.body.released,true);
    instrument('resume-reassignment',fixture.clinician.username,fixture.clinicianPassword,{unitId,installationId:before.installation_identity_id,retainedSha256});
    const {rows:after}=await db.query('select id,unit_id,credential_sha256,revoked_at from app_identity.installation_registration where installation_identity_id=$1 order by enrolled_at',[before.installation_identity_id]);
    assert.equal(after.length,2);assert(after[0].revoked_at);assert.equal(after[1].revoked_at,null);assert.equal(after[1].unit_id,unitId);assert.notEqual(after[1].credential_sha256,before.credential_sha256);
    assert.equal((await db.query("select count(*) n from app_identity.installation_event where installation_id=$1 and event_type='installation-reassigned'",[before.id])).rows[0].n,'1');
    const revoked=await api(fixture,ca,`admin/units/${unitId}/installations/${after[1].id}/revoke`,'POST',{},adminHeaders);assert.equal(revoked.status,201);assert.equal(revoked.body.revoked,true);
    console.log('PASS native reassignment: committed reply loss, real process kill, journal retry, one stable identity/rotation, fresh-login boundary, revoked pairing and exact retained ciphertext');
  }finally{pending.child.kill('SIGTERM');}
}
