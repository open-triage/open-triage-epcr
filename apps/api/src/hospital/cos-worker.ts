import { reconcileCosFailure } from './cos-recovery-review.js';
import { contentDigest } from '../admin/canonical-package.js';
import { reconcileTransmissionReview } from '../review/review-transmission.js';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { CosConnectionSettings } from '@open-triage/contracts';
import type { CanonicalPackage } from '../admin/canonical-package.js';
import { signedReportPdfSource } from '../reports/signed-report-pdf.persistence.js';
import { renderSignedReportPdf, effectiveSignedPdfOccurrences, SignedPdfError } from '../reports/signed-report-pdf.js';
import { bytesHash, buildCosPayload, cosIdentifierRequirements, cosEligibility, CosFinding, type CosPreparedPayload } from './cos-payload.js';
import { PersistentCosSimulator, CosRejected, type CosReceiver } from './cos-simulator.js';
type Job={id:string;report_id:string;snapshot_id:string;organization_id:string;group_id:string;configuration_revision:string;
 mapping_id:string;mapping_revision:number;mapping_sha256:string;amendment_sequence:number;pdf_language:'en'|'sv';settings:CosConnectionSettings;canonical_mapping:CanonicalPackage};
async function event(manager:EntityManager,job:Pick<Job,'id'|'report_id'>,worker:string,state:string,finding:string|null=null,attempt:string|null=null,evidence:unknown={}){
 await manager.query('select id from clinical.report where id=$1 for update',[job.report_id]);
 await manager.query('update clinical.cos_delivery set state=$2,finding=$3,updated_at=clock_timestamp() where id=$1',[job.id,state,finding]);
 await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,attempt_id,worker_id,state,finding,evidence) values($1,$2,$3,$4,$5,$6,$7::jsonb)`,[job.id,job.report_id,attempt,worker,state,finding,JSON.stringify(evidence)]);
 await reconcileCosFailure(manager,job.report_id);
}
/** Bounded durable worker. Session advisory lock spans separately committed local/receiver steps.
 * 'uncertain' intent is committed BEFORE a possible remote effect, so restart cannot blind-resend.
 * Service authority is limited to a queued report in its recorded agency/group/snapshot, created
 * by an authorized signature under activated simulator configuration. No forged end-user session.
 */
export async function processCosWork(database:DataSource,limit=10,receiver:CosReceiver=new PersistentCosSimulator(database)){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid COS batch size');
 const worker=randomUUID();let processed=0;
 // A vanished process can leave durable intent without recording its unknown outcome.
 // Owning the same lock proves no live worker is still awaiting the receiver. Reconcile,
 // never resend; a process crash must still leave an operational recovery home.
 const interrupted=await database.query<Array<{id:string;report_id:string}>>(`select d.id,d.report_id from clinical.cos_delivery d join clinical.report r on r.id=d.report_id where d.state='uncertain' and d.finding in ('inFlight','contactStored') and (r.expires_at is null or r.expires_at>clock_timestamp()) order by d.updated_at,d.id limit $1`,[limit]);
 for(const prior of interrupted)await database.transaction(async manager=>{
  const [lock]=await manager.query<Array<{locked:boolean}>>('select pg_try_advisory_xact_lock(731013,hashtext($1)) locked',[prior.report_id]);
  if(!lock?.locked)return;
  await manager.query('select id from clinical.report where id=$1 for update',[prior.report_id]);
  const [still]=await manager.query(`select id from clinical.cos_delivery where id=$1 and state='uncertain' and finding in ('inFlight','contactStored') for update`,[prior.id]);
  if(!still)return;
  const [attempt]=await manager.query<Array<{id:string}>>('select id from clinical.cos_attempt where delivery_id=$1 order by created_at desc,id desc limit 1',[prior.id]);
  await event(manager,prior,worker,'uncertain','outcomeUnknown',attempt?.id??null);
 });
 const candidates=await database.query<Array<{id:string;report_id:string}>>(`select d.id,d.report_id from clinical.cos_delivery d join app_identity.hospital_cos_state s on s.group_id=d.group_id join clinical.report r on r.id=d.report_id where (r.expires_at is null or r.expires_at>clock_timestamp()) and d.state='pending' and s.active_revision is not null and not exists(select 1 from clinical.cos_delivery barrier where barrier.report_id=d.report_id and barrier.id<>d.id and barrier.state='uncertain') order by d.created_at,d.id limit $1`,[limit]);
 for(const candidate of candidates){
  const runner=database.createQueryRunner();await runner.connect();let held=false;
  try{
   const [lock]=await runner.query('select pg_try_advisory_lock(731013,hashtext($1)) locked',[candidate.report_id]);held=!!lock?.locked;if(!held)continue;
   let job:Job|undefined,payload:CosPreparedPayload|undefined,attempt:string|undefined,recovery:string|undefined;
   await runner.startTransaction('REPEATABLE READ');
   try{
    await runner.manager.query('select id from clinical.report where id=$1 for update',[candidate.report_id]);
    [job]=await runner.manager.query<Job[]>(`select d.*,v.settings,v.canonical_mapping from clinical.cos_delivery d
     join clinical.report r on r.id=d.report_id and r.organization_id=d.organization_id and r.status='signed'
     join app_identity.hospital_cos_version v on v.group_id=d.group_id and v.revision=d.configuration_revision
     join app_identity.hospital_cos_state s on s.group_id=d.group_id
     where d.id=$1 and (r.expires_at is null or r.expires_at>clock_timestamp()) and d.state='pending' and s.active_revision is not null
       and app_identity.organization_group(r.organization_id)=d.group_id for update of d for share of s`,[candidate.id]);
    if(job){
     const [ordering]=await runner.manager.query<Array<{blocked:boolean;obsolete:boolean;prepared:boolean}>>(`select
      exists(select 1 from clinical.cos_delivery where report_id=$1 and id<>$2 and state='uncertain') blocked,
      (exists(select 1 from clinical.cos_delivery where report_id=$1 and amendment_sequence>$3) or exists(select 1 from clinical.amendment where report_id=$1 and sequence>$3)) obsolete,
      exists(select 1 from clinical.cos_attempt where delivery_id=$2) or exists(select 1 from clinical.cos_payload where delivery_id=$2) prepared`,[job.report_id,job.id,job.amendment_sequence]);
     [recovery]=await runner.manager.query<Array<{id:string}>>(`select c.id from clinical.cos_recovery_command c where c.delivery_id=$1 and not exists(select 1 from clinical.cos_attempt a where a.recovery_command_id=c.id) order by c.created_at limit 1`,[job.id]).then(rows=>rows.map(row=>row.id));
     if(ordering?.prepared&&!recovery){await event(runner.manager,job,worker,'uncertain','outcomeUnknown');job=undefined;}
     else if(ordering?.obsolete){await event(runner.manager,job,worker,'superseded');job=undefined;}
     else if(ordering?.blocked)job=undefined;
    }
    if(job){
     try{
      if(job.settings.mode!=='simulator'||job.canonical_mapping.sha256!==job.mapping_sha256)throw new CosFinding('configuration','failed');
      if(recovery){
       const [live]=await runner.manager.query<Array<{active_revision:string|null}>>('select active_revision from app_identity.hospital_cos_state where group_id=$1',[job.group_id]);
       if(Number(live?.active_revision)!==Number(job.configuration_revision))throw new CosFinding('configuration','failed');
       const [stored]=await runner.manager.query<Array<{bundle:CosPreparedPayload['bundle'];pdf:Buffer;payload_sha256:string;pdf_sha256:string;contact:CosPreparedPayload['contact'];contact_sha256:string}>>('select * from clinical.cos_payload where delivery_id=$1 and report_id=$2',[job.id,job.report_id]);
       if(!stored||bytesHash(stored.pdf)!==stored.pdf_sha256||contentDigest(stored.contact)!==stored.contact_sha256||contentDigest({bundle:stored.bundle,pdfSha256:stored.pdf_sha256})!==stored.payload_sha256)throw new CosFinding('configuration','failed');
       payload={amendmentSequence:job.amendment_sequence,bundle:stored.bundle,pdf:stored.pdf,payloadSha256:stored.payload_sha256,pdfSha256:stored.pdf_sha256,contact:stored.contact,contactSha256:stored.contact_sha256};
      }else{
      const source=await signedReportPdfSource(runner.manager,job.report_id,job.snapshot_id,job.amendment_sequence);
      if(cosEligibility(effectiveSignedPdfOccurrences(source))==='transported'){
       const requirements=cosIdentifierRequirements(source,job.canonical_mapping,job.settings);
       await reconcileTransmissionReview(runner.manager,job.report_id,{integration:'cos',deliveryId:job.id,
        amendmentSequence:job.amendment_sequence,configurationRevision:job.configuration_revision,
        mappingId:job.mapping_id,mappingRevision:job.mapping_revision,mappingSha256:job.mapping_sha256,...requirements});
       if(requirements.missing.length)throw new CosFinding(requirements.missing[0]!);
      }
      const pdf=await renderSignedReportPdf(source,job.pdf_language);
      payload=buildCosPayload(source,job.canonical_mapping,job.settings,pdf,job.id);
      await runner.manager.query(`insert into clinical.cos_payload(delivery_id,report_id,bundle,pdf,payload_sha256,pdf_sha256,contact,contact_sha256) values($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8)`,[job.id,job.report_id,JSON.stringify(payload.bundle),pdf,payload.payloadSha256,payload.pdfSha256,JSON.stringify(payload.contact),payload.contactSha256]);
      }
      attempt=randomUUID();
      await runner.manager.query(`insert into clinical.cos_attempt(id,delivery_id,report_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,payload_sha256,pdf_sha256,worker_id,recovery_command_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[attempt,job.id,job.report_id,job.configuration_revision,job.mapping_id,job.mapping_revision,job.mapping_sha256,payload.payloadSha256,payload.pdfSha256,worker,recovery??null]);
      await event(runner.manager,job,worker,'uncertain','inFlight',attempt);
     }catch(error){
      if(error instanceof CosFinding||error instanceof SignedPdfError||error instanceof Error&&'getResponse' in error){
       await event(runner.manager,job,worker,error instanceof CosFinding?error.state:'failed',error instanceof CosFinding?error.code:error instanceof SignedPdfError?'pdfUnavailable':'versionUnavailable');payload=undefined;
      }else throw error;
     }
    }
    await runner.commitTransaction();
   }catch(error){await runner.rollbackTransaction();throw error;}
   if(!job)continue;
   processed++;
   if(!payload||!attempt)continue;
   try{
    const contact=await receiver.contact(job.report_id,payload);
    const expectedContact=`${payload.contact.encounter.system}|${payload.contact.encounter.value}`;
    if(contact.kind!=='simulator-stored'||contact.contactKey!==expectedContact)throw new Error('Unproven contact');
    await database.transaction(manager=>event(manager,job!,worker,'uncertain','contactStored',attempt,{kind:contact.kind,contactKeySha256:payload!.contactSha256}));
    const note=await receiver.note(job.report_id,job.id,payload);
    if(note.kind!=='simulator-stored'||note.contactKey!==expectedContact||!note.receiptId||note.payloadSha256!==payload.payloadSha256||note.pdfSha256!==payload.pdfSha256)throw new Error('Unproven final storage');
    await database.transaction(manager=>event(manager,job!,worker,'confirmed',null,attempt,{kind:note.kind,receiptId:note.receiptId,payloadSha256:note.payloadSha256,pdfSha256:note.pdfSha256}));
   }catch(error){
    await database.transaction(manager=>event(manager,job!,worker,error instanceof CosRejected?'failed':'uncertain',error instanceof CosRejected?error.code:'outcomeUnknown',attempt));
   }
  }finally{
   try{if(held)await runner.query('select pg_advisory_unlock(731013,hashtext($1))',[candidate.report_id]);}finally{await runner.release();}
  }
 }
 return {processed};
}
