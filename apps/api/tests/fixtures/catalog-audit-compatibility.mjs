import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CatalogAuthoringService} from '../../dist/admin/catalog-authoring.service.js';
export async function catalogAuditCompatibility({database,query,sessions,token,releaseId}){
 const service=new CatalogAuthoringService(database,sessions);
 const draft=await service.cloneActive(token,{sourceVersionId:releaseId,displayName:'Disposable catalog deletion compatibility'});
 await service.delete(token,draft.id,{expectedRevision:draft.revision});
 assert.equal((await query('select 1 from catalog.authoring_draft where id=$1',[draft.id])).length,0);
 assert.ok((await query("select 1 from app_identity.configuration_event where action='catalog.draft_delete' and details->>'catalogDraftId'=$1",[draft.id])).length);
 // Model a pre-hospital installation with existing form/catalog/configuration
 // events. Other owned suites may already have newer hospital rotation events;
 // validate the upgrade on this bounded pre-hospital snapshot, never downgrade
 // the current installation's audit constraint.
 await query('create temporary table hospital_audit_upgrade (like app_identity.configuration_event including defaults) on commit drop');
 await query(`alter table pg_temp.hospital_audit_upgrade add constraint configuration_event_action_check check(action in ('catalog.draft_delete','form.draft_create','form.draft_save','form.draft_delete','form.publish','form.activate','configuration.activate'))`);
 await query(`insert into pg_temp.hospital_audit_upgrade select * from app_identity.configuration_event where action in ('catalog.draft_delete','form.draft_create','form.draft_save','form.draft_delete','form.publish','form.activate','configuration.activate')`);
 assert.ok((await query("select 1 from pg_temp.hospital_audit_upgrade where action='catalog.draft_delete'")).length);
 for(const file of ['20261019104900_hospital_eps_configuration.sql','20261019163807_hospital_integration_credential_lifecycle.sql']){
  const sql=await readFile(new URL(`../../../../supabase/migrations/${file}`,import.meta.url),'utf8');
  const match=sql.match(/alter table app_identity\.configuration_event drop constraint configuration_event_action_check,[^]*?;/i);assert.ok(match,file);await query(match[0].replaceAll('app_identity.configuration_event','pg_temp.hospital_audit_upgrade'));
 }
}
