import {randomUUID} from 'node:crypto';
/** Minimal immutable clinical fixtures in the disposable OIDC database. */
export async function seedProtectedRecoveryReports(db,agency,alpha,local){
 const catalog=randomUUID(),form=randomUUID(),version=randomUUID(),demographics=randomUUID(),hash='a'.repeat(64);
 await db.query("insert into catalog.release(id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance) values($1,'Fictional','010','recovery','1',$2,'{}')",[catalog,hash]);
 await db.query("insert into forms.form(id,organization_id,slug,name) values($1,$2,'recovery-fixture','Fictional recovery fixture')",[form,agency]);
 await db.query("insert into forms.form_version(id,form_id,catalog_release_id,version,status,canonical_definition,definition_sha256,created_by,published_by,published_at,change_note) values($1,$2,$3,1,'published','{\"schemaVersion\":1,\"sections\":[]}',$4,$5,$5,now(),'Controlled regression')",[version,form,catalog,hash,alpha]);
 await db.query("insert into app_identity.agency_demographic_version(id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,definition_sha256,effective_from,created_by) values($1,$2,$3,1,'fictional','fixture','fixture',$4,now(),$5)",[demographics,agency,catalog,hash,alpha]);
 for(const [id,user] of [['91200000-0000-4000-8000-000000000001',alpha],['91200000-0000-4000-8000-000000000003',local],['91200000-0000-4000-8000-000000000004',alpha],['91200000-0000-4000-8000-000000000005',alpha]]){
  const incident=randomUUID(),patient=randomUUID();
  await db.query('insert into clinical.incident(id,organization_id) values($1,$2)',[incident,agency]);
  await db.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key) values($1,$2,'unknown',$3)",[patient,agency,patient.replaceAll('-','').repeat(2)]);
  await db.query('insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,agency,incident,patient,demographics,version,catalog,user]);
 }
}
