import assert from 'node:assert/strict';
import test from 'node:test';
import {assertNativeAuthenticationOutcome} from '../scripts/android/authentication-outcome.mjs';

test('unknown identity acceptance requires exact pending delivery and never accepts a generic failure',()=>{
  const pending={expected:'pending',result:'pending',delivered:true,sessionStatus:401,userId:null};
  assertNativeAuthenticationOutcome(pending);
  assert.throws(()=>assertNativeAuthenticationOutcome({...pending,result:'failed'}));
  assert.throws(()=>assertNativeAuthenticationOutcome({...pending,delivered:false}));
  assert.throws(()=>assertNativeAuthenticationOutcome({...pending,sessionStatus:200,userId:'unexpected'}));
});
test('approved login and provider outage require their own exact session and delivery evidence',()=>{
  const approved={expected:'succeeded',result:'succeeded',delivered:true,sessionStatus:200,userId:'approved',expectedUserId:'approved'};
  assertNativeAuthenticationOutcome(approved);
  assert.throws(()=>assertNativeAuthenticationOutcome({...approved,userId:'another-user'}));
  assert.throws(()=>assertNativeAuthenticationOutcome({...approved,sessionStatus:401}));
  assert.throws(()=>assertNativeAuthenticationOutcome({...approved,delivered:false}));
  const failed={expected:'failed',result:'failed',delivered:true,sessionStatus:401,userId:null};
  assertNativeAuthenticationOutcome(failed);
  assert.throws(()=>assertNativeAuthenticationOutcome({...failed,result:'pending'}));
});
