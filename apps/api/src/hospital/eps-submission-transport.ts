import {requestFhirHttp,fhirOutcomeIssues} from './fhir-http.js';
import {EPS_PROFILE} from './eps-output.js';
import {EPS_ENDPOINT} from './hospital-mapping.js';
import {epsAuthenticationHeaders} from './eps-authentication.js';
export type EpsSubmissionEvidence={state:'accepted'|'rejected'|'unknown';issues:{severity:string;code:string;expression:string[]}[];headers:Record<string,string>};
/** Fixed public destination, bounded bytes/time, no redirects, preserve publication result headers. */
export async function publishEps(bundle:unknown,secret:string):Promise<EpsSubmissionEvidence>{
 const response=await requestFhirHttp({url:`${EPS_ENDPOINT}/Bundle/$validate`,method:'POST',headers:{'content-type':'application/fhir+json','accept':'application/fhir+json',...epsAuthenticationHeaders(secret)},body:JSON.stringify(bundle)});
 let outcome:unknown;
 try{outcome=JSON.parse(response.body);}catch{throw new Error('Invalid EPS outcome');}
 const issues=fhirOutcomeIssues(outcome);
 // Authentication rejections happen before validation and carry no scoring headers.
 // Keep their safe issue codes so a rejected token is not reported as lost acknowledgement.
 if(issues&&[401,403].includes(response.status)&&issues.some(issue=>['error','fatal'].includes(issue.severity)
  &&['login','forbidden','security'].includes(issue.code)))return {state:'rejected',issues:issues.slice(0,200),headers:{}};
 if(!issues||!['true','false'].includes(String(response.headers['x-pass'])))throw new Error('Invalid EPS outcome');
 const headers:Record<string,string>={};
 for(const key of ['x-pass','x-score','x-submission-score','x-errors','x-sections','x-resources','x-document-type','x-document-profile','content-location']){
  const value=response.headers[key];if(typeof value==='string'&&value.length<2048)headers[key]=value;
 }
 if(headers['content-location']){
  const result=new URL(headers['content-location'],EPS_ENDPOINT),origin=new URL(EPS_ENDPOINT).origin;
  if(result.origin!==origin||result.username||result.password||!['/clinical/submission/','/fhir/','/exchange/'].some(prefix=>result.pathname.startsWith(prefix)))delete headers['content-location'];else headers['content-location']=result.href;
 }
 const errors=issues.some(row=>['error','fatal'].includes(row.severity));
 const state=response.status===200&&headers['x-pass']==='true'&&!errors&&(!headers['x-errors']||headers['x-errors']==='0')&&(!headers['x-document-type']||headers['x-document-type']==='eps')&&(!headers['x-document-profile']||headers['x-document-profile'].split('|')[0]===EPS_PROFILE)?'accepted':response.status===200&&headers['x-pass']==='false'?'rejected':'unknown';
 return {state,headers,issues:issues.slice(0,200)};
}
