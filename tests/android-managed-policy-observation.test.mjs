import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalAndroidManagedPolicy,androidManagedPolicyObservationJson,androidManagedPolicyFingerprint} from '../scripts/android/managed-policy-observation.mjs';

const ca='-----BEGIN CERTIFICATE-----\nABC/123\n-----END CERTIFICATE-----';
const policy=Object.freeze({serverOrigin:'https://mdm.example.test',publicCaPem:ca+'\n',enabled:true,configurationVersion:1});
const expected=String.raw`[["configurationVersion","Integer",1],["enabled","Boolean",true],["publicCaPem","String","-----BEGIN CERTIFICATE-----\nABC\/123\n-----END CERTIFICATE-----"],["serverOrigin","String","https:\/\/mdm.example.test"]]`;

test('persisted Bundle fingerprint matches fixed Android JSONArray slash/newline payload and hash',()=>{
  assert.equal(androidManagedPolicyObservationJson(policy),expected);
  assert.equal(androidManagedPolicyFingerprint(policy),'649f13850728292dfd96bc90b74f02e6c8a42434cfda68e36f0594d9b37bb758');
  assert.equal(androidManagedPolicyFingerprint(Object.fromEntries(Object.entries(policy).reverse())),androidManagedPolicyFingerprint(policy));
  assert.equal(canonicalAndroidManagedPolicy(policy).publicCaPem,ca);
  assert.equal(policy.publicCaPem,ca+'\n','Configured MDM payload must remain unchanged');
});

test('only outer Java trim characters change; Unicode spaces and internal certificate lines remain exact',()=>{
  const ascii=Array.from({length:33},(_,i)=>String.fromCharCode(i)).join('');
  const internal='first\n second\tline\r\nlast';
  assert.deepEqual(canonicalAndroidManagedPolicy({publicCaPem:ascii+internal+ascii}),{publicCaPem:internal});
  const unicode='\u00a0\u2003\ufeff'+ca+'\u00a0\u2003\ufeff';
  assert.equal(canonicalAndroidManagedPolicy({publicCaPem:unicode}).publicCaPem,unicode);
  assert.equal(androidManagedPolicyFingerprint({...policy,publicCaPem:' \t\r\n'+ca+'\r\n '}),androidManagedPolicyFingerprint(policy));
  for(const changed of [ca.replace('ABC/123','ABC/124'),ca.replaceAll('\n',''),ca.replaceAll('\n','\\n'),ca.replaceAll('\n','\r\n')]) {
    assert.notEqual(androidManagedPolicyFingerprint({...policy,publicCaPem:changed}),androidManagedPolicyFingerprint(policy),'Certificate content/internal line changes must not be hidden');
  }
});

test('primitive types stay distinct and unsupported Bundle shapes reject rather than coerce',()=>{
  assert.deepEqual(canonicalAndroidManagedPolicy({text:' 001 ',truth:'true',enabled:false,count:-2147483648,max:2147483647}),{text:'001',truth:'true',enabled:false,count:-2147483648,max:2147483647});
  assert.notEqual(androidManagedPolicyFingerprint({...policy,configurationVersion:'1'}),androidManagedPolicyFingerprint(policy));
  assert.notEqual(androidManagedPolicyFingerprint({...policy,enabled:'true'}),androidManagedPolicyFingerprint(policy));
  for(const value of [null,undefined,[],{},1.5,NaN,Infinity,2147483648,-2147483649,1n,()=>{}])assert.throws(()=>canonicalAndroidManagedPolicy({key:value}),/only String, Integer and Boolean/);
  for(const input of [null,[],new Date(),Object.create(null)])assert.throws(()=>canonicalAndroidManagedPolicy(input),/JSON object/);
});

test('explicit empty Bundle has the fixed native empty-array digest',()=>{
  assert.deepEqual(canonicalAndroidManagedPolicy({}),{});
  assert.equal(androidManagedPolicyObservationJson({}),'[]');
  assert.equal(androidManagedPolicyFingerprint({}),'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
});
