import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,isAbsolute } from 'node:path';
import { EPS_DEPENDENCIES, EPS_PROFILE } from './eps-output.js';
const execute=promisify(execFile);
let running=0;
const jarChecks=new Map<string,Promise<boolean>>();
function pinnedJar(path:string){let check=jarChecks.get(path);if(!check){check=(async()=>{try{const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex')==='e3e50f06b806437821b7aef8189a1b790415cb96c5036e0812ed62981452b377';}catch{return false;}})();jarChecks.set(path,check);}return check;}
export type EpsValidation={engine:'hl7-validator-7.0.2'|'unavailable';state:'passed'|'failed'|'unavailable';dependencies:typeof EPS_DEPENDENCIES;issues:{severity:string;code:string;expression:string[]}[]};
/** Deployment-owned executable/JAR, no shell or user-supplied paths. This NEVER calls the publishing service. */
export async function validateEpsBundle(bundle:unknown):Promise<EpsValidation>{
 const base={dependencies:EPS_DEPENDENCIES,issues:[]};
 const java=process.env.EPS_VALIDATOR_JAVA,jar=process.env.EPS_VALIDATOR_JAR;
 if(!java||!jar||!isAbsolute(java)||!isAbsolute(jar)||!await pinnedJar(jar))return {...base,engine:'unavailable',state:'unavailable'};
 if(running>=1)return {...base,engine:'unavailable',state:'unavailable'};
 running++;
 let folder:string|undefined;
 try{
  folder=await mkdtemp(join(tmpdir(),'opentriage-eps-'));
  const input=join(folder,'bundle.json'),output=join(folder,'outcome.json');await writeFile(input,JSON.stringify(bundle),{mode:0o600});
  const cache=process.env.EPS_VALIDATOR_CACHE_HOME;
  const args=[...(cache&&isAbsolute(cache)?[`-Duser.home=${cache}`]:[]),'-Xmx768m','-jar',jar,input,'-version','4.0.1','-ig','hl7.fhir.eu.eps#1.0.0-ballot','-profile',EPS_PROFILE,'-tx','n/a','-output',output];
  // Validator returns nonzero for invalid clinical documents; read its structured outcome in either case.
  await execute(java,args,{timeout:120000,maxBuffer:1024*1024}).catch(()=>undefined);
  const result=JSON.parse(await readFile(output,'utf8')) as {resourceType?:string;issue?:Array<{severity?:string;code?:string;expression?:string[]}>};
  if(result.resourceType!=='OperationOutcome'||!Array.isArray(result.issue))throw new Error();
  const issues=result.issue.slice(0,200).map(row=>({severity:String(row.severity??'error'),code:String(row.code??'invalid'),expression:(row.expression??[]).filter(value=>typeof value==='string'&&value.length<300).slice(0,10)}));
  return {...base,engine:'hl7-validator-7.0.2',state:result.issue.some(row=>['fatal','error'].includes(row.severity??''))?'failed':'passed',issues};
 }catch{return {...base,engine:'unavailable',state:'unavailable'};}finally{running--;if(folder)await rm(folder,{recursive:true,force:true});}
}
