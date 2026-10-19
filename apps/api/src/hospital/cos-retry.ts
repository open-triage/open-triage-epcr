import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { RetryCosReviewCommand } from '@open-triage/contracts';
import type { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { reviewIdentifying, reviewScope, reviewTargetScope } from '../review/review-scope.js';
import { commandSha256 } from '../reports/draft-report.validation.js';
import { cosRetryable,reconcileCosFailure } from './cos-recovery-review.js';
/** Appends a durable command only. The ordinary worker owns every receiver effect. */
export async function retryCosReview(database:DataSource,sessions:ClinicianSessionService,token:string,itemId:string,input:RetryCosReviewCommand,csrfToken?:string){
 const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
 if(!input||!uuid(input.commandId)||!uuid(input.deliveryId)||!['real','synthetic'].includes(input.dataset)||
 ![input.expectedVersion,input.amendmentSequence,input.configurationRevision,input.stateRevision].every(n=>Number.isSafeInteger(n)&&n>=0))throw new BadRequestException('Invalid COS recovery command');
 const digest=commandSha256({...input,itemId});
 await database.transaction(async manager=>{
  await sessions.lockPersonalAuthenticationContext(manager,null,token);
  await sessions.assertCsrf(token,csrfToken,manager);
  const scope=await reviewTargetScope(manager,reviewScope(await sessions.get(token,new Date(),false,manager)),itemId,'item');
  const [candidate]=await manager.query<Array<{report_id:string}>>('select report_id from clinical.review_item where id=$1 and organization_id=$2',[itemId,scope.organizationId]);
  if(!candidate)throw new NotFoundException();
  // Same advisory namespace and lock order as the durable worker; never wait holding a report/item lock.
  const [lock]=await manager.query<Array<{locked:boolean}>>('select pg_try_advisory_xact_lock(731013,hashtext($1)) locked',[candidate.report_id]);
  if(!lock?.locked)throw new ConflictException('COS delivery is in progress');
  const [report]=await manager.query<Array<{documenting_user_id:string;group_id:string}>>(`select documenting_user_id,app_identity.organization_group(organization_id) group_id from clinical.report where id=$1 and organization_id=$2 and synthetic=$3 and status='signed' and (expires_at is null or expires_at>clock_timestamp()) and ($4::boolean or documenting_user_id=$5) for update`,[candidate.report_id,scope.organizationId,input.dataset==='synthetic',scope.reports==='all',scope.userId]);
  if(!report)throw new NotFoundException();
  if(!reviewIdentifying(scope,report.documenting_user_id))throw new ForbiddenException('Identifying report access is required');
  await manager.query('select id from app_identity.organization where id=$1 for share',[scope.organizationId]);
  const [item]=await manager.query<Array<{version:string;kind:string;assignee_id:string|null;independent_review:boolean;active_match:boolean}>>(`select i.version,i.kind,i.assignee_id,i.active_match,coalesce(route.independent_review,false) independent_review from clinical.review_item i left join clinical.review_criterion_route route on route.organization_id=i.organization_id and route.criterion_id=i.criterion_id where i.id=$1 and i.report_id=$2 for update of i`,[itemId,candidate.report_id]);
  if(!item||item.kind!=='cos-delivery-failed')throw new NotFoundException();
  if(item.assignee_id!==scope.userId||item.independent_review&&report.documenting_user_id===scope.userId)throw new ForbiddenException('Only the eligible assigned reviewer can retry');
  const [replay]=await manager.query<Array<{command_sha256:string;actor_id:string}>>('select command_sha256,actor_id from clinical.cos_recovery_command where id=$1',[input.commandId]);
  if(replay){if(replay.command_sha256!==digest||replay.actor_id!==scope.userId)throw new ConflictException('Recovery command already used');return;}
  if(Number(item.version)!==input.expectedVersion||!item.active_match)throw new ConflictException('Review item changed');
  const [state]=await manager.query<Array<{active_revision:string|null;state_revision:string}>>('select active_revision,state_revision from app_identity.hospital_cos_state where group_id=$1 for share',[report.group_id]);
  if(Number(state?.active_revision)!==input.configurationRevision||Number(state?.state_revision)!==input.stateRevision)throw new ConflictException('COS configuration changed');
  const [delivery]=await manager.query<Array<{id:string;state:string;finding:string|null;configuration_revision:string;amendment_sequence:number;mapping_sha256:string}>>(`select * from clinical.cos_delivery where report_id=$1 order by amendment_sequence desc,created_at desc,id desc limit 1 for update`,[candidate.report_id]);
  const [barrier]=await manager.query<Array<{blocked:boolean;newer:boolean}>>(`select exists(select 1 from clinical.cos_delivery where report_id=$1 and state='uncertain') blocked, coalesce((select max(sequence) from clinical.amendment where report_id=$1),0)>$2 newer`,[candidate.report_id,input.amendmentSequence]);
  if(!delivery||delivery.id!==input.deliveryId||delivery.amendment_sequence!==input.amendmentSequence||Number(delivery.configuration_revision)!==input.configurationRevision||!cosRetryable(delivery.state,delivery.finding)||barrier?.blocked||barrier?.newer)throw new ConflictException('COS delivery cannot safely be retried');
  await manager.query(`insert into clinical.cos_recovery_command(id,command_sha256,report_id,item_id,delivery_id,actor_id,item_version,amendment_sequence,configuration_revision,mapping_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.commandId,digest,candidate.report_id,itemId,delivery.id,scope.userId,input.expectedVersion,delivery.amendment_sequence,delivery.configuration_revision,delivery.mapping_sha256]);
  await manager.query('update clinical.cos_retry_state set next_due=null where delivery_id=$1',[delivery.id]);
  await manager.query("update clinical.cos_delivery set state='pending',finding=null,updated_at=clock_timestamp() where id=$1",[delivery.id]);
  await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,evidence) values($1,$2,$3,'pending',$4::jsonb)`,[delivery.id,candidate.report_id,scope.userId,JSON.stringify({commandId:input.commandId,action:'manual-retry',amendmentSequence:delivery.amendment_sequence})]);
  await reconcileCosFailure(manager,candidate.report_id);
 });
}
