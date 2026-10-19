import { mutationRows } from '../database/mutation-result.js';
import type { DataSource } from 'typeorm';
import { contentDigest } from '../admin/canonical-package.js';
import { bytesHash, type CosPreparedPayload } from './cos-payload.js';
export type CosReceiverEvidence={kind:'simulator-stored';contactKey:string;payloadSha256?:string;pdfSha256?:string;receiptId?:string};
export interface CosReceiver {
 contact(reportId:string,payload:CosPreparedPayload):Promise<CosReceiverEvidence>;
 note(reportId:string,deliveryId:string,payload:CosPreparedPayload):Promise<CosReceiverEvidence>;
}
/** Only this explicit error establishes rejection before acceptance. Unknown exceptions are uncertain. */
export class CosRejected extends Error { constructor(public readonly code:'outage'|'contactRejected'|'noteRejected'|'identityConflict'){super(code);} }
/** Independent receiver commits model the crash window of a remote system. No HTTP or live COS claim. */
export class PersistentCosSimulator implements CosReceiver {
 constructor(private readonly database:DataSource){}
 async contact(reportId:string,payload:CosPreparedPayload):Promise<CosReceiverEvidence>{
  if(contentDigest(payload.contact)!==payload.contactSha256)throw new CosRejected('identityConflict');
  const contactKey=`${payload.contact.encounter.system}|${payload.contact.encounter.value}`;
  return this.database.transaction(async manager=>{
   await manager.query(`insert into clinical.cos_simulator_contact(report_id,contact_key,content,content_sha256) values($1,$2,$3::jsonb,$4) on conflict(report_id) do nothing`,[reportId,contactKey,JSON.stringify(payload.contact),payload.contactSha256]);
   const [stored]=await manager.query<Array<{contact_key:string;content_sha256:string}>>('select contact_key,content_sha256 from clinical.cos_simulator_contact where report_id=$1',[reportId]);
   if(stored?.contact_key!==contactKey)throw new CosRejected('identityConflict');
   return {kind:'simulator-stored',contactKey};
  });
 }
 async note(reportId:string,deliveryId:string,payload:CosPreparedPayload):Promise<CosReceiverEvidence>{
  if(contentDigest(payload.contact)!==payload.contactSha256)throw new CosRejected('identityConflict');
  if(bytesHash(payload.pdf)!==payload.pdfSha256||contentDigest({bundle:payload.bundle,pdfSha256:payload.pdfSha256})!==payload.payloadSha256)throw new CosRejected('noteRejected');
  return this.database.transaction(async manager=>{
   const [contact]=await manager.query<Array<{contact_key:string;content_sha256:string}>>('select contact_key,content_sha256 from clinical.cos_simulator_contact where report_id=$1 for update',[reportId]);
   if(!contact||contact.contact_key!==`${payload.contact.encounter.system}|${payload.contact.encounter.value}`)throw new CosRejected('contactRejected');
   await manager.query(`insert into clinical.cos_simulator_note(delivery_id,report_id,bundle,pdf,payload_sha256,pdf_sha256) values($1,$2,$3::jsonb,$4,$5,$6) on conflict(delivery_id) do nothing`,[deliveryId,reportId,JSON.stringify(payload.bundle),payload.pdf,payload.payloadSha256,payload.pdfSha256]);
   const [stored]=await manager.query<Array<{receipt_id:string;payload_sha256:string;pdf_sha256:string;pdf:Buffer;bundle:unknown}>>('select receipt_id,payload_sha256,pdf_sha256,pdf,bundle from clinical.cos_simulator_note where delivery_id=$1 and report_id=$2',[deliveryId,reportId]);
   if(!stored||bytesHash(stored.pdf)!==payload.pdfSha256||contentDigest({bundle:stored.bundle,pdfSha256:stored.pdf_sha256})!==payload.payloadSha256)throw new CosRejected('identityConflict');
   const [version]=await manager.query<Array<{amendment_sequence:number}>>('select amendment_sequence from clinical.cos_delivery where id=$1 and report_id=$2',[deliveryId,reportId]);
   if(!version||version.amendment_sequence!==payload.amendmentSequence)throw new CosRejected('identityConflict');
   const changed=mutationRows(await manager.query(`insert into clinical.cos_simulator_current(report_id,delivery_id,amendment_sequence,contact,contact_sha256)
    values($1,$2,$3,$4::jsonb,$5) on conflict(report_id) do update set delivery_id=excluded.delivery_id,amendment_sequence=excluded.amendment_sequence,
     contact=excluded.contact,contact_sha256=excluded.contact_sha256,updated_at=clock_timestamp()
    where cos_simulator_current.amendment_sequence<excluded.amendment_sequence or cos_simulator_current.delivery_id=excluded.delivery_id returning report_id`,[reportId,deliveryId,payload.amendmentSequence,JSON.stringify(payload.contact),payload.contactSha256]));
   if(!changed.length)throw new CosRejected('identityConflict');
   return {kind:'simulator-stored',contactKey:contact.contact_key,receiptId:stored.receipt_id,payloadSha256:stored.payload_sha256,pdfSha256:stored.pdf_sha256};
  });
 }
}
