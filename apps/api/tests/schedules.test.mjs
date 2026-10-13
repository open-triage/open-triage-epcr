import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWallTime,evaluateSchedule } from '../dist/schedules/schedule-evaluation.js';
import { validateSchedule } from '../dist/schedules/schedule-validation.js';
const version=(breakpoints,effectiveAt='2020-01-01T00:00:00Z',revision=1)=>({breakpoints,effectiveAt,revision});
const point=(weekday,time,graceMinutes=0)=>({weekday,time,graceMinutes});
test('schedule validation rejects duplicates, unknown fields, invalid precision and grace bounds; blank is explicit',()=>{
 assert.deepEqual(validateSchedule({name:' Blank ',breakpoints:[]},false),{name:'Blank',breakpoints:[]});
 for(const points of [[point(1,'07:00'),point(1,'07:00',15)],[point(1,'24:00')],[point(0,'07:00')],[point(1,'07:00',-1)],[point(1,'07:00',1441)],[point(1,'07:00',1.5)]])assert.throws(()=>validateSchedule({name:'Bad',breakpoints:points},false));
 assert.throws(()=>validateSchedule({name:'Bad',breakpoints:[],timezone:'UTC'},false));
 assert.throws(()=>validateSchedule({name:'Bad',breakpoints:[]},true));
 assert.equal(validateSchedule({name:'Good',breakpoints:[point(1,'00:00',1440)],expectedRevision:1},true).breakpoints[0].graceMinutes,1440);
});
test('Stockholm DST gap preserves minutes and fold occurs once at earlier instant',()=>{
 assert.equal(new Date(resolveWallTime(Date.UTC(2026,2,29,2,30),'Europe/Stockholm')).toISOString(),'2026-03-29T01:30:00.000Z');
 assert.equal(new Date(resolveWallTime(Date.UTC(2026,9,25,2,30),'Europe/Stockholm')).toISOString(),'2026-10-25T00:30:00.000Z');
 const result=evaluateSchedule([version([point(7,'02:30')])],'Europe/Stockholm',Date.parse('2026-10-25T00:45:00Z'));
 assert.equal(result.activeCheckpoint.at,'2026-10-25T00:30:00.000Z');assert.equal(result.nextCheckpoint.at,'2026-11-01T01:30:00.000Z');
});
test('empty weekdays preserve preceding checkpoint across midnight and week; agency zone determines instant',()=>{
 const versions=[version([point(7,'23:00',15)])];
 const monday=Date.parse('2026-10-19T02:00:00Z');
 assert.equal(evaluateSchedule(versions,'Europe/Stockholm',monday).activeCheckpoint.at,'2026-10-18T21:00:00.000Z');
 assert.equal(evaluateSchedule(versions,'UTC',monday).activeCheckpoint.at,'2026-10-18T23:00:00.000Z');
 assert.equal(evaluateSchedule(versions,'Europe/Stockholm',monday).nextCheckpoint.at,'2026-10-25T22:00:00.000Z');
});
test('overlapping grace retains all upcoming checkpoints; exact handover activates; collision chooses shortest grace',()=>{
 const versions=[version([point(1,'07:00',60),point(1,'07:30',120)])];
 const before=evaluateSchedule(versions,'UTC',Date.parse('2026-10-19T06:15:00Z'));
 assert.equal(before.graceCheckpoints.length,2);
 assert.equal(evaluateSchedule(versions,'UTC',Date.parse('2026-10-19T07:00:00Z')).activeCheckpoint.at,'2026-10-19T07:00:00.000Z');
 const collision=evaluateSchedule([version([point(7,'02:30',30),point(7,'03:30',10)])],'Europe/Stockholm',Date.parse('2026-03-29T01:25:00Z'));
 assert.equal(collision.graceCheckpoints.length,1);assert.equal(collision.nextCheckpoint.graceStartsAt,'2026-03-29T01:20:00.000Z');
});
test('initial authoring and unit selection never invent historical handovers; prospective edits preserve current checkpoint',()=>{
 const now=Date.parse('2026-10-19T08:00:00Z');
 assert.equal(evaluateSchedule([version([point(1,'07:00')],'2026-10-19T08:00:00Z')],'UTC',now).activeCheckpoint,null);
 assert.equal(evaluateSchedule([version([point(1,'07:00')])],'UTC',now,now).activeCheckpoint,null);
 const versions=[version([point(1,'07:00')]),version([point(1,'09:00')],'2026-10-26T07:00:00Z',2)];
 assert.equal(evaluateSchedule(versions,'UTC',now).activeCheckpoint.at,'2026-10-19T07:00:00.000Z');
 const after=evaluateSchedule(versions,'UTC',Date.parse('2026-10-26T08:00:00Z'));
 assert.equal(after.activeCheckpoint.at,'2026-10-19T07:00:00.000Z');assert.equal(after.nextCheckpoint.at,'2026-10-26T09:00:00.000Z');
 assert.equal(evaluateSchedule([version([])],'UTC',now).blank,true);
});

test('historical last checkpoint survives beyond eight days when prospective revision postpones the next weekly event',()=>{
 const versions=[version([point(1,'07:00')]),version([point(3,'07:00')],'2026-10-26T07:00:00Z',2)];
 const result=evaluateSchedule(versions,'UTC',Date.parse('2026-10-27T20:00:00Z'));
 assert.equal(result.activeCheckpoint.at,'2026-10-19T07:00:00.000Z');assert.equal(result.nextCheckpoint.at,'2026-10-28T07:00:00.000Z');
});

test('non-hour daylight-saving and date-line gaps follow the same wall clock rule',()=>{
 assert.equal(new Date(resolveWallTime(Date.UTC(2026,9,4,2,15),'Australia/Lord_Howe')).toISOString(),'2026-10-03T15:45:00.000Z');
 assert.equal(new Date(resolveWallTime(Date.UTC(2026,3,5,1,45),'Australia/Lord_Howe')).toISOString(),'2026-04-04T14:45:00.000Z');
 assert.equal(new Date(resolveWallTime(Date.UTC(2011,11,30,7),'Pacific/Apia')).toISOString(),'2011-12-30T17:00:00.000Z');
});

test('added/removed breakpoints and blank transitions never create retrospective authentication checkpoints',()=>{
 const boundary='2026-10-19T07:00:00Z';
 for(const points of [[point(1,'06:00')],[point(1,'09:00')],[]]) {
  const versions=[version([point(1,'07:00')]),version(points,boundary,2)];
  const before=evaluateSchedule(versions,'UTC',Date.parse(boundary)-1);
  assert.equal(before.activeCheckpoint.at,'2026-10-12T07:00:00.000Z');
  const after=evaluateSchedule(versions,'UTC',Date.parse(boundary));
  assert.equal(after.activeCheckpoint.at,before.activeCheckpoint.at);
  if(points.length)assert.ok(Date.parse(after.nextCheckpoint.at)>=Date.parse(boundary));
  else assert.equal(after.blank,true);
 }
 const started=Date.parse('2026-10-19T08:00:00Z');
 const nonblank=evaluateSchedule([version([]),version([point(1,'07:00')],new Date(started).toISOString(),2)],'UTC',started);
 assert.equal(nonblank.blank,false);assert.equal(nonblank.activeCheckpoint,null);assert.equal(nonblank.nextCheckpoint.at,'2026-10-26T07:00:00.000Z');
});

test('all schedule HTTP mutation routes require an authoritative preview token',async()=>{
 const {SchedulesController}=await import('../dist/schedules/schedules.controller.js');
 const calls=[];
 const controller=new SchedulesController({save:(...args)=>calls.push(args),select:(...args)=>calls.push(args)});
 const request={headers:{cookie:'open_triage_session=opaque-session'}};
 for(const invoke of [body=>controller.create(request,body),body=>controller.update('schedule',request,body),body=>controller.select('unit',request,body)]) {
  assert.throws(()=>invoke({}),/Preview the effective time/);
  invoke({previewToken:'server-preview'});
 }
 assert.equal(calls.length,3);
});
