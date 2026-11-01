import {DESTINATION_NONE_CODE,selectDestination,type DestinationEntry,type EncounterDocument} from '@open-triage/contracts';
import {editScalarNotValue} from './stationary-scalar';
import {ensureNonRepeatingInstance,editNonRepeatingScalarValue} from './stationary-non-repeating';
/** Atomic paired selection; recommendations do not change NEMSIS scalar semantics. */
export function applyDestinationSelection(document:EncounterDocument,entry:DestinationEntry | "none" | undefined,groupId:string,groupInstanceId?:string,parentInstanceId?:string):EncounterDocument {
 if (entry === "none") {
  const existing = document.groups.find(group => group.id === groupId)?.instances.find(instance =>
   groupInstanceId ? instance.instanceId === groupInstanceId : !parentInstanceId || instance.parentInstanceId === parentInstanceId);
  const ensured = existing ? {document, instance: existing}
   : ensureNonRepeatingInstance(document, groupId, parentInstanceId, () => crypto.randomUUID());
  let next = ensured.document;
  for (const elementId of ['eDisposition.01', 'eDisposition.02']) {
   next = editScalarNotValue(next, {groupId, groupInstanceId: ensured.instance.instanceId, elementId, code: DESTINATION_NONE_CODE});
  }
  return next;
 }
 if (!entry) {
  const instance = document.groups.find(group => group.id === groupId)?.instances.find(instance =>
   groupInstanceId ? instance.instanceId === groupInstanceId : !parentInstanceId || instance.parentInstanceId === parentInstanceId);
  if (!instance) return document;
  let next = document;
  for (const elementId of ['eDisposition.01', 'eDisposition.02']) {
   const existing = instance.elements.find(element => element.id === elementId)?.values[0];
   if (!existing) continue;
   const result = editNonRepeatingScalarValue(next, {
    groupId, groupInstanceId: instance.instanceId, elementId, occurrenceId: existing.occurrenceId,
   }, '');
   if (!result.ok) return document;
   next = result.document;
  }
  return next;
 }
 const selected=selectDestination(entry);
 let next=document;
 let selectedInstanceId=groupInstanceId;
 for(const [elementId,input] of [['eDisposition.01',selected.name],['eDisposition.02',selected.code]] as const){
  const existing=next.groups.find(row=>row.id===groupId)?.instances.find(instance=>selectedInstanceId?instance.instanceId===selectedInstanceId:!parentInstanceId||instance.parentInstanceId===parentInstanceId)?.elements.find(row=>row.id===elementId)?.values[0];
  const result=editNonRepeatingScalarValue(next,{groupId,elementId,...(existing?{occurrenceId:existing.occurrenceId}:{}),...(selectedInstanceId?{groupInstanceId:selectedInstanceId}:{}),...(parentInstanceId?{parentInstanceId}:{})},input);
  if(!result.ok)return document;
  next=result.document;
  selectedInstanceId=next.groups.find(row=>row.id===groupId)?.instances.find(instance=>instance.elements.some(element=>element.values.some(value=>value.occurrenceId===result.occurrenceId)))?.instanceId;
 }
 return {...next,groups:next.groups.map(group=>group.id!==groupId?group:{...group,instances:group.instances.map(instance=>instance.instanceId!==selectedInstanceId?instance:{...instance,elements:instance.elements.map(element=>!['eDisposition.01','eDisposition.02'].includes(element.id)?element:{...element,values:element.values.map(value=>({...value,destinationSelection:selected.selection}))})})})};
}
