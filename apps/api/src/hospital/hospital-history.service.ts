import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import {DataSource,type EntityManager} from 'typeorm';
import type {ClinicianSession,HospitalHistoryEntry,HospitalHistoryEvent,HospitalHistoryPage} from '@open-triage/contracts';
import {ClinicianSessionService} from '../sessions/clinician-session.service.js';
import {reviewScope,reviewTargetScope,reviewIdentifying} from '../review/review-scope.js';
import {cosRetryStatus} from './cos-automatic-retry.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
/** Never release arbitrary error strings or remote acknowledgement bodies. */
export function historyFinding(value:unknown):string|null {
 return typeof value==='string'&&['outage','outcomeUnknown','inFlight','contactStored','credential','patientIdentifier','patientNamespace','staff','careUnit','encounter','mapping','payload','pdf','configuration','configurationChanged','expired','sandboxVerification','missingPatientIdentifier','missingStaff','missingCareUnit','missingEncounter','noPatientContact','notPatientTransport','unknownDisposition','sourceUnavailable','ambulanceCareUnit','pdfMapping','clinicalValue','simulatorLimit','eligibility','noContact','liveUnverified','pdfUnavailable','versionUnavailable','reconciledNotStored','reconciliationUnresolved','reconciliationUnsupported'].includes(value)?value:null;
}
export function historyAcknowledgement(value:unknown):HospitalHistoryEvent['acknowledgement'] {
 const input=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const result:HospitalHistoryEvent['acknowledgement']={};
 if(typeof input.receiptId==='string'&&UUID.test(input.receiptId))result.receiptId=input.receiptId;
 for(const key of ['payloadSha256','pdfSha256'] as const)if(typeof input[key]==='string'&&HASH.test(input[key] as string))result[key]=input[key] as string;
 const headers=input.headers&&typeof input.headers==='object'?input.headers as Record<string,unknown>:{};
 if(headers['x-pass']==='true'||headers['x-pass']==='false')result.pass=headers['x-pass']==='true';
 if(typeof headers['x-errors']==='string'&&/^\d{1,6}$/.test(headers['x-errors']))result.errors=Number(headers['x-errors']);
 return result;
}
/** Metadata lives within the existing agency boundary; status never grants clinical access. */
@Injectable()
export class HospitalHistoryService {
 constructor(@InjectDataSource()private readonly database:DataSource,private readonly sessions:ClinicianSessionService){}
 async reviewLink(manager:EntityManager,session:ClinicianSession,reportId:string,dataset:'real'|'synthetic') {
  if(session.installationOwner||session.installationSuperadmin)return undefined;
  let scope;try{scope=await reviewTargetScope(manager,reviewScope(session),reportId,'report');}catch{return undefined;}
  const [row]=await manager.query<Array<{id:string;documenting_user_id:string;item_id:string}>>(`select r.id,r.documenting_user_id,i.id item_id from clinical.report r join clinical.review_item i on i.report_id=r.id
   where r.id=$1 and r.organization_id=$2 and r.synthetic=$3 and (r.expires_at is null or r.expires_at>clock_timestamp())
    and ($4 or r.documenting_user_id=$5) and i.kind in ('cos-delivery-failed','missing-transmission-identifiers')
   order by i.active_match desc,i.updated_at desc,i.id limit 1`,[reportId,scope.organizationId,dataset==='synthetic',scope.reports==='all',scope.userId]);
  return row&&reviewIdentifying(scope,row.documenting_user_id)?{reportId,itemId:row.item_id,dataset}:undefined;
 }
 async link(token:string,reportId:string,dataset:unknown){
  if(!UUID.test(reportId)||(dataset!=='real'&&dataset!=='synthetic'))throw new BadRequestException({code:'audit.invalidQuery'});
  return this.database.transaction('REPEATABLE READ',async manager=>{
   const session=await this.sessions.get(token,new Date(),false,manager);
   const link=await this.reviewLink(manager,session,reportId,dataset);if(!link)throw new NotFoundException();return link;
  });
 }
 async list(token:string,input:Record<string,unknown>):Promise<HospitalHistoryPage>{
  if(Object.keys(input).some(key=>!['dataset','destination','reportId','cursor'].includes(key))||!['real','synthetic'].includes(String(input.dataset))||input.destination!==undefined&&!['eps','cos'].includes(String(input.destination))||input.reportId!==undefined&&(typeof input.reportId!=='string'||!UUID.test(input.reportId)))throw new BadRequestException({code:'audit.invalidQuery'});
  let cursor:{time:string;id:string}|undefined;
  if(input.cursor!==undefined)try{if(typeof input.cursor!=='string'||input.cursor.length>256)throw new Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());if(!cursor||!UUID.test(cursor.id)||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(cursor.time)||!Number.isFinite(Date.parse(cursor.time)))throw new Error();}catch{throw new BadRequestException({code:'audit.invalidQuery'});}
  return this.database.transaction('REPEATABLE READ',async manager=>{
   const session=await this.sessions.get(token,new Date(),false,manager),capabilities=new Set(session.capabilities??[]);
   if(!capabilities.has('settings:read')&&!capabilities.has('audit:read'))throw new ForbiddenException();
   // Identifying audit grants are never inferred from installation or settings authority.
   const identifyingAudit=capabilities.has('audit:read')&&capabilities.has('audit:identifying')&&!session.installationOwner&&!session.installationSuperadmin;
   if(identifyingAudit)await manager.query("select set_config('open_triage.audit_organization_id',$1,true)",[session.organization.id]);
   const [configurationGroup]=await manager.query<Array<{id:string}>>('select app_identity.organization_group($1) id',[session.organization.id]);
   const parameters=[session.organization.id,input.dataset==='synthetic',input.destination??null,input.reportId??null,cursor?.time??null,cursor?.id??null,identifyingAudit,capabilities.has('settings:read')?configurationGroup?.id??session.organization.id:session.organization.id];
   type Row={id:string;kind:HospitalHistoryEntry['kind'];integration:'cos'|'eps';report_id:string|null;snapshot_id:string|null;amendment_sequence:number|null;synthetic:boolean|null;destination:string;configuration_revision:string;mapping_id:string;mapping_revision:number;mapping_sha256:string;created_at:Date;updated_at:Date;state:string;attempt_count:number;lineage_parent_id:string|null;payload_sha256:string|null};
   // Every branch selects metadata columns explicitly. Never select payload/bundle/source JSON.
   const rows=await manager.query<Row[]>(`with history as (
    select d.id,'cos'::text kind,'cos'::text integration,d.report_id,d.snapshot_id,d.amendment_sequence,r.synthetic,'cos'::text destination,d.configuration_revision,d.mapping_id,d.mapping_revision,d.mapping_sha256,d.created_at,d.updated_at,d.state,(select count(*)::integer from clinical.cos_attempt a where a.delivery_id=d.id) attempt_count,d.lineage_parent_id,p.payload_sha256
    from clinical.cos_delivery d join clinical.report r on r.id=d.report_id left join clinical.cos_payload p on p.delivery_id=d.id where r.organization_id=$1 and r.synthetic=$2 and (r.expires_at is null or r.expires_at>clock_timestamp())
    union all
    select s.id,'eps','eps',s.report_id,s.snapshot_id,s.amendment_sequence,r.synthetic,'eps',s.configuration_revision,s.mapping_id,s.mapping_revision,s.mapping_sha256,s.created_at,coalesce(result.created_at,a.created_at,s.created_at),case when a.id is null then 'prepared' else coalesce(result.state,'unknown') end,case when a.id is null then 0 else 1 end,s.lineage_parent_id,s.payload_sha256
    from clinical.eps_submission s join clinical.report r on r.id=s.report_id left join clinical.eps_submission_attempt a on a.submission_id=s.id left join clinical.eps_submission_result result on result.attempt_id=a.id where r.organization_id=$1 and r.synthetic=$2 and (r.expires_at is null or r.expires_at>clock_timestamp())
    union all
    select e.id,'import','eps',e.report_id,null::uuid,null::integer,r.synthetic,'eps',(e.evidence->>'configurationRevision')::bigint,e.evidence->'mapping'->'definition'->>'id',(e.evidence->'mapping'->'definition'->>'revision')::integer,e.evidence->'mapping'->>'sha256',e.created_at,e.created_at,e.decision,0,null::uuid,null::text
    from clinical.eps_import e join clinical.report r on r.id=e.report_id where r.organization_id=$1 and r.synthetic=$2 and (r.expires_at is null or r.expires_at>clock_timestamp())
    union all
    select e.audit_id,'configuration',e.details->>'integration',null::uuid,null::uuid,null::integer,null::boolean,e.details->>'integration',(e.details->>'revision')::bigint,e.details->>'mappingId',(v.mapping->'definition'->>'revision')::integer,e.content_sha256,e.occurred_at,e.occurred_at,e.action,0,null::uuid,null::text
    from app_identity.configuration_event e left join lateral (select canonical_mapping mapping from app_identity.hospital_eps_version where group_id=e.organization_id and revision=(e.details->>'revision')::bigint and e.details->>'integration'='eps' union all select canonical_mapping from app_identity.hospital_cos_version where group_id=e.organization_id and revision=(e.details->>'revision')::bigint and e.details->>'integration'='cos') v on true where e.organization_id=$8 and e.action like 'hospital.%' and e.details->>'integration' in ('eps','cos')
    union all
    select e.audit_id,'read','eps',e.report_id,null::uuid,null::integer,e.synthetic,'eps',(e.integration_provenance->>'configurationRevision')::bigint,e.integration_provenance->>'mappingId',(e.integration_provenance->>'mappingRevision')::integer,e.integration_provenance->>'mappingSha256',e.occurred_at,e.occurred_at,e.action,0,null::uuid,null::text
    from clinical_audit.patient_access_event e where $7 and e.organization_id=$1 and e.synthetic=$2 and e.action='eps.read'
   ) select * from history where ($3::text is null or integration=$3) and ($4::uuid is null or report_id=$4) and ($5::timestamptz is null or (created_at,id)<($5::timestamptz,$6::uuid)) order by created_at desc,id desc limit 51`,parameters);
   const entries:HospitalHistoryEntry[]=[];
   for(const row of rows.slice(0,50)){
    const events=await this.events(manager,row.kind,row.id);
    const [cosMode]=row.kind==='cos'?await manager.query<Array<{mode:string}>>("select v.settings->>'mode' mode from clinical.cos_delivery d join app_identity.hospital_cos_version v on v.group_id=d.group_id and v.revision=d.configuration_revision where d.id=$1",[row.id]):[];
    const retry=row.kind==='cos'?await cosRetryStatus(manager,row.id):undefined;
    const review=row.report_id?await this.reviewLink(manager,session,row.report_id,input.dataset as 'real'|'synthetic'):undefined;
    entries.push({id:row.id,kind:row.kind,integration:row.integration,reportId:row.report_id,snapshotId:row.snapshot_id,amendmentSequence:row.amendment_sequence,dataset:row.synthetic===null?null:row.synthetic?'synthetic':'real',destination:row.destination,verification:row.integration==='eps'?'eps':cosMode?.mode==='simulator'?'simulator':'unverified',mapping:{id:row.mapping_id,revision:Number(row.mapping_revision),sha256:row.mapping_sha256,configurationRevision:Number(row.configuration_revision)},createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),state:row.state,attemptCount:row.attempt_count,lineageParentId:row.lineage_parent_id,payloadSha256:row.payload_sha256,events:events.slice(0,100),eventsTruncated:events.length>100,...(retry?{retry:{nextDue:retry.nextDue,paused:retry.paused,exhausted:retry.exhausted}}:{}),...(review?{review}:{})});
   }
   if(identifyingAudit)await manager.query(`insert into clinical_audit.audit_read_event(organization_id,actor_id,category,from_time,to_time,returned_count,queried_categories,uuid_filter) values($1,$2,'patient',clock_timestamp()-interval '31 days',clock_timestamp(),$3,array['patient'],$4)`,[session.organization.id,session.user.id,entries.length,input.reportId??null]);
   const last=rows.slice(0,50).at(-1);
   return {entries,nextCursor:rows.length>50&&last?Buffer.from(JSON.stringify({time:last.created_at.toISOString(),id:last.id})).toString('base64url'):null};
  });
 }
 private async events(manager:EntityManager,kind:HospitalHistoryEntry['kind'],id:string):Promise<HospitalHistoryEvent[]>{
  type Event={id:string;created_at:Date;actor_id:string|null;worker_id?:string;state:string;finding:string|null;attempt_id:string|null;evidence:unknown;action:string};
  let rows:Event[]=[];
  if(kind==='cos')rows=await manager.query<Event[]>(`select e.id,e.created_at,coalesce(e.actor_id,c.actor_id) actor_id,e.worker_id,e.state,e.finding,e.attempt_id,jsonb_build_object('receiptId',e.evidence->'receiptId','payloadSha256',e.evidence->'payloadSha256','pdfSha256',e.evidence->'pdfSha256') evidence,
    case when e.evidence->>'action'='reconcile' then 'cos.reconcile' when c.automatic_ordinal is not null then 'cos.automatic-retry' when c.id is not null then 'cos.manual-retry' else 'cos.delivery' end action from clinical.cos_delivery_event e left join clinical.cos_attempt a on a.id=e.attempt_id left join clinical.cos_recovery_command c on c.id=a.recovery_command_id where e.delivery_id=$1 order by e.created_at desc,e.id desc limit 101`,[id]);
  else if(kind==='eps')rows=await manager.query<Event[]>(`select s.id,s.created_at,s.prepared_by actor_id,'prepared'::text state,null::text finding,null::uuid attempt_id,'{}'::jsonb evidence,'eps.preview'::text action from clinical.eps_submission s where s.id=$1
   union all select a.id,a.created_at,a.actor_id,'unknown',null::text,a.id,'{}'::jsonb,'eps.submit' from clinical.eps_submission_attempt a where a.submission_id=$1
   union all select a.id,r.created_at,a.actor_id,r.state,null::text,a.id,jsonb_build_object('headers',jsonb_build_object('x-pass',r.evidence->'headers'->'x-pass','x-errors',r.evidence->'headers'->'x-errors')),'eps.result' from clinical.eps_submission_attempt a join clinical.eps_submission_result r on r.attempt_id=a.id where a.submission_id=$1 order by created_at desc`,[id]);
  else if(kind==='configuration')rows=await manager.query<Event[]>(`select audit_id id,occurred_at created_at,actor_id,result state,null::text finding,null::uuid attempt_id,'{}'::jsonb evidence,case when details->>'mappingOperation'='import' then 'hospital.mapping_import' else action end action from app_identity.configuration_event where audit_id=$1`,[id]);
  else if(kind==='import')rows=await manager.query<Event[]>(`select id,created_at,author_id actor_id,decision state,null::text finding,null::uuid attempt_id,'{}'::jsonb evidence,'eps.import'::text action from clinical.eps_import where id=$1`,[id]);
  else if(kind==='read')rows=await manager.query<Event[]>(`select audit_id id,occurred_at created_at,actor_id,'authorized'::text state,null::text finding,null::uuid attempt_id,'{}'::jsonb evidence,action from clinical_audit.patient_access_event where audit_id=$1`,[id]);
  return rows.map(row=>({id:row.id,occurredAt:row.created_at.toISOString(),actorId:row.actor_id,actorKind:row.worker_id?'worker':row.actor_id?'human':'worker',...(row.worker_id?{workerId:row.worker_id}:{}),state:row.state,action:row.action,finding:historyFinding(row.finding),attemptId:row.attempt_id,acknowledgement:historyAcknowledgement(row.evidence)}));
 }
}
