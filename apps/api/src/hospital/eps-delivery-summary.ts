import type {EntityManager} from 'typeorm';
import {hospitalFieldId,type HospitalMappingDefinition} from '@open-triage/contracts';

type Finding={code:string;severity:string;mappingId?:string;expression?:string[]};
export type EpsDeliveryIssue={code:string;action:'edit'|'configuration';elementId?:string};
/** Map only known output paths; never guess a clinical field from arbitrary receiver text. */
export function epsDeliveryIssues(findings:Finding[],mapping:HospitalMappingDefinition):EpsDeliveryIssue[]{
 const issues=findings.filter(f=>['error','fatal'].includes(f.severity)&&!(f.code==='validationRequired'&&findings.some(other=>other.code!=='validationRequired'&&['error','fatal'].includes(other.severity)))).map(f=>{
  let field=f.mappingId?mapping.outputMappings?.find(m=>m.id===f.mappingId)?.source:undefined;
  let configuration=['login','forbidden','security','credentialUnavailable','configurationChanged','incompatibleMapping','outputMapping'].includes(f.code);
  if(f.code==='patientIdentifier')field=mapping.patientIdentifier.field;
  for(const expression of f.expression??[]){
   const path=expression.replace(/\/\*.*?\*\//g,'');
   if(!/^Bundle\.entry\[1\]\.resource\./.test(path))continue;
   const target=path.split('.resource.')[1]??'';
   if(/^identifier(?:\[\d+\])?\.system/.test(target)){configuration=true;continue;}
   if(/^identifier(?:\[\d+\])?(?:\.value)?$/.test(target))field=mapping.patientIdentifier.field;
   const section=/^birthDate/.test(target)?'patientBirthDate':/^gender/.test(target)?'patientGender':/^name\[0\]\.family/.test(target)?'patientFamily':/^name\[0\]\.given\[0\]/.test(target)?'patientGiven':/^name\[0\]\.suffix/.test(target)?'patientSuffix':undefined;
   if(section)field=mapping.outputMappings?.find(m=>m.section===section)?.source;
  }
  const elementId=field?hospitalFieldId(field):undefined;
  return {code:f.code,action:configuration||!elementId?'configuration' as const:'edit' as const,...(elementId?{elementId}:{})};
 });
 return [...new Map(issues.map(issue=>[JSON.stringify(issue),issue])).values()];
}
/** Operational metadata only; callers must authorize access to the report first. */
export async function epsDeliverySummary(manager:EntityManager,reportId:string){
 const [row]=await manager.query<Array<{state:'prepared'|'pending'|'accepted'|'rejected'|'unknown'|'draftChanged';findings:Finding[];issues:Finding[];mapping:{definition:HospitalMappingDefinition}}>>(`
  select case when signing.revision<>report.revision and (a.id is null or r.state in ('accepted','rejected')) then 'draftChanged' when a.id is null then 'prepared' when r.state is null and a.created_at>clock_timestamp()-interval '2 minutes' then 'pending' when r.state is null then 'unknown' else r.state end as state,
   s.validation->'findings' as findings,r.evidence->'issues' as issues,v.canonical_mapping as mapping
  from clinical.eps_submission s join clinical.report report on report.id=s.report_id
  left join clinical.signing_submission signing on signing.id=s.signing_submission_id left join clinical.eps_submission_attempt a on a.submission_id=s.id
  left join clinical.eps_submission_result r on r.attempt_id=a.id
  join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.configuration_revision
  where s.report_id=$1 order by s.created_at desc,s.id desc limit 1`,[reportId]);
 return row?{state:row.state,issues:epsDeliveryIssues([...(row.findings??[]),...(row.issues??[])],row.mapping.definition)}:null;
}
