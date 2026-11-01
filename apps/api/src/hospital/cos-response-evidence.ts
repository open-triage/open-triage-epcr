import {createHash} from 'node:crypto';
import type {FhirHttpResponse} from './fhir-http.js';

/** Receiver diagnostics can contain patient data. Store only in the private,
 * report-retained artifact journal, never operational logs or public summaries. */
export function cosResponseEvidence(response:FhirHttpResponse){
 const text=(value:unknown)=>typeof value==='string'?value.slice(0,2048):undefined;
 let body:Record<string,unknown>|undefined;
 try{body=JSON.parse(response.body);}catch{/* Retain fingerprint, not arbitrary HTML. */}
 const issues=body?.resourceType==='OperationOutcome'&&Array.isArray(body.issue)?body.issue:[];
 const correlation:Record<string,string>={};
 for(const key of ['x-request-id','request-id','x-correlation-id','traceparent','apim-request-id']){
  const value=response.headers[key];if(typeof value==='string')correlation[key]=value.slice(0,256);
 }
 return {httpStatus:response.status,bodySha256:createHash('sha256').update(response.body).digest('hex'),
  bodyBytes:Buffer.byteLength(response.body),issueCount:issues.length,issuesTruncated:issues.length>20,correlation,
  issues:issues.slice(0,20).map(raw=>{
   const issue=raw&&typeof raw==='object'?raw as Record<string,any>:{};
   return {severity:text(issue.severity),code:text(issue.code),diagnostics:text(issue.diagnostics),
    details:text(issue.details?.text),coding:Array.isArray(issue.details?.coding)?issue.details.coding.slice(0,10).map((c:any)=>({system:text(c?.system),code:text(c?.code),display:text(c?.display)})):[],
    expression:Array.isArray(issue.expression)?issue.expression.slice(0,10).map(text):[],
    location:Array.isArray(issue.location)?issue.location.slice(0,10).map(text):[]};
  })};
}
export class CosReadFailure extends Error {
 constructor(readonly responseEvidence:ReturnType<typeof cosResponseEvidence>,readonly endpoint:string){super('COS read unavailable');}
}
export function cosVerificationFailure(error:unknown){
 return error instanceof CosReadFailure?{endpoint:error.endpoint,response:error.responseEvidence}:{reason:'transportOrVerificationUnavailable'};
}
