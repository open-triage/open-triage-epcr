import {request} from 'node:https';
import {checkedAddress} from '../authentication/oidc-network.js';
import {EPS_PROFILE} from './eps-output.js';
import {EPS_ENDPOINT} from './hospital-mapping.js';
export type EpsSubmissionEvidence={state:'accepted'|'rejected'|'unknown';issues:{severity:string;code:string;expression:string[]}[];headers:Record<string,string>};
/** Fixed public destination, bounded bytes/time, no redirects, preserve publication result headers. */
export async function publishEps(bundle:unknown,secret:string):Promise<EpsSubmissionEvidence>{
 const body=JSON.stringify(bundle);if(Buffer.byteLength(body)>2*1024*1024)throw new Error();
 const url=new URL(`${EPS_ENDPOINT}/Bundle/$validate`),address=await checkedAddress(url);
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:'POST',agent:false,family:address.family,lookup:(_host,_options,callback)=>callback(null,address.address,address.family),headers:{'content-type':'application/fhir+json','accept':'application/fhir+json','X-Team-Token':secret,'content-length':Buffer.byteLength(body)}},res=>{
   let size=0;const parts:Buffer[]=[];res.on('data',(part:Buffer)=>{size+=part.length;if(size>1024*1024)req.destroy(new Error());else parts.push(part);});res.on('error',reject);res.on('end',()=>{
    try{
     const outcome=JSON.parse(Buffer.concat(parts).toString('utf8')) as {resourceType?:string;issue?:Array<{severity?:string;code?:string;expression?:string[]}>};
     if(outcome.resourceType!=='OperationOutcome'||!Array.isArray(outcome.issue)||!['true','false'].includes(String(res.headers['x-pass'])))throw new Error();
     const headers:Record<string,string>={};for(const key of ['x-pass','x-score','x-submission-score','x-errors','x-sections','x-resources','x-document-type','x-document-profile','content-location']){const value=res.headers[key];if(typeof value==='string'&&value.length<2048)headers[key]=value;}
     if(headers['content-location']){const result=new URL(headers['content-location'],EPS_ENDPOINT);if(result.origin!==url.origin||!['/clinical/submission/','/fhir/','/exchange/'].some(prefix=>result.pathname.startsWith(prefix)))delete headers['content-location'];else headers['content-location']=result.href;}
     const errors=outcome.issue.some(row=>['error','fatal'].includes(row.severity??''));
     const state=res.statusCode===200&&headers['x-pass']==='true'&&!errors&&(!headers['x-errors']||headers['x-errors']==='0')&&(!headers['x-document-type']||headers['x-document-type']==='eps')&&(!headers['x-document-profile']||headers['x-document-profile'].split('|')[0]===EPS_PROFILE)?'accepted':res.statusCode===200&&headers['x-pass']==='false'?'rejected':'unknown';
     resolve({state,headers,issues:outcome.issue.slice(0,200).map(row=>({severity:row.severity??'error',code:row.code??'invalid',expression:(row.expression??[]).filter(value=>typeof value==='string'&&value.length<300).slice(0,10)}))});
    }catch{reject(new Error());}
   });
  });
  const deadline=setTimeout(()=>req.destroy(new Error()),30000);req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.end(body);
 });
}
