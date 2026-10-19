import type { EntityManager } from 'typeorm';
import { reconcileTransmissionReason } from '../review/review-transmission.js';
/** Definite outage or verified fenced non-delivery. Other findings need correction. */
export const cosRetryable = (state:string,finding:string|null) => state==='failed'&&(finding==='outage'||finding==='reconciledNotStored');
/** Caller serializes the report. A queued retry remains unresolved until final remote proof. */
export async function reconcileCosFailure(manager:EntityManager,reportId:string){
 const [latest]=await manager.query<Array<{id:string;amendment_sequence:number;configuration_revision:string;mapping_id:string;mapping_revision:number;mapping_sha256:string;state:string;finding:string|null;state_revision:string;active_revision:string|null;failed:boolean;uncertain:boolean}>>(`
 select d.*,s.state_revision,s.active_revision,exists(select 1 from clinical.cos_delivery barrier where barrier.report_id=d.report_id and barrier.state='uncertain') uncertain,exists(select 1 from clinical.cos_delivery_event e where e.report_id=d.report_id and e.state in ('failed','uncertain') and e.finding is distinct from 'inFlight' and e.finding is distinct from 'contactStored') failed
 from clinical.cos_delivery d join app_identity.hospital_cos_state s on s.group_id=d.group_id
 where d.report_id=$1 order by d.amendment_sequence desc,d.created_at desc,d.id desc limit 1`,[reportId]);
 if(!latest)return;
 await reconcileTransmissionReason(manager,reportId,'delivery-failure',latest.failed&&latest.state!=='confirmed',{
 integration:'cos',deliveryId:latest.id,amendmentSequence:latest.amendment_sequence,configurationRevision:latest.configuration_revision,
 mappingId:latest.mapping_id,mappingRevision:latest.mapping_revision,mappingSha256:latest.mapping_sha256,
 missing:[],patientField:null,deliveryState:latest.state,finding:latest.finding,stateRevision:Number(latest.state_revision),
 retryable:!latest.uncertain&&cosRetryable(latest.state,latest.finding)&&Number(latest.active_revision)===Number(latest.configuration_revision),
 });
}
