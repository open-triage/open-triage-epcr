import assert from 'node:assert/strict';
import test from 'node:test';
import {approvedPersonalProofPolicy,validatePersonalProof,assertValidatedPersonalProof,personalProofPolicyDigest} from '../dist/authentication/personal-proof.js';
const policy={id:'fictional-reviewed-contract',groupId:'group',providerId:'provider',issuer:'https://fixture.example/issuer',clientId:'fixture-client',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']};
const began=new Date('2026-10-13T10:00:00.250Z'),now=new Date('2026-10-13T10:00:02Z');
const valid={iss:policy.issuer,auth_time:Date.parse('2026-10-13T10:00:01Z')/1000,acr:policy.acr,amr:['fixture-personal']};
test('personal proof requires agency-owned requirements bound to the selected integration',()=>{
 const {groupId,providerId,issuer,clientId,...requirements}=policy;
 assert.throws(()=>approvedPersonalProofPolicy(policy));
 assert.throws(()=>approvedPersonalProofPolicy(policy,null));
 assert.deepEqual(approvedPersonalProofPolicy(policy,requirements),policy);
 assert.equal(approvedPersonalProofPolicy(policy,{...requirements,acr:null}).acr,null);
 for(const changed of [{acr:undefined},{acr:''},{acr:false},{acr:0},{acr:[]},{requiredAmr:[]},{requiredAmr:['fixture-personal','fixture-personal']},{purposeClaim:'auth_time',purposes:{login:'l',switch:'s',reauthenticate:'r'}},{purposes:{login:'l'}}])assert.throws(()=>approvedPersonalProofPolicy(policy,{...requirements,...changed}));
});
test('environment contracts cannot supply missing or cleared agency requirements',()=>{
 const old=process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON;
 try{
  process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=JSON.stringify([policy]);
  assert.throws(()=>approvedPersonalProofPolicy(policy));
  assert.throws(()=>approvedPersonalProofPolicy(policy,null));
  const requirements={id:'agency-contract',acr:null,requiredAmr:['pwd']};
  assert.equal(approvedPersonalProofPolicy(policy,requirements).id,'agency-contract');
 }finally{if(old===undefined)delete process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON;else process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON=old;}
});
test('explicit null ACR permits AMR-based proof for every purpose without relaxing freshness or purpose binding',()=>{
 const amrPolicy={...policy,acr:null,requiredAmr:['pwd'],purposeClaim:'purpose',purposes:{login:'login',switch:'switch',reauthenticate:'reauthenticate'}};
 const {acr,...withoutAcr}=valid;
 for(const purpose of ['login','switch','reauthenticate']){
  const claims={...withoutAcr,amr:['pwd'],purpose};
  assertValidatedPersonalProof(validatePersonalProof(claims,amrPolicy,purpose,began,now));
  for(const changed of [{amr:undefined},{amr:[]},{amr:['sso']},{auth_time:undefined},{auth_time:valid.auth_time-1},{auth_time:valid.auth_time+2},{auth_time:valid.auth_time+.5},{iss:'https://another.example'},{purpose:'other'}])assert.throws(()=>validatePersonalProof({...claims,...changed},amrPolicy,purpose,began,now));
  assert.throws(()=>validatePersonalProof(claims,amrPolicy,purpose,began,new Date(now.getTime()+300000)));
  assert.throws(()=>validatePersonalProof(claims,{...amrPolicy,acr:policy.acr},purpose,began,now));
 }
 assert.notEqual(personalProofPolicyDigest(policy),personalProofPolicyDigest({...policy,acr:null}));
 assert.equal(personalProofPolicyDigest({...amrPolicy,requiredAmr:['pwd','otp']}),personalProofPolicyDigest({...amrPolicy,requiredAmr:['otp','pwd']}));
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

test('agency-owned requirements bind to the selected integration and can explicitly disable proof',()=>{
 const requirements={id:'agency-contract',acr:null,requiredAmr:['pwd']};
 assert.deepEqual(approvedPersonalProofPolicy(policy,requirements),{...requirements,groupId:policy.groupId,providerId:policy.providerId,issuer:policy.issuer,clientId:policy.clientId});
 assert.throws(()=>approvedPersonalProofPolicy(policy,null));
 assert.throws(()=>approvedPersonalProofPolicy(policy,{...requirements,requiredAmr:[]}));
});
