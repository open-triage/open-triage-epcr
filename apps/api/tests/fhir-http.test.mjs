import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url);
const transport=require('../dist/hospital/fhir-http.js');
const network=require('../dist/authentication/oidc-network.js');
const https=require('node:https');
const {publishEps}=require('../dist/hospital/eps-submission-transport.js');
const {HospitalService}=require('../dist/hospital/hospital.service.js');
const {EPS_ENDPOINT}=require('../dist/hospital/hospital-mapping.js');

test('EPS connectivity authenticates the read-only identity request with a Bearer token',async t=>{
 const mock=t.mock.method(network,'providerFetch',async(url,options)=>{
  assert.equal(url,`${EPS_ENDPOINT}/Organization/$me`);
  assert.deepEqual(options,{headers:{Authorization:'Bearer secret'}});
  return {json:async()=>({resourceType:'Organization',id:'test-company'})};
 });
 assert.equal(await new HospitalService(undefined,undefined).connectivity(EPS_ENDPOINT,'secret'),true);
 assert.equal(mock.mock.callCount(),1);
});

test('EPS publication uses Bearer authentication and preserves accepted receiver evidence',async t=>{
 const mock=t.mock.method(transport,'requestFhirHttp',async options=>{
  assert.equal(options.url,`${EPS_ENDPOINT}/Bundle/$validate`);
  assert.equal(options.method,'POST');
  assert.deepEqual(options.headers,{'content-type':'application/fhir+json',accept:'application/fhir+json',Authorization:'Bearer secret'});
  return {status:200,headers:{'x-pass':'true','x-errors':'0'},body:JSON.stringify({resourceType:'OperationOutcome',issue:[{severity:'information',code:'informational'}]})};
 });
 assert.equal((await publishEps({resourceType:'Bundle'},'secret')).state,'accepted');
 assert.equal(mock.mock.callCount(),1);
});

test('FHIR evidence strips diagnostics and validates errors beyond display limit',()=>{
 const issue={severity:'information',code:'informational',diagnostics:'private patient text',expression:['Bundle.entry']};
 const result=transport.fhirOutcomeIssues({resourceType:'OperationOutcome',issue:[...Array(201).fill(issue),{severity:'fatal',code:'invalid'}]});
 assert.equal(result.length,202);assert.equal(result.at(-1).severity,'fatal');assert.equal(JSON.stringify(result).includes('private patient'),false);
 for(const issue of [[],[{}],[{severity:'unknown',code:'invalid'}],[null]])assert.equal(transport.fhirOutcomeIssues({resourceType:'OperationOutcome',issue}),null);
});

test('shared transport rejects unsafe URLs and oversized requests before DNS',async t=>{
 t.mock.method(network,'checkedAddress',()=>{throw Error('Must not resolve');});
 for(const url of ['http://receiver.example/fhir','https://user:secret@receiver.example','https://receiver.example/#fragment'])await assert.rejects(transport.requestFhirHttp({url,method:'GET',headers:{}}),{message:'FHIR transport failed'});
 await assert.rejects(transport.requestFhirHttp({url:'https://receiver.example',method:'POST',headers:{},body:'x'.repeat(2*1024*1024+1)}));
 assert.equal(network.checkedAddress.mock.callCount(),0);
});

function fakeRequest(t,{status=200,headers={},chunks=['{}'],failure}={}){
 t.mock.method(network,'checkedAddress',async()=>({address:'8.8.8.8',family:4}));
 return t.mock.method(https,'request',(url,options,callback)=>{
  assert.equal(options.agent,false);
  options.lookup('receiver.example',{},(error,address)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');});
  const req=new EventEmitter();
  req.destroy=error=>{req.emit('error',error);req.emit('close');};
  req.end=()=>queueMicrotask(()=>{
   if(failure){req.destroy(Error(failure));return;}
   const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.resume=()=>{};
   callback(res);for(const chunk of chunks)res.emit('data',Buffer.from(chunk));res.emit('end');req.emit('close');
  });
  return req;
 });
}

test('shared transport returns bounded response and never follows redirects',async t=>{
 const mock=fakeRequest(t,{status:302,headers:{location:'https://other.example'}});
 await assert.rejects(transport.requestFhirHttp({url:'https://receiver.example',method:'GET',headers:{Authorization:'Bearer secret'}}),{message:'FHIR transport failed'});
 assert.equal(mock.mock.callCount(),1);
});
test('shared transport bounds response and redacts underlying failures',async t=>{
 fakeRequest(t,{chunks:['12345']});
 await assert.rejects(transport.requestFhirHttp({url:'https://receiver.example',method:'GET',headers:{},maxResponseBytes:4}),{message:'FHIR transport failed'});
});
test('transport network failure cannot expose credential text',async t=>{
 fakeRequest(t,{failure:'Bearer secret patient'});
 await assert.rejects(transport.requestFhirHttp({url:'https://receiver.example',method:'GET',headers:{}}),{message:'FHIR transport failed'});
});
test('EPS uses shared transport and refuses fatal outcome hidden beyond displayed issues',async t=>{
 const issues=[...Array(201).fill({severity:'information',code:'informational'}),{severity:'error',code:'invalid',diagnostics:'private'}];
 t.mock.method(transport,'requestFhirHttp',async options=>{
  assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer secret');
  assert.equal(options.headers['X-Team-Token'],undefined);
  return {status:200,headers:{'x-pass':'true'},body:JSON.stringify({resourceType:'OperationOutcome',issue:issues})};
 });
 const evidence=await publishEps({resourceType:'Bundle'},'secret');assert.equal(evidence.state,'unknown');assert.equal(evidence.issues.length,200);
});

for(const [status,code] of [[401,'login'],[403,'forbidden']])test(`EPS records ${status} authentication refusal without scoring headers as rejected`,async t=>{
 t.mock.method(transport,'requestFhirHttp',async()=>({status,headers:{},body:JSON.stringify({resourceType:'OperationOutcome',issue:[{severity:'error',code,diagnostics:'private token details'}]})}));
 assert.deepEqual(await publishEps({resourceType:'Bundle'},'secret'),{state:'rejected',headers:{},issues:[{severity:'error',code,expression:[]}]});
});
test('EPS keeps non-authentication unscored failures ambiguous',async t=>{
 t.mock.method(transport,'requestFhirHttp',async()=>({status:502,headers:{},body:JSON.stringify({resourceType:'OperationOutcome',issue:[{severity:'error',code:'exception'}]})}));
 await assert.rejects(publishEps({resourceType:'Bundle'},'secret'),/Invalid EPS outcome/);
});
