import type {ClinicalFormConfiguration,EncounterDocument,CosPatientComparison,CosSigningIssue} from '@open-triage/contracts';
import {getNemsisDataElement} from './nemsis-data-model';
import {editScalarOccurrence} from './stationary-scalar';
import {configuredStationaryCodedField,editStationaryCodedValue} from './stationary-coded-value';

export type CosIssueAction='patient'|'demographics'|'destination'|'clinical'|'notes'|'units'|'users'|'configuration'|'verify'|'retry'|'acknowledge';
const groups:Record<CosIssueAction,string[]>={
 patient:['patientIdentifier','identityConflict','patientCorrectionUnverified'],
 demographics:['patientIdentityConflict','patientRegistrationDemographics','patientRegistrationRejected'],
 destination:['destination','destinationStale','eligibility','noContact'],
 clinical:['clinicalValue','clinicalTime','clinicalGroup','clinicalCompanionMissing','clinicalTerminology','medicationRate','nonNrsPain','priorMedication','observationCorrectionUnverified'],
 notes:['pdfUnavailable'],
 units:['rakel'],users:['staff','staffConflict'],
 configuration:['patientNamespace','careUnit','simulatorLimit','versionUnavailable','configuration','configurationChanged','pdfMapping','clinicalMappingMissing','ambulanceCareUnit','credentialRejected','reportContext','encounterStart','authenticationUnavailable'],
 verify:['outcomeUnknown','reconciliationUnresolved','reconciliationUnsupported','liveUnverified','patientRegistrationUnverified','pdfJournalEmpty','pdfJournalUnavailable','pdfIdentityUnavailable','pdfNoteNotFound','pdfNoteAmbiguous','pdfNoteIdInvalid','pdfInclusionFailed','pdfDocumentAmbiguous','pdfDocumentMissing','referenceBindingUnavailable','rebuildAwaitingReconciliation'],
 retry:['outage','contactRejected','noteRejected','reconciledNotStored','artifactsReadyToResume','draftChanged','signingResume','inFlight','contactStored'],
 acknowledge:['clinicalProjectionIncomplete'],
};
export function cosIssueAction(issue:CosSigningIssue):CosIssueAction{
 return (Object.keys(groups) as CosIssueAction[]).find(action=>groups[action].includes(issue.code))??(issue.elementId||issue.groupId?'clinical':'verify');
}
export function cosIssueElement(issue:CosSigningIssue):string|undefined{
 if(issue.elementId)return issue.elementId;
 const action=cosIssueAction(issue);
 return action==='patient'?'ePatient.01':action==='demographics'?'ePatient.03':action==='destination'?'eDisposition.01':undefined;
}
/** Use normal clinical edit helpers: preserve occurrence IDs, validate values, clear obsolete qualifiers.
 * Caller checks the report revision and local document fingerprint before committing atomically. */
export function applyCosPatientComparison(document:EncounterDocument,form:ClinicalFormConfiguration,comparison:CosPatientComparison):EncounterDocument{
 if(!comparison.canApply)throw Error('cosSigning.comparisonUnavailable');
 let next=document;
 for(const change of comparison.changes){
  if(!['ePatient.02','ePatient.03','ePatient.04','ePatient.17','ePatient.25'].includes(change.elementId))throw Error('cosSigning.comparisonUnavailable');
  const definition=getNemsisDataElement(change.elementId),configured=form.catalogFields[change.elementId];
  const groupId=definition?.groupPath.at(-1),group=next.groups.find(g=>g.id===groupId);
  const fields=form.definition.sections.flatMap(s=>s.fields).filter(f=>f.source.kind==='nemsis'&&f.source.elementId===change.elementId);
  if(!definition||!configured||fields.length!==1||group?.instances.length!==1)throw Error('cosSigning.editManually');
  const instance=group.instances[0]!,elements=instance.elements.filter(e=>e.id===change.elementId),values=elements[0]?.values??[];
  if(elements.length>1||values.length>1)throw Error('cosSigning.editManually');
  const occurrenceId=values[0]?.occurrenceId;
  if(change.kind==='coded'&&change.elementId==='ePatient.25'){
   next=editStationaryCodedValue(next,{groupId:group.id,instanceId:instance.instanceId,elementId:change.elementId,occurrenceId,
    codedField:configuredStationaryCodedField(definition,configured)},{kind:'coded',code:change.value});
  }else{
   if(change.kind===(change.elementId==='ePatient.17'?'date':'text')){
    const edited=editScalarOccurrence(next,{groupId:group.id,groupInstanceId:instance.instanceId,elementId:change.elementId,occurrenceId,input:change.value});
    if(!edited.ok)throw Error('cosSigning.editManually');next=edited.document;
   }else throw Error('cosSigning.comparisonUnavailable');
  }
 }
 return next;
}


/** Only explicit projection coverage is acknowledgeable; identity and delivery failures remain blocking. */
export function cosIssueIsWarning(issue:CosSigningIssue):boolean{
 return issue.code==='clinicalProjectionIncomplete' ||
  issue.artifact==='context' && (issue.coverage==='partial'||issue.coverage==='note-pdf-only');
}
