import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { SchedulesService } from '../dist/schedules/schedules.service.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
integration('weekly schedules persist immutable versions, group scope, agency selection, time zones and prospective activation',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();await client.query('begin');
 try {
  const root=SYNTHETIC_DEMO_FIXTURE.organizationId,user=SYNTHETIC_DEMO_FIXTURE.userId,child=randomUUID(),foreign=randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone,parent_organization_id) values($1,'Schedule child','Pacific/Auckland',$2),($3,'Schedule outside','UTC',null)`,[child,root,foreign]);
  const ownUnit=randomUUID(),childUnit=randomUUID();
  await client.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign,active) values($1,$2,'Schedule root unit','SCHED-ROOT',true),($3,$4,'Schedule child unit','SCHED-CHILD',true)`,[ownUnit,root,childUnit,child]);
  let scope=root,clock=null,seq=0;
  const manager={query:async(sql,params)=>{
   if(sql==='select clock_timestamp() as now'&&clock)return [{now:new Date(clock)}];
   return (await client.query(sql,params)).rows;
  }};
  const database={manager,...manager,transaction:async work=>{const point=`schedule_${++seq}`;await client.query(`savepoint ${point}`);try{const result=await work(manager);await client.query(`release savepoint ${point}`);return result;}catch(error){await client.query(`rollback to savepoint ${point}`);throw error;}}};
  const service=new SchedulesService(database,{requireCapability:async(_token,key,transaction)=>{assert.ok(['settings:read','settings:write'].includes(key));if(key==='settings:write')assert.equal(transaction,manager);return {organization:{id:scope},user:{id:user}};}});
  await client.query('set local role open_triage_api_runtime');
  const missing=await service.getPreview('token',ownUnit);assert.equal(missing.state,'missing');assert.equal(missing.selectionRevision,0);
  const blank=await service.save('token',null,{name:'Deliberately blank',breakpoints:[]});
  assert.equal((await service.select('token',ownUnit,{scheduleId:blank.id,expectedRevision:0})).state,'blank');
  await assert.rejects(service.select('token',ownUnit,{scheduleId:blank.id,expectedRevision:0}),/changed/);
  const points=Array.from({length:7},(_,i)=>({weekday:i+1,time:'07:00',graceMinutes:15}));
  const weekly=await service.save('token',null,{name:'Daily handover',breakpoints:points});
  const rootPreview=await service.select('token',ownUnit,{scheduleId:weekly.id,expectedRevision:1});
  assert.equal(rootPreview.state,'scheduled');assert.equal(rootPreview.activeCheckpoint,null,'first authoring cannot invent a past shift');assert.ok(rootPreview.nextCheckpoint);
  scope=child;assert.ok((await service.list('token')).items.some(item=>item.id===weekly.id));
  const childPreview=await service.select('token',childUnit,{scheduleId:weekly.id,expectedRevision:0});
  assert.equal(childPreview.timeZone,'Pacific/Auckland');assert.notEqual(rootPreview.nextCheckpoint.at,childPreview.nextCheckpoint.at);
  await assert.rejects(service.getPreview('token',ownUnit),/not found/);
  scope=foreign;assert.equal((await service.list('token')).items.length,0);
  await assert.rejects(service.save('token',weekly.id,{name:'Forged',breakpoints:points,expectedRevision:1}),/not found/);
  await client.query('reset role');
  const otherUnit=randomUUID();await client.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Other','SCHED-OTHER')`,[otherUnit,foreign]);
  await assert.rejects(service.select('token',otherUnit,{scheduleId:weekly.id,expectedRevision:0}),/not found/);
  await client.query('savepoint forged');await assert.rejects(client.query(`insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,1,$3,clock_timestamp(),$4)`,[foreign,otherUnit,weekly.id,user]),/another agency group/);await client.query('rollback to savepoint forged');
  await client.query('set local role open_triage_api_runtime');
  scope=root;
  clock=new Date(Date.parse(rootPreview.nextCheckpoint.at)+12*60*60_000).toISOString();
  const beforeEdit=await service.getPreview('token',ownUnit);assert.ok(beforeEdit.activeCheckpoint);
  scope=child;const childPending=await service.select('token',childUnit,{scheduleId:blank.id,expectedRevision:1});assert.ok(childPending.pending);scope=root;
  const draft={name:'Later handover',breakpoints:points.map(point=>({...point,time:'09:00'})),expectedRevision:1};
  const editPreview=await service.previewSave('token',weekly.id,draft);
  await assert.rejects(service.save('another session',weekly.id,{...draft,previewToken:editPreview.previewToken}),/preview/i);
  await assert.rejects(service.save('token',weekly.id,{...draft,name:'Changed draft',previewToken:editPreview.previewToken}),/preview/i);
  const changed=await service.save('token',weekly.id,{...draft,previewToken:editPreview.previewToken});
  assert.equal(changed.versions.at(-1).effectiveAt,editPreview.effectiveAt);
  assert.equal(changed.versions.length,2);const effective=Date.parse(changed.versions[1].effectiveAt);
  assert.ok(effective>=Math.max(Date.parse(beforeEdit.nextCheckpoint.at),Date.parse(childPending.pending.effectiveAt)),'pending reselect retains the still-active agency zone');
  const afterEdit=await service.getPreview('token',ownUnit);assert.deepEqual(afterEdit.activeCheckpoint,beforeEdit.activeCheckpoint);assert.equal(afterEdit.activeVersion.revision,1);assert.equal(afterEdit.nextVersion.revision,2);
  if(Date.parse(beforeEdit.nextCheckpoint.at)<effective)assert.equal(afterEdit.nextCheckpoint.at,beforeEdit.nextCheckpoint.at);else assert.ok(Date.parse(afterEdit.nextCheckpoint.at)>=effective);
  await assert.rejects(service.save('token',weekly.id,{name:'Pending',breakpoints:[],expectedRevision:2}),/pending/);
  const persisted=(await client.query('select details from app_identity.unit_schedule_evaluation where unit_id=$1',[ownUnit])).rows[0].details;
  assert.equal(persisted.timeZone,rootPreview.timeZone);assert.equal(persisted.nextCheckpoint.at,afterEdit.nextCheckpoint.at);assert.ok(persisted.evaluatedAt);
  for(const table of ['weekly_schedule_version','unit_schedule_selection']) {
   await client.query('savepoint immutable');await assert.rejects(client.query(`delete from app_identity.${table}`),/permission|append|update|delete|immutable/i);await client.query('rollback to savepoint immutable');
  }
  // Advance only the service's authoritative clock; no sleep and no historical SQL authoring.
  clock=new Date(effective+60_000).toISOString();
  const active=await service.getPreview('token',ownUnit);assert.equal(active.activeCheckpoint.revision,1,'old effective shift survives edit until a new event actually occurs');
  // Cross an old-zone checkpoint without refreshing before changing zone. The old snapshot is stale.
  clock=new Date(Date.parse(active.nextCheckpoint.at)+60_000).toISOString();
  const beforeZone=active.nextCheckpoint;
  await client.query('reset role');
  await client.query("update app_identity.organization set deployment_timezone='Pacific/Honolulu' where id=$1",[root]);
  await client.query('set local role open_triage_api_runtime');
  const afterZone=await service.getPreview('token',ownUnit);assert.equal(afterZone.timeZone,'Pacific/Honolulu');assert.deepEqual(afterZone.activeCheckpoint,beforeZone);
  clock=new Date(Date.parse(clock)+60_000).toISOString();assert.deepEqual((await service.getPreview('token',ownUnit)).activeCheckpoint,beforeZone);
  const selectionDraft={scheduleId:blank.id,expectedRevision:2};
  const selectionPreview=await service.previewSelection('token',ownUnit,selectionDraft);
  const switched=await service.select('token',ownUnit,{...selectionDraft,previewToken:selectionPreview.previewToken});
  assert.equal(switched.pending.effectiveAt,selectionPreview.effectiveAt);assert.equal(switched.state,'scheduled');assert.ok(switched.pending);
  clock=new Date(Date.parse(switched.pending.effectiveAt)+1).toISOString();assert.equal((await service.getPreview('token',ownUnit)).state,'blank');
  await client.query(`with created as (
    insert into app_identity.weekly_schedule(id,group_id,name) select gen_random_uuid(),$1,'Capacity fixture '||entry
    from generate_series(1,500-(select count(*)::integer from app_identity.weekly_schedule where group_id=$1)) entry returning id
  ) insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id) select id,1,clock_timestamp(),'[]'::jsonb,$2 from created`,[root,user]);
  await assert.rejects(service.save('token',null,{name:'Schedule 501',breakpoints:[]}),/500-schedule limit/);
  assert.equal((await service.list('token')).items.length,500,'a rejected creation preserves a readable bounded directory');
  const grants=(await client.query(`select table_name,
    has_table_privilege('open_triage_api_runtime','app_identity.'||table_name,'UPDATE') as update,
    has_table_privilege('open_triage_api_runtime','app_identity.'||table_name,'DELETE') as delete
    from unnest(array['weekly_schedule','weekly_schedule_version','unit_schedule_selection','unit_schedule_evaluation']) table_name`)).rows;
  for(const grant of grants){assert.equal(grant.delete,false);assert.equal(grant.update,['weekly_schedule','unit_schedule_evaluation'].includes(grant.table_name));}
 }finally{await client.query('rollback');await client.end();}
});

integration('independent runtime-role transactions reject concurrent saves and stale effective previews around DST and zone changes',async()=>{
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 const scheduleId=randomUUID(),unitId=randomUUID(),root=SYNTHETIC_DEMO_FIXTURE.organizationId,user=SYNTHETIC_DEMO_FIXTURE.userId;
 const clients=[new pg.Client({connectionString:process.env.DATABASE_URL}),new pg.Client({connectionString:process.env.DATABASE_URL})];
 let clock='2026-10-25T00:29:00.000Z';
 try {
  await admin.query(`insert into app_identity.weekly_schedule(id,group_id,name) values($1,$2,'Concurrent schedule')`,[scheduleId,root]);
  await admin.query(`insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id) values($1,1,'2020-01-01', $2::jsonb,$3)`,[scheduleId,JSON.stringify([{weekday:7,time:'02:30',graceMinutes:0}]),user]);
  await admin.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Concurrent unit',$3)`,[unitId,root,'S-'+unitId]);
  await admin.query(`insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,1,$3,'2020-01-01',$4)`,[root,unitId,scheduleId,user]);
  await Promise.all(clients.map(client=>client.connect()));
  const services=clients.map(client=>{
   const manager={query:async(sql,params)=>sql==='select clock_timestamp() as now'?[{now:new Date(clock)}]:(await client.query(sql,params)).rows};
   const database={manager,...manager,transaction:async work=>{await client.query('begin');await client.query('set local role open_triage_api_runtime');try{const result=await work(manager);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}}};
   return new SchedulesService(database,{requireCapability:async()=>({organization:{id:root},user:{id:user}})});
  });
  // The seeded agency uses Stockholm; the fold's first occurrence is authoritative.
  const zone=(await admin.query('select deployment_timezone from app_identity.organization where id=$1',[root])).rows[0].deployment_timezone;
  await admin.query("update app_identity.organization set deployment_timezone='Europe/Stockholm' where id=$1",[root]);
  try {
   const initialDraft={name:'New immediate schedule',breakpoints:[{weekday:7,time:'02:30',graceMinutes:0}]};
   const immediate=await services[0].previewSave('token',null,initialDraft);
   clock='2026-10-25T00:30:00.000Z';
   await assert.rejects(services[0].save('token',null,{...initialDraft,previewToken:immediate.previewToken}),/preview/i,'an immediate preview cannot turn an elapsed checkpoint into a historical handover');
   clock='2026-10-25T00:35:00.000Z';
   await assert.rejects(services[0].save('token',null,{...initialDraft,previewToken:immediate.previewToken}),/preview/i,'expired previews require another server evaluation');
   clock='2026-10-25T00:29:00.000Z';
   const [payload]=immediate.previewToken.split('.');
   const forged=payload+'.'+createHmac('sha256','token').update('open-triage-schedule-preview-v1\0'+payload).digest('base64url');
   await assert.rejects(services[0].save('token',null,{...initialDraft,previewToken:forged}),/preview/i,'knowing the session token does not let a client sign its own preview');
   const draft={name:'Concurrent change',breakpoints:[{weekday:7,time:'03:30',graceMinutes:0}],expectedRevision:1};
   const previews=await Promise.all(services.map(service=>service.previewSave('token',scheduleId,draft)));
   assert.equal(previews[0].effectiveAt,'2026-10-25T00:30:00.000Z');
   clock='2026-10-25T00:30:00.000Z';
   await assert.rejects(services[0].save('token',scheduleId,{...draft,previewToken:previews[0].previewToken}),/preview/i);
   clock='2026-10-25T00:29:00.000Z';
   const results=await Promise.allSettled(services.map((service,index)=>service.save('token',scheduleId,{...draft,previewToken:previews[index].previewToken})));
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   assert.match(results.find(result=>result.status==='rejected').reason.message,/changed|pending/i);
   assert.equal((await admin.query('select count(*)::int as count from app_identity.weekly_schedule_version where schedule_id=$1',[scheduleId])).rows[0].count,2);
   const selection={scheduleId:null,expectedRevision:1};
   const selectionPreview=await services[0].previewSelection('token',unitId,selection);
   // A zone writer holds the agency row while the save starts. The save must wait,
   // then re-read the committed zone and reject its previously valid preview.
   await admin.query('begin');
   await admin.query('select id from app_identity.organization where id=$1 for update',[root]);
   const waiting=services[0].select('token',unitId,{...selection,previewToken:selectionPreview.previewToken}).then(()=>({saved:true}),error=>({error}));
   let blocked=false;
   for(let attempt=0;attempt<40;attempt++){
    blocked=(await admin.query('select exists(select 1 from pg_locks where pid=$1 and not granted) as blocked',[clients[0].processID])).rows[0].blocked;
    if(blocked)break;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   assert.equal(blocked,true,'schedule selection must wait for concurrent agency zone writes');
   await admin.query("update app_identity.organization set deployment_timezone='UTC' where id=$1",[root]);
   await admin.query('commit');
   const rejected=await waiting;assert.match(rejected.error.message,/preview/i);
   await admin.query("update app_identity.organization set deployment_timezone='Europe/Stockholm' where id=$1",[root]);
   const fresh=await Promise.all(services.map(service=>service.previewSelection('token',unitId,selection)));
   const selections=await Promise.allSettled(services.map((service,index)=>service.select('token',unitId,{...selection,previewToken:fresh[index].previewToken})));
   assert.equal(selections.filter(result=>result.status==='fulfilled').length,1);
   assert.match(selections.find(result=>result.status==='rejected').reason.message,/changed|pending/i);
  } finally {await admin.query('update app_identity.organization set deployment_timezone=$2 where id=$1',[root,zone]);}
 } finally {
  await Promise.all(clients.map(client=>client.end()));
  // Test-only cleanup of our committed fixture permits independent transactions without leaving history behind.
  await admin.query('begin');await admin.query('set local session_replication_role=replica');
  await admin.query('delete from app_identity.unit_schedule_evaluation where unit_id=$1',[unitId]);
  await admin.query('delete from app_identity.unit_schedule_selection where unit_id=$1',[unitId]);
  await admin.query('delete from app_identity.operational_unit where id=$1',[unitId]);
  await admin.query('delete from app_identity.weekly_schedule_version where schedule_id=$1',[scheduleId]);
  await admin.query('delete from app_identity.weekly_schedule where id=$1',[scheduleId]);
  await admin.query('commit');await admin.end();
 }
});
