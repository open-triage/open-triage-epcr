import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {oidcReportContext} from './oidc-report-context.mjs';

const manifestQuery=`select report.id,report.status,report.revision,snapshot.id snapshot_id,
  snapshot.signed_revision,snapshot.canonical_sha256
  from clinical.report report join clinical.signed_snapshot snapshot on snapshot.report_id=report.id
  where report.organization_id=$1 order by report.id,snapshot.id`;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Harness-only assignment seeding; the ordinary authorized API creates the independent OIDC draft. */
export async function prepareOidcCall({db,fixture}) {
  const target=new URL(fixture.databaseUrl);
  assert(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname===`/android_${fixture.index}`&&[1,2].includes(fixture.index),'OIDC calls require a disposable Android harness database');
  const [organization]=await db.query('select name from app_identity.organization where id=$1',[fixture.organizationId]);
  assert(organization?.name.startsWith('Android synthetic '),'OIDC calls require a synthetic agency');
  const before=await db.query(manifestQuery,[fixture.organizationId]);
  for(const row of before){assert.equal(row.status,'signed');assert.match(row.canonical_sha256,/^[a-f0-9]{64}$/);}
  const signedDigest=digest(before);
  const assertSignedUnchanged=async()=>assert.equal(digest(await db.query(manifestQuery,[fixture.organizationId])),signedDigest,'Earlier signed reports, revisions and immutable snapshots must remain unchanged throughout OIDC');
  const assignmentId=randomUUID(),incidentId=randomUUID(),callNumber=`ANDROID-OIDC-${fixture.index}`;
  const existing=await db.query('select id from clinical.call_assignment where organization_id=$1 and call_number=$2',[fixture.organizationId,callNumber]);
  assert.equal(existing.length,0,'OIDC requires its own unused assignment, never a consumed report or substitute');
  await db.transaction(async manager=>{
    await manager.query("insert into clinical.incident(id,organization_id,operational_state,synthetic) values($1,$2,'assigned',true)",[incidentId,fixture.organizationId]);
    await manager.query(`insert into clinical.call_assignment(id,organization_id,unit_id,incident_id,call_number,dispatched_at,dispatch_reason,status,synthetic)
      values($1,$2,$3,$4,$5,clock_timestamp(),'Synthetic Android OIDC protected work','assigned',true)`,[assignmentId,fixture.organizationId,fixture.unitId,incidentId,callNumber]);
  });
  const rows=await db.query(`select assignment.id assignment_id,assignment.call_number,assignment.report_id,report.status,report.documenting_user_id,report.revision
    from clinical.call_assignment assignment left join clinical.report report on report.id=assignment.report_id
    where assignment.organization_id=$1 and assignment.id=$2`,[fixture.organizationId,assignmentId]);
  const context=oidcReportContext(rows,{callNumber,userId:fixture.clinician.userId,assignmentId});
  assert.equal(context.openAction,'Open call','Only the enrolled native OIDC user may create this fresh report through the ordinary API');
  await assertSignedUnchanged();
  return {...context,assignmentId,assertSignedUnchanged,priorSignedSnapshots:before.length,signedDigest};
}
