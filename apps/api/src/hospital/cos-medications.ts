import {cosMedicationUnitIsRate,type CosMappingDefinition} from '@open-triage/contracts';
import type {SignedReportClinicalSource} from '../reports/signed-report-pdf.js';
import {clinicalContext,numeric,qualified,terminologyText} from './cos-clinical-context.js';
import {COS_ELEMENT_MAPPINGS} from './cos-vital-profiles.js';
import {CosFinding} from './cos-finding.js';
import type {CosProjectionFinding} from './cos-vitals.js';
/** COS's nested note structure, not a MedicationAdministration resource. */
export function buildCosMedications(source:SignedReportClinicalSource,mappings:NonNullable<CosMappingDefinition['medicationMappings']>){
 const items:Array<Record<string,unknown>>=[],findings:CosProjectionFinding[]=[],projectedGroupIds:string[]=[];
 const spec=COS_ELEMENT_MAPPINGS.medication;
 for(const mapping of mappings){
  for(const group of source.groups.filter(g=>g.group_id===mapping.groupId)){
   const descendants=new Set([group.id]);
   for(let pass=0;pass<source.groups.length;pass++){let added=false;for(const child of source.groups)if(child.parent_group_instance_id&&descendants.has(child.parent_group_instance_id)&&child.group_id!==mapping.groupId&&!descendants.has(child.id)){descendants.add(child.id);added=true;}if(!added)break;}
   const rows=source.occurrences.filter(row=>typeof row.group_instance_id==='string'&&descendants.has(row.group_instance_id));
   if(!rows.some(row=>[spec.name.source,spec.dose.source,spec.route.source,spec.unit.source].includes(row.element_id)&&!qualified(row)))continue;
   try{
    const one=(id:string)=>{const found=rows.filter(row=>row.element_id===id);if(found.length!==1||qualified(found[0]!))throw new CosFinding('clinicalValue');return found[0]!;};
    // Prior care and another administering unit are descriptive metadata, not export eligibility.
    // Apply the same dose, route, terminology and timing rules to every administration.
    const drug=one(spec.name.source),context=clinicalContext(source,drug,mapping.groupId);
    const dose=numeric(one(spec.dose.source)),unit=terminologyText(source,one(spec.unit.source));
    if(cosMedicationUnitIsRate(unit))throw new CosFinding('medicationRate');
    const children=[{linkId:spec.time.linkId,answer:[{valueDateTime:context.time}]},{linkId:spec.name.linkId,answer:[{valueString:terminologyText(source,drug)}]},
     {linkId:spec.dose.linkId,answer:[{valueDecimal:dose}]},{linkId:spec.unit.linkId,answer:[{valueString:unit}]},{linkId:spec.route.linkId,answer:[{valueString:terminologyText(source,one(spec.route.source))}]}];
    projectedGroupIds.push(group.id);items.push({linkId:spec.parent,answer:[{valueCoding:{system:'http://snomed.info/sct',code:spec.parent},item:children}]});
   }catch(error){if(!(error instanceof CosFinding))throw error;findings.push({mappingId:mapping.id,occurrenceId:group.id,code:error.code,coverage:'partial'});}
  }
 }
 return {items,findings,projectedGroupIds};
}
