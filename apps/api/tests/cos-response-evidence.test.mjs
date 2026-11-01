import test from 'node:test';
import assert from 'node:assert/strict';
import {cosResponseEvidence,CosReadFailure} from '../dist/hospital/cos-response-evidence.js';
import {CosLiveAdapter} from '../dist/hospital/cos-live-adapter.js';

test('private COS evidence retains bounded receiver diagnostics and correlation without arbitrary headers or bodies',()=>{
 const issue={severity:'error',code:'processing',diagnostics:'Patient Not found for the given identifier',details:{text:'Detailed error',coding:[{system:'urn:receiver',code:'PATIENT_NOT_FOUND'}]},expression:['Encounter.subject'],location:['Encounter.subject.identifier']};
 const result=cosResponseEvidence({status:400,headers:{'x-request-id':'trace-123','authorization':'SECRET','set-cookie':['SECRET']},body:JSON.stringify({resourceType:'OperationOutcome',issue:[issue],text:{div:'PRIVATE HTML'}})});
 assert.equal(result.issues[0].diagnostics,issue.diagnostics);assert.equal(result.issues[0].details,'Detailed error');assert.equal(result.issues[0].coding[0].code,'PATIENT_NOT_FOUND');
 assert.deepEqual(result.correlation,{'x-request-id':'trace-123'});assert.match(result.bodySha256,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.equal(JSON.stringify(result).includes('PRIVATE HTML'),false);
 const bounded=cosResponseEvidence({status:400,headers:{},body:JSON.stringify({resourceType:'OperationOutcome',issue:Array(25).fill({...issue,diagnostics:'x'.repeat(5000)})})});
 assert.equal(bounded.issueCount,25);assert.equal(bounded.issues.length,20);assert.equal(bounded.issuesTruncated,true);assert.equal(bounded.issues[0].diagnostics.length,2048);
 assert.deepEqual(cosResponseEvidence({status:500,headers:{},body:'<html>PRIVATE</html>'}).issues,[]);
});
test('COS read errors retain diagnostics without putting patient query parameters in endpoint or error message',async()=>{
 const adapter=new CosLiveAdapter({baseUrl:'https://receiver.example/api/',tokenUrl:'https://identity.example/token',clientId:'id'}, {clientSecret:'SECRET',subscriptionKey:'SECRET'},async options=>options.url.href==='https://identity.example/token'?{status:200,headers:{},body:JSON.stringify({access_token:'SECRET',expires_in:300})}:{status:404,headers:{'apim-request-id':'trace'},body:JSON.stringify({resourceType:'OperationOutcome',issue:[{severity:'error',code:'processing',diagnostics:'Patient Not found for the given identifier'}]})});
 await assert.rejects(adapter.read('fhir/Encounter?subject.identifier=PRIVATE'),error=>{
  assert.ok(error instanceof CosReadFailure);assert.equal(error.endpoint,'/api/fhir/Encounter');assert.equal(error.message,'COS read unavailable');assert.equal(error.responseEvidence.httpStatus,404);assert.match(error.responseEvidence.issues[0].diagnostics,/Patient Not found/);return true;
 });
 const receipt=await adapter.write('fhir/subscription/Encounter/id','PUT',{resourceType:'Encounter'});
 assert.equal(receipt.responseEvidence.httpStatus,404);assert.equal(receipt.responseEvidence.correlation['apim-request-id'],'trace');
});
