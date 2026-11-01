import type { EntityManager } from 'typeorm';
import { isDestinationSelection, destinationSelectionMatches, type CosConnectionSettings, type CosPayloadSettings, type DestinationEntry, type DestinationSelection } from '@open-triage/contracts';
import { effectiveSignedPdfOccurrences, type SignedReportClinicalSource } from '../reports/signed-report-pdf.js';
import { cosDestinationRequested } from './cos-destination.js';
export async function resolveCosExportContext(manager:Pick<EntityManager,'query'>,source:SignedReportClinicalSource,settings:CosConnectionSettings,options:{acceptDestinationRevision?:boolean;expectedDestinationRevision?:number}={}){
 const missing:string[]=[];
 const [report]=await manager.query<Array<{organization_id:string;group_id:string;cos_unit_id:string|null;status?:string;created_at:Date|string}>>(`select organization_id,app_identity.organization_group(organization_id) group_id,cos_unit_id,status,created_at from clinical.report where id=$1`,[source.reportId]);
 const signerId=source.amendments.at(-1)?.authorId??source.signerId;
 const [author]=report?await manager.query<Array<{userId:string;hsaId:string|null;revision:number;source:string|null;conflict:boolean}>>(`select id as "userId",hsa_id as "hsaId",revision,hsa_source source,hsa_conflict conflict from app_identity.app_user where id=$1 and app_identity.organization_group(organization_id)=$2`,[signerId,report.group_id]):[];
 if(!report)missing.push('reportContext');
 if(!author?.hsaId)missing.push('staff');if(author?.conflict)missing.push('staffConflict');
 // Signed versions must use their immutable pin. A pending signature is still a
 // draft, so resolve its one actual call unit before preparing immutable artifacts.
 let unitId=report?.cos_unit_id;
 if(report?.status==='draft'){
  const assignments=await manager.query<Array<{unit_id:string}>>(`select distinct unit_id from clinical.call_assignment
   where organization_id=$1 and report_id=$2`,[report.organization_id,source.reportId]);
  unitId=assignments.length===1?assignments[0]!.unit_id:null;
 }
 const [unit]=report&&unitId?await manager.query<Array<{id:string;rakelId:string|null;revision:number}>>(`select id,rakel_id as "rakelId",revision from app_identity.operational_unit where organization_id=$1 and id=$2`,[report.organization_id,unitId]):[];
 if(!unit?.rakelId)missing.push('rakel');
 const occurrences=effectiveSignedPdfOccurrences(source);
 const startedAt=report?.created_at?new Date(report.created_at).toISOString():null;
 let destination:DestinationEntry|undefined;
 let signedDestinationSelection:DestinationSelection|null=null;
 const resolvedSettings:CosPayloadSettings={...settings,authorHsaId:author?.hsaId&&!author.conflict?author.hsaId:null,destinationHsaId:null};
 if(cosDestinationRequested(occurrences)){
  const names=occurrences.filter(row=>row.element_id==='eDisposition.01');const codes=occurrences.filter(row=>row.element_id==='eDisposition.02');
  const name=names.length===1&&names[0]?.value_kind==='text'?String(names[0].value_text):'';
  const code=codes.length===1&&codes[0]?.value_kind==='text'?String(codes[0].value_text):'';
  const detail=names[0]?.provenance_detail as {destinationSelection?:DestinationSelection}|undefined;
  const selection=detail?.destinationSelection;
  signedDestinationSelection=selection??null;
  if(report&&isDestinationSelection(selection)&&destinationSelectionMatches(selection,name,code)){
   [destination]=await manager.query<DestinationEntry[]>(`select destination_id id,group_id as "groupId",revision,local_code as "localCode",display_name as "displayName",hsa_id as "hsaId",active from app_identity.destination_revision where group_id=$1 and destination_id=$2 and revision=$3`,[report.group_id,selection.directoryId,selection.revision]);
   if(destination&&(destination.displayName!==name||destination.localCode!==code))destination=undefined;
   // A stale or retired selection remains valid documentation, but needs explicit routing repair.
   const [current]=await manager.query<DestinationEntry[]>(`select id,group_id as "groupId",revision,local_code as "localCode",display_name as "displayName",hsa_id as "hsaId",active from app_identity.destination_directory where group_id=$1 and id=$2`,[report.group_id,selection.directoryId]);
   if(!current?.active||current.revision!==selection.revision){
    if(options.acceptDestinationRevision&&current?.active&&destination&&(options.expectedDestinationRevision===undefined||options.expectedDestinationRevision===current.revision))destination=current;
    else missing.push('destinationStale');
   }
   resolvedSettings.destinationHsaId=destination?.hsaId??null;
  }
  if(!resolvedSettings.destinationHsaId)missing.push('destination');
 }
 return {settings:resolvedSettings,context:{formatVersion:1 as const,author:author??null,unit:unit??null,destination:destination??null,signedDestinationSelection,destinationRepairApproved:options.acceptDestinationRevision===true,startedAt},missing};
}
