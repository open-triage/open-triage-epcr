import { mutationRows } from '../database/mutation-result.js';
import type { EntityManager } from 'typeorm';
import { cosMappingPackage } from './cos-configuration.js';
import type { CanonicalPackage } from '../admin/canonical-package.js';
/** Same serialization point as configuration activation, even before the first state row exists.
 * Called only in the signature transaction; no historical discovery and no remote I/O. */
export async function queueSignedCos(manager:EntityManager,reportId:string,snapshotId:string,actorId:string){
 const [report]=await manager.query<Array<{organization_id:string;group_id:string;pdf_language:string}>>(`select r.organization_id,app_identity.organization_group(r.organization_id) group_id,coalesce(a.language,'en') pdf_language from clinical.report r left join app_identity.agency_settings a on a.organization_id=r.organization_id where r.id=$1`,[reportId]);
 if(!report)return;
 await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[report.group_id]);
 const [state]=await manager.query<Array<{active_revision:string|null}>>('select active_revision from app_identity.hospital_cos_state where group_id=$1 for update',[report.group_id]);
 if(!state?.active_revision)return;
 const [active]=await manager.query<Array<{revision:string;canonical_mapping:CanonicalPackage}>>(`select revision,canonical_mapping from app_identity.hospital_cos_version where group_id=$1 and revision=$2 and settings->>'mode'='simulator'`,[report.group_id,state.active_revision]);
 if(!active)return;
 const mapping=cosMappingPackage(active.canonical_mapping).definition;
 const rows=mutationRows<{id:string}>(await manager.query(`insert into clinical.cos_delivery(report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,queued_by,pdf_language)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(snapshot_id,amendment_sequence) where lineage_parent_id is null do nothing returning id`,[reportId,snapshotId,report.organization_id,report.group_id,active.revision,mapping.id,mapping.revision,active.canonical_mapping.sha256,actorId,report.pdf_language]));
 if(rows[0])await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state) values($1,$2,$3,'pending')`,[rows[0].id,reportId,actorId]);
}
