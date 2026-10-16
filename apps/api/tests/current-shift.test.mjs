import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateSchedule} from '../dist/schedules/schedule-evaluation.js';
import {shiftAuthenticationState} from '../dist/calls/production-job-access.js';
const version=(points,effectiveAt='2020-01-01T00:00:00Z',revision=1)=>({breakpoints:points,effectiveAt,revision});
const point=(weekday,time,graceMinutes=0)=>({weekday,time,graceMinutes});
const access=(points,at,proof,zone='UTC',versions)=>{
 const now=Date.parse(at),value=evaluateSchedule(versions??[version(points)],zone,now);
 return shiftAuthenticationState({...value,evaluatedAt:new Date(now).toISOString(),state:value.blank?'blank':'scheduled'},proof);
};
test('each device needs personal proof at the inclusive incoming grace start; grace remains explicit',()=>{
 const points=[point(1,'07:00',15)];
 assert.equal(access(points,'2026-10-19T07:00Z','2026-10-19T06:44Z'),'reauthentication-required');
 assert.equal(access(points,'2026-10-19T07:00Z','2026-10-19T06:45Z'),'ready');
 for(const proof of ['2026-10-19T06:44Z','2026-10-19T06:45Z','2026-10-19T06:50Z'])assert.equal(access(points,'2026-10-19T06:50Z',proof),'identity-confirmation-required');
 for(const proof of [null,'invalid','2026-10-19T07:00:00.001Z'])assert.equal(access(points,'2026-10-19T07:00Z',proof),'reauthentication-required');
 assert.equal(access(points,'2026-10-19T06:44Z','2026-10-12T06:45Z'),'ready');
});
test('zero grace, empty weekdays and week wrap use the latest checkpoint rather than calendar date',()=>{
 const points=[point(7,'23:59'),point(1,'07:00')];
 assert.equal(access(points,'2026-10-19T07:00Z','2026-10-19T06:59:59.999Z'),'reauthentication-required');
 assert.equal(access(points,'2026-10-19T07:00Z','2026-10-19T07:00Z'),'ready');
 assert.equal(access(points,'2026-10-20T12:00Z','2026-10-19T07:00Z'),'ready');
 assert.equal(access(points,'2026-10-19T00:01Z','2026-10-18T23:58:59.999Z'),'reauthentication-required');
 assert.equal(access(points,'2026-10-19T00:01Z','2026-10-18T23:59Z'),'ready');
});
test('overlap, DST folds/gaps, Lord Howe and Apia use the shared occurrence thresholds',()=>{
 const cases=[
 [[point(1,'07:00',60),point(1,'07:30',120)],'UTC','2026-10-19T07:15Z','2026-10-19T07:00Z','identity-confirmation-required'],
 [[point(7,'02:30',15)],'Europe/Stockholm','2026-10-25T00:30Z','2026-10-25T00:15Z','ready'],
 [[point(7,'02:30',15)],'Europe/Stockholm','2026-10-25T01:30Z','2026-10-25T00:15Z','ready'],
 [[point(7,'02:30',30),point(7,'03:30',10)],'Europe/Stockholm','2026-03-29T01:30Z','2026-03-29T01:19Z','reauthentication-required'],
 [[point(7,'02:15',15)],'Australia/Lord_Howe','2026-10-03T15:45Z','2026-10-03T15:30Z','ready'],
 [[point(7,'01:45',15)],'Australia/Lord_Howe','2026-04-04T14:45Z','2026-04-04T14:30Z','ready'],
 [[point(5,'07:00',15)],'Pacific/Apia','2011-12-30T17:00Z','2011-12-30T16:45Z','ready']];
 for(const [points,zone,at,proof,expected] of cases)assert.equal(access(points,at,proof,zone),expected,`${zone} ${at}`);
});
test('prospective revisions retain the actual old checkpoint; blank and initial selection have no retrospective gate',()=>{
 const versions=[version([point(1,'07:00')]),version([point(1,'09:00')],'2026-10-26T07:00Z',2)];
 assert.equal(access([],'2026-10-26T08:00Z','2026-10-19T07:00Z','UTC',versions),'ready');
 assert.equal(access([],'2026-10-26T09:00Z','2026-10-19T07:00Z','UTC',versions),'reauthentication-required');
 assert.equal(access([],'2026-10-26T09:00Z',null),'ready');
 assert.equal(access([],'2026-10-26T08:00Z',null,'UTC',[version([point(1,'07:00')],'2026-10-26T08:00Z')]),'ready');
});
