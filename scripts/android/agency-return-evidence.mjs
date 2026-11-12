import assert from 'node:assert/strict';

export const agencyRetainedSnapshotSql=`select report.documenting_user_id,report.organization_id,report.incident_id,report.revision report_revision,envelope.recovery_deadline,envelope.recovery_handle,envelope.envelope_version,envelope.created_at envelope_created_at,assignment.unit_id,
    (select count(*) from offline_recovery.event where report_id=report.id and event_type='ciphertext_written') ciphertext_write_count,
    (select value_text from clinical.element_occurrence where report_id=report.id and element_id='ePatient.03' and tombstoned_at is null) first_name
    from clinical.report report join offline_recovery.report_key_envelope envelope on envelope.report_id=report.id
    join clinical.call_assignment assignment on assignment.report_id=report.id where report.id=$1`;


/** Keep the immutable retained-work proof before genuine recovery writes can renew policy. */
export async function verifyAgencySourceReturn({before,snapshot,returnSource,recoverSource}) {
 await returnSource();
 assert.deepEqual(await snapshot(),before,'Explicit original pairing cannot change retained envelope, deadline or original clinical work before original login and Reopen');
 await recoverSource();
 const recovered=await snapshot();
 for(const key of ['documenting_user_id','organization_id','incident_id','unit_id','recovery_handle','envelope_version','envelope_created_at'])assert.deepEqual(recovered[key],before[key],`Original ${key} remains bound after pending work is acknowledged`);
 assert.equal(recovered.first_name,'ANDROID-AGENCY-PENDING');
 assert(BigInt(recovered.report_revision)>BigInt(before.report_revision),'The real server must acknowledge the pending report change');
 assert(BigInt(recovered.ciphertext_write_count)>BigInt(before.ciphertext_write_count),'A genuine protected ciphertext receipt must precede any ordinary deadline renewal');
 assert(new Date(recovered.recovery_deadline)>=new Date(before.recovery_deadline),'Recovery cannot shorten the existing policy window');
 return recovered;
}
