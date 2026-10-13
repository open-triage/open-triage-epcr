import assert from 'node:assert/strict';
import test from 'node:test';
import {approvedPersonalProofPolicy,validatePersonalProof,assertValidatedPersonalProof} from '../dist/authentication/personal-proof.js';
const policy={id:'fictional-reviewed-contract',groupId:'group',providerId:'provider',issuer:'https://fixture.example/issuer',clientId:'fixture-client',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']};
const began=new Date('2026-10-13T10:00:00.250Z'),now=new Date('2026-10-13T10:00:02Z');
const valid={iss:policy.issuer,auth_time:Date.parse('2026-10-13T10:00:01Z')/1000,acr:policy.acr,amr:['fixture-personal']};
test('only an explicitly approved exact group/integration/issuer/client contract can establish personal proof',()=>{
 const old=process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON;
 try{
  delete process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON;assert.throws(()=>approvedPersonalProofPolicy(policy));
  process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=JSON.stringify([policy]);assert.deepEqual(approvedPersonalProofPolicy(policy),policy);
  for(const field of ['groupId','providerId','issuer','clientId'])assert.throws(()=>approvedPersonalProofPolicy({...policy,[field]:'another'}));
  process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=JSON.stringify([policy,policy]);assert.throws(()=>approvedPersonalProofPolicy(policy));
  for(const changed of [{requiredAmr:[]},{requiredAmr:['fixture-personal','fixture-personal']},{purposeClaim:'auth_time',purposes:{login:'l',switch:'s',reauthenticate:'r'}},{purposes:{login:'l'}}]){
   process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=JSON.stringify([{...policy,...changed}]);assert.throws(()=>approvedPersonalProofPolicy(policy));
  }
 }finally{if(old===undefined)delete process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON;else process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=old;}
});
test('signed approved methods and unambiguous transaction freshness are required for each server-bound purpose',()=>{
 for(const purpose of ['login','switch','reauthenticate']){
  const proof=validatePersonalProof(valid,policy,purpose,began,now);assertValidatedPersonalProof(proof);assert.equal(proof.purpose,purpose);
  for(const changed of [{auth_time:undefined},{auth_time:valid.auth_time-1},{auth_time:valid.auth_time-20},{auth_time:valid.auth_time+2},{auth_time:valid.auth_time+.5},{acr:'arbitrary-password'},{amr:['sso']},{amr:[]},{iss:'https://another.example'}])assert.throws(()=>validatePersonalProof({...valid,...changed},policy,purpose,began,now));
 }
 assert.throws(()=>validatePersonalProof({...valid,iat:valid.auth_time,prompt:'login',auth_time:undefined},policy,'login',began,now));
 assert.throws(()=>validatePersonalProof(valid,policy,'silent',began,now));
 assert.throws(()=>validatePersonalProof(valid,policy,'login',began,new Date(now.getTime()+300000)));
 assert.throws(()=>assertValidatedPersonalProof({issuer:policy.issuer,purpose:'login',authenticatedAt:now,policy}));
});
test('an optional reviewed provider purpose claim adds a separate exact requirement',()=>{
 const withPurpose={...policy,purposeClaim:'fixture_purpose',purposes:{login:'fresh-login',switch:'fresh-switch',reauthenticate:'fresh-sensitive'}};
 assert.throws(()=>validatePersonalProof({...valid,fixture_purpose:'fresh-login'},withPurpose,'switch',began,now));
 assertValidatedPersonalProof(validatePersonalProof({...valid,fixture_purpose:'fresh-switch'},withPurpose,'switch',began,now));
});
