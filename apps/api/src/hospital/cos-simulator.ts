import { mutationRows } from '../database/mutation-result.js';
import type { DataSource, EntityManager } from 'typeorm';
import { contentDigest } from '../admin/canonical-package.js';
import { bytesHash, type CosPreparedPayload } from './cos-payload.js';
export type CosReceiverEvidence={kind:'simulator-stored';contactKey:string;payloadSha256?:string;pdfSha256?:string;receiptId?:string};
export type CosOperation={deliveryId:string;attemptId:string};
export interface CosReceiver {
 contact(reportId:string,payload:CosPreparedPayload,operation?:CosOperation):Promise<CosReceiverEvidence>;
 note(reportId:string,deliveryId:string,payload:CosPreparedPayload,attemptId?:string):Promise<CosReceiverEvidence>;
}
/** Only this explicit error establishes rejection before acceptance. Unknown exceptions are uncertain. */
export class CosRejected extends Error { constructor(public readonly code:'outage'|'contactRejected'|'noteRejected'|'identityConflict'){super(code);} }
/** Independent receiver commits model the crash window of a remote system. No HTTP or live COS claim. */
export class PersistentCosSimulator implements CosReceiver {
 constructor(private readonly database:DataSource){}
 async contact(reportId:string,payload:CosPreparedPayload,operation?:CosOperation):Promise<CosReceiverEvidence>{
  if(contentDigest(payload.contact)!==payload.contactSha256)throw new CosRejected('identityConflict');
  const contactKey=`${payload.contact.encounter.system}|${payload.contact.encounter.value}`;
  return this.database.transaction(async manager=>{
   const [liveReport]=await manager.query('select id from clinical.report where id=$1 for key share',[reportId]);
   if(!liveReport)throw new CosRejected('identityConflict');
   await manager.query('select pg_advisory_xact_lock(731021,hashtext($1))',[reportId]);
   if(operation)await assertUnfenced(manager,reportId,operation.deliveryId,operation.attemptId);
   else if((await manager.query('select attempt_id from clinical.cos_simulator_fence where report_id=$1 limit 1',[reportId])).length)throw new CosRejected('contactRejected');
   await manager.query(`insert into clinical.cos_simulator_contact(report_id,contact_key,content,content_sha256) values($1,$2,$3::jsonb,$4) on conflict(report_id) do nothing`,[reportId,contactKey,JSON.stringify(payload.contact),payload.contactSha256]);
   const [stored]=await manager.query<Array<{contact_key:string;content_sha256:string}>>('select contact_key,content_sha256 from clinical.cos_simulator_contact where report_id=$1',[reportId]);
   if(stored?.contact_key!==contactKey)throw new CosRejected('identityConflict');
   return {kind:'simulator-stored',contactKey};
  });
 }
 async note(reportId:string,deliveryId:string,payload:CosPreparedPayload,attemptId?:string):Promise<CosReceiverEvidence>{
  if(contentDigest(payload.contact)!==payload.contactSha256)throw new CosRejected('identityConflict');
  if(bytesHash(payload.pdf)!==payload.pdfSha256||contentDigest({bundle:payload.bundle,pdfSha256:payload.pdfSha256})!==payload.payloadSha256)throw new CosRejected('noteRejected');
  return this.database.transaction(async manager=>{
   const [liveReport]=await manager.query('select id from clinical.report where id=$1 for key share',[reportId]);
   if(!liveReport)throw new CosRejected('identityConflict');
   await manager.query('select pg_advisory_xact_lock(731021,hashtext($1))',[reportId]);
   await assertUnfenced(manager,reportId,deliveryId,attemptId);
   const [contact]=await manager.query<Array<{contact_key:string;content_sha256:string}>>('select contact_key,content_sha256 from clinical.cos_simulator_contact where report_id=$1 for update',[reportId]);
   if(!contact||contact.contact_key!==`${payload.contact.encounter.system}|${payload.contact.encounter.value}`)throw new CosRejected('contactRejected');
   await manager.query(`insert into clinical.cos_simulator_note(delivery_id,report_id,bundle,pdf,payload_sha256,pdf_sha256,operation_attempt_id) values($1,$2,$3::jsonb,$4,$5,$6,$7) on conflict(delivery_id) do nothing`,[deliveryId,reportId,JSON.stringify(payload.bundle),payload.pdf,payload.payloadSha256,payload.pdfSha256,attemptId??null]);
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

/** Receiver operation lane serializes the write with the durable rejection fence.
 * Legacy in-process test adapters without an attempt are denied after any fence.
 */
async function assertUnfenced(manager:EntityManager,reportId:string,deliveryId:string,attemptId?:string){
 const [fence]=await manager.query('select attempt_id from clinical.cos_simulator_fence where report_id=$1 and delivery_id=$2 and ($3::uuid is null or attempt_id=$3) limit 1',[reportId,deliveryId,attemptId??null]);
 if(fence)throw new CosRejected('noteRejected');
 if(attemptId){const [attempt]=await manager.query('select id from clinical.cos_attempt where id=$1 and delivery_id=$2 and report_id=$3',[attemptId,deliveryId,reportId]);if(!attempt)throw new CosRejected('identityConflict');}
}
export type CosReconciliationProof={contract:'simulator-fenced-status-v1';outcome:'stored'|'not-stored'|'unresolved'|'unsupported';contact:'known'|'rejected'|'uncertain';note:'known'|'rejected'|'uncertain';storage:'known'|'rejected'|'uncertain';attemptId:string;payloadSha256:string;pdfSha256:string;receiptId?:string;fenced?:boolean};
/** Candidate simulator status contract, not a Cambio endpoint. Absence alone is never proof.
 * Hold the receiver lane, check exact immutable bytes, or fence this attempt before
 * declaring no note. Late effects are rejected by that same lane before any write.
 */
export async function reconcileSimulator(manager:EntityManager,reportId:string,deliveryId:string,attemptId:string):Promise<CosReconciliationProof>{
 const [lane]=await manager.query<Array<{locked:boolean}>>('select pg_try_advisory_xact_lock(731021,hashtext($1)) locked',[reportId]);
 const [payload]=await manager.query<Array<{payload_sha256:string;pdf_sha256:string;contact_sha256:string;bundle:unknown;pdf:Buffer;contact:CosPreparedPayload['contact']}>>('select * from clinical.cos_payload where delivery_id=$1 and report_id=$2',[deliveryId,reportId]);
 const [attempt]=await manager.query<Array<{payload_sha256:string;pdf_sha256:string}>>('select payload_sha256,pdf_sha256 from clinical.cos_attempt where id=$1 and delivery_id=$2 and report_id=$3',[attemptId,deliveryId,reportId]);
 const proof:CosReconciliationProof={contract:'simulator-fenced-status-v1',outcome:'unresolved',contact:'uncertain',note:'uncertain',storage:'uncertain',attemptId,payloadSha256:attempt?.payload_sha256??'',pdfSha256:attempt?.pdf_sha256??''};
 if(!lane?.locked||!payload||!attempt||attempt.payload_sha256!==payload.payload_sha256||attempt.pdf_sha256!==payload.pdf_sha256||bytesHash(payload.pdf)!==payload.pdf_sha256||contentDigest(payload.contact)!==payload.contact_sha256||contentDigest({bundle:payload.bundle,pdfSha256:payload.pdf_sha256})!==payload.payload_sha256)return proof;
 const [contact]=await manager.query<Array<{contact_key:string}>>('select contact_key from clinical.cos_simulator_contact where report_id=$1',[reportId]);
 if(contact&&contact.contact_key!==`${payload.contact.encounter.system}|${payload.contact.encounter.value}`)return proof;
 proof.contact=contact?'known':'uncertain';
 const [note]=await manager.query<Array<{receipt_id:string;operation_attempt_id:string|null;payload_sha256:string;pdf_sha256:string;pdf:Buffer;bundle:unknown}>>('select * from clinical.cos_simulator_note where delivery_id=$1 and report_id=$2',[deliveryId,reportId]);
 if(note){
  if(!contact||note.operation_attempt_id!==attemptId||note.payload_sha256!==payload.payload_sha256||note.pdf_sha256!==payload.pdf_sha256||bytesHash(note.pdf)!==payload.pdf_sha256||contentDigest({bundle:note.bundle,pdfSha256:note.pdf_sha256})!==payload.payload_sha256)return proof;
  return {...proof,outcome:'stored',contact:'known',note:'known',storage:'known',receiptId:note.receipt_id};
 }
 await manager.query('insert into clinical.cos_simulator_fence(attempt_id,delivery_id,report_id) values($1,$2,$3) on conflict(attempt_id) do nothing',[attemptId,deliveryId,reportId]);
 return {...proof,outcome:'not-stored',contact:contact?'known':'rejected',note:'rejected',storage:'rejected',fenced:true};
}
