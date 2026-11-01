import { request } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { checkedAddress } from '../authentication/oidc-network.js';

export type FhirHttpResponse = {status:number;headers:IncomingHttpHeaders;body:string};
/** Shared EPS/COS transport. Resolve and pin a public address, never follow redirects,
 * bound both directions and redact network errors which can contain credentials. */
export async function requestFhirHttp(options:{url:string|URL;method:'GET'|'POST'|'PUT';headers:Record<string,string>;body?:string;timeoutMs?:number;maxResponseBytes?:number}):Promise<FhirHttpResponse>{
 try {
  const url=new URL(options.url),limit=options.maxResponseBytes??1024*1024,timeout=options.timeoutMs??30000;
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>8192||!['GET','POST','PUT'].includes(options.method)
   ||!Number.isSafeInteger(limit)||limit<1||limit>8*1024*1024||!Number.isSafeInteger(timeout)||timeout<1||timeout>60000
   ||options.body!==undefined&&Buffer.byteLength(options.body)>2*1024*1024)throw new Error();
  const address=await checkedAddress(url);
  return await new Promise<FhirHttpResponse>((resolve,reject)=>{
   const req=request(url,{method:options.method,agent:false,family:address.family,
    lookup:(_host,_options,callback)=>callback(null,address.address,address.family),
    headers:{...options.headers,...(options.body===undefined?{}:{'content-length':Buffer.byteLength(options.body)})}},res=>{
    if(!res.statusCode||res.statusCode>=300&&res.statusCode<400){res.resume();reject(new Error());return;}
    let size=0;const parts:Buffer[]=[];
    res.on('data',(part:Buffer)=>{size+=part.length;if(size>limit)req.destroy(new Error());else parts.push(part);});
    res.on('error',reject);res.on('aborted',()=>reject(new Error()));
    res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(parts).toString('utf8')}));
   });
   const deadline=setTimeout(()=>req.destroy(new Error()),timeout);
   req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.end(options.body);
  });
 }catch{throw new Error('FHIR transport failed');}
}

export type FhirOutcomeIssue={severity:string;code:string;expression:string[]};
/** Keep diagnostics and narrative out of operational evidence: they may contain PHI. */
export function fhirOutcomeIssues(value:unknown):FhirOutcomeIssue[]|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const outcome=value as Record<string,unknown>;
 if(outcome.resourceType!=='OperationOutcome'||!Array.isArray(outcome.issue)||!outcome.issue.length)return null;
 const issues:FhirOutcomeIssue[]=[];
 for(const raw of outcome.issue){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const row=raw as Record<string,unknown>;
  if(typeof row.severity!=='string'||!['fatal','error','warning','information'].includes(row.severity)||typeof row.code!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(row.code))return null;
  issues.push({severity:row.severity,code:row.code,expression:Array.isArray(row.expression)?row.expression.filter((x):x is string=>typeof x==='string'&&x.length<300).slice(0,10):[]});
 }
 return issues;
}
