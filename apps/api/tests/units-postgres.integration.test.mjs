import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { UnitsService } from '../dist/admin/units.service.js';
import { routeDispatchAssignment } from '../dist/dispatch/dispatch-assignment.projection.js';
const integration = process.env.DATABASE_URL ? test : test.skip;
if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
integration('agency unit lifecycle preserves IDs, report ownership/configuration and historical dispatch references', async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();await client.query('begin');
  try {
    const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId, userId=SYNTHETIC_DEMO_FIXTURE.userId;
    const otherAgency=randomUUID();
    await client.query(`insert into app_identity.organization(id,name,deployment_timezone) values($1,'Unit test other agency','UTC')`,[otherAgency]);
    const manager={query:async(sql,params)=>(await client.query(sql,params)).rows};
    let sequence=0;
    const database={...manager,transaction:async work=>{
      const savepoint=`unit_${++sequence}`;await client.query(`savepoint ${savepoint}`);
      try {const result=await work(manager);await client.query(`release savepoint ${savepoint}`);return result;}
      catch(error){await client.query(`rollback to savepoint ${savepoint}`);throw error;}
    }};
    let scope=organizationId;
    const service=new UnitsService(database,{requireCapability:async(_token,key,transaction)=>{
      assert.ok(['settings:read','settings:write'].includes(key));
      if(key==='settings:write') assert.equal(transaction,manager);
      return {organization:{id:scope},user:{id:userId}};
    }});
    const created=await service.save('token',null,{name:'Operational identity',callSign:'UNIT-TEST',active:true});
    assert.equal(created.organizationId,organizationId);assert.equal(created.revision,1);
    await assert.rejects(service.save('token',null,{name:'Duplicate',callSign:'UNIT-TEST',active:true}),/already assigned/);
    scope=otherAgency;
    const other=await service.save('token',null,{name:'Other agency',callSign:'UNIT-TEST',active:true});
    assert.notEqual(other.id,created.id);
    await assert.rejects(service.save('token',created.id,{name:'Forged',callSign:'FORGED',active:false,expectedRevision:1}),/not found/);
    assert.equal((await service.list('token')).items.some(row=>row.id===created.id),false);
    scope=organizationId;
    await manager.query(`insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)`,[organizationId,created.id,userId]);
    const template=JSON.parse(await readFile(new URL('../../../packages/contracts/examples/dispatch/synthetic-assignment-01.json',import.meta.url),'utf8'));
    template.messageId=randomUUID();template.sourceRecordId=`unit-test-${randomUUID()}`;
    template.groups.flatMap(group=>group.instances).flatMap(instance=>instance.elements).find(element=>element.id==='eResponse.14').values[0].value='UNIT-TEST';
    const route=canonical=>routeDispatchAssignment(manager,{organizationId,sourceId:'unit-test',sourceBytes:Buffer.from(JSON.stringify(canonical)),canonical,validationStatus:'applied',findings:[]});
    const assigned=await route(template);assert.equal(assigned.unitId,created.id);
    const renamed=await service.save('token',created.id,{name:'Replacement vehicle',callSign:'RENAMED-UNIT',active:true,expectedRevision:1});
    assert.equal(renamed.id,created.id);
    template.revision=2;template.messageId=randomUUID();
    template.groups.flatMap(group=>group.instances).flatMap(instance=>instance.elements).find(element=>element.id==='eResponse.14').values[0].value='RENAMED-UNIT';
    assert.equal((await route(template)).assignmentId,assigned.assignmentId);
    template.revision=3;template.messageId=randomUUID();template.eventType='cancel';
    template.groups[0].instances[0].elements.push({id:'eTimes.14',values:[{kind:'scalar',occurrenceId:'cancellation-time',value:'2026-08-15T10:14:05-04:00'}]});
    await route(template);
    assert.equal((await manager.query('select unit_id,status from clinical.call_assignment where id=$1',[assigned.assignmentId]))[0].status,'canceled');
    const reportsBefore=await manager.query(`select id,organization_id,documenting_user_id,form_version_id,catalog_release_id from clinical.report where organization_id=$1 order by id`,[organizationId]);
    assert.ok(reportsBefore.length,'seeded historical reports are present');
    const defaultsBefore=await manager.query(`select * from app_identity.active_configuration_bundle where organization_id=$1`,[organizationId]);
    await service.save('token',created.id,{name:renamed.name,callSign:renamed.callSign,active:false,expectedRevision:2});
    assert.equal((await route({...template,revision:4,messageId:randomUUID()})).status,'quarantined');
    await assert.rejects(service.save('token',null,{name:'Inactive conflict',callSign:'RENAMED-UNIT',active:true}),/already assigned/);
    await assert.rejects(service.save('token',created.id,{name:'Stale edit',callSign:'NEW',active:true,expectedRevision:2}),/changed/);
    const [historicalUnit]=await manager.query(`select id,name,call_sign,revision,default_form_id
      from app_identity.operational_unit where organization_id=$1 and id<>$2 limit 1`,[organizationId,created.id]);
    assert.ok(historicalUnit,'migration preserves the seeded legacy unit');
    const [historicalReport]=await manager.query('select id,incident_id from clinical.report where id=$1',[reportsBefore[0].id]);
    await manager.query(`insert into clinical.call_assignment(id,organization_id,unit_id,incident_id,call_number,dispatched_at,status,report_id,synthetic)
      values($1,$2,$3,$4,'Unit historical association',now(),'opened',$5,true)`,
      [randomUUID(),organizationId,historicalUnit.id,historicalReport.incident_id,historicalReport.id]);
    const historicalAssignments=await manager.query(`select id,unit_id,report_id from clinical.call_assignment
      where organization_id=$1 and unit_id=$2 order by id`,[organizationId,historicalUnit.id]);
    await service.save('token',historicalUnit.id,{name:historicalUnit.name,callSign:historicalUnit.call_sign,active:false,expectedRevision:historicalUnit.revision});
    assert.deepEqual(await manager.query(`select id,unit_id,report_id from clinical.call_assignment
      where organization_id=$1 and unit_id=$2 order by id`,[organizationId,historicalUnit.id]),historicalAssignments);
    assert.equal((await manager.query('select default_form_id from app_identity.operational_unit where id=$1',[historicalUnit.id]))[0].default_form_id,historicalUnit.default_form_id);
    assert.deepEqual(await manager.query(`select id,organization_id,documenting_user_id,form_version_id,catalog_release_id from clinical.report where organization_id=$1 order by id`,[organizationId]),reportsBefore);
    assert.deepEqual(await manager.query(`select * from app_identity.active_configuration_bundle where organization_id=$1`,[organizationId]),defaultsBefore);
    assert.equal((await manager.query('select unit_id from clinical.call_assignment where id=$1',[assigned.assignmentId]))[0].unit_id,created.id);
    assert.equal((await manager.query('select unit_id from app_identity.unit_clinician where unit_id=$1',[created.id]))[0].unit_id,created.id);
    const audit=await manager.query('select * from app_identity.operational_unit_event where unit_id=$1',[created.id]);assert.equal(audit.length,3);
    await assert.rejects(manager.query('delete from app_identity.operational_unit_event where unit_id=$1',[created.id]),/append|update|delete|immutable/i);
  } finally {await client.query('rollback');await client.end();}
});
