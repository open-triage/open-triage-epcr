import type {CosSigningIssue} from '@open-triage/contracts';
import type {CosArtifact} from './cos-live-delivery.js';

/** Only call for report-authorized identifying views. Receiver diagnostics may contain patient data. */
export function cosReceiverIssues(a:Pick<CosArtifact,'kind'|'state'|'evidence'>):CosSigningIssue[]{
 if(a.state==='verified')return [];
 const issues:CosSigningIssue[]=[];
 for(const [code,response] of [[a.state==='rejected'?'receiverRejected':'receiverResponseUncertain',a.state==='rejected'||Number(a.evidence.responseEvidence?.httpStatus)>=400?a.evidence.responseEvidence:undefined],['receiverVerificationFailed',a.evidence.verificationFailure?.response]] as const){
  if(!response||!Number.isInteger(response.httpStatus)||response.httpStatus<100||response.httpStatus>599)continue;
  const details=(Array.isArray(response.issues)?response.issues:[]).slice(0,20)
   .filter((issue:any)=>issue&&['error','fatal'].includes(issue.severity))
   .flatMap((issue:any)=>[issue.diagnostics,issue.details,issue.code].filter((v:unknown)=>typeof v==='string'&&v.trim()).slice(0,1));
  const reason=[...new Set<string>(details)].join('; ').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2048);
  issues.push({code,artifact:a.kind,receiverError:{httpStatus:response.httpStatus,reason}});
 }
 return issues;
}

/** Bounded diagnostics stay in identifying report views, never operational summaries. */
export function cosSigningIssues(artifacts:CosArtifact[],manifest:unknown):CosSigningIssue[]{
 const source=(manifest??{}) as {occurrences?:Array<{id:string;element_id:string;group_instance_id:string}>;groups?:Array<{id:string;group_id:string}>};
 const issues:CosSigningIssue[]=[];
 for(const a of artifacts){
  issues.push(...cosReceiverIssues(a));
  const findings=Array.isArray(a.evidence.findings)?a.evidence.findings:Array.isArray(a.resource.findings)?a.resource.findings:[];
  const reason=a.state!=='verified'&&typeof a.evidence.reason==='string'&&/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(a.evidence.reason)?a.evidence.reason:null;
  for(const f of [...findings,...(reason&&!findings.some((f:{code:string})=>f?.code===reason)?[{code:reason}]:[])]){
   if(!f||typeof f.code!=='string'||! /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(f.code))continue;
   const occurrence=source.occurrences?.find(o=>o.id===f.occurrenceId);
   const group=source.groups?.find(g=>g.id===(occurrence?.group_instance_id??f.occurrenceId));
   issues.push({code:f.code,artifact:a.kind,...(a.kind==='context'&&['partial','note-pdf-only'].includes(f.coverage)?{coverage:f.coverage}:{}),...(typeof f.mappingId==='string'?{mappingId:f.mappingId.slice(0,100)}:{}),
    ...(occurrence?{occurrenceId:occurrence.id,elementId:occurrence.element_id}:{}),...(group?{groupId:group.group_id,groupInstanceId:group.id}:{})});
  }
 }
 return [...new Map(issues.map(issue=>[JSON.stringify(issue),issue])).values()];
}
