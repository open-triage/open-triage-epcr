import assert from 'node:assert/strict';
import test from 'node:test';
import {applyDestinationSelection} from '../app/destination-selection';
import {editNonRepeatingScalarValue} from '../app/stationary-non-repeating';
import {encounterDocumentToDraftMutations} from '../app/draft-report';
import {deserializeEncounterDocument,serializeEncounterDocument} from '../app/encounter-document';
import synthetic from '../app/data/synthetic-encounter-document.json';
import {encounterDestinationDecision, DESTINATION_NONE_CODE, type EncounterDocument} from '@open-triage/contracts';
const entry={id:'00000000-0000-4000-8000-000000000001',groupId:'group',revision:2,displayName:'Hospital / emergency unit',localCode:'001-ED',hsaId:'HSA',active:true};
function selected(){
 const original=structuredClone(synthetic) as EncounterDocument;
 const document=applyDestinationSelection(original,entry,'eDisposition.DestinationGroup');
 const group=document.groups.find(group=>group.id==='eDisposition.DestinationGroup')!;
 const instance=group.instances[0]!;
 return {group,instance,document};
}
test('directory selection atomically records paired scalar strings and protected roundtrip provenance',()=>{
 const {document,group,instance}=selected();
 const elements=document.groups.find(row=>row.id===group.id)!.instances.find(row=>row.instanceId===instance.instanceId)!.elements;
 for(const [id,value] of [['eDisposition.01',entry.displayName],['eDisposition.02',entry.localCode]]){
  const selected=elements.find(row=>row.id===id)!.values[0]!;
  assert.equal(selected.kind,'scalar');if(selected.kind==='scalar')assert.equal(selected.value,value);
  assert.equal(selected.destinationSelection?.directoryId,entry.id);assert.equal(selected.destinationSelection?.revision,2);
 }
 const restored=deserializeEncounterDocument(serializeEncounterDocument(document));
 const mutations=encounterDocumentToDraftMutations('00000000-0000-4000-8000-000000000002',restored);
 for(const row of mutations.occurrences.filter(row=>['eDisposition.01','eDisposition.02'].includes(row.elementId))){
  assert.equal(row.value?.kind,'text');assert.deepEqual(row.provenanceDetail?.destinationSelection,{directoryId:entry.id,revision:2,displayName:entry.displayName,localCode:entry.localCode});
 }
});
test('manual destination text or local-code change clears both directory associations',()=>{
 for(const elementId of ['eDisposition.01','eDisposition.02']){
  const {document,group,instance}=selected();
  const edited=editNonRepeatingScalarValue(document,{groupId:group.id,groupInstanceId:instance.instanceId,elementId,occurrenceId:instance.elements.find(row=>row.id===elementId)!.values[0]!.occurrenceId},'Unlisted');
  assert.ok(edited.ok);
  const pair=edited.document.groups.find(row=>row.id===group.id)!.instances.find(row=>row.instanceId===instance.instanceId)!.elements.filter(row=>['eDisposition.01','eDisposition.02'].includes(row.id));
  assert.ok(pair.every(row=>row.values.every(value=>value.destinationSelection===undefined)));
 }
});

test('deleting a destination removes both values and provenance while retaining other fields', () => {
 const {document, group, instance} = selected();
 const cleared = applyDestinationSelection(document, undefined, group.id, instance.instanceId);
 const remaining = cleared.groups.find(row => row.id === group.id)!.instances.find(row => row.instanceId === instance.instanceId)!;
 assert.ok(remaining.elements.filter(row => ['eDisposition.01','eDisposition.02'].includes(row.id)).every(row => row.values.length === 0));
 assert.deepEqual(remaining.elements.filter(row => !['eDisposition.01','eDisposition.02'].includes(row.id)),
  instance.elements.filter(row => !['eDisposition.01','eDisposition.02'].includes(row.id)));
 const restored = deserializeEncounterDocument(serializeEncounterDocument(cleared));
 assert.equal(encounterDocumentToDraftMutations('00000000-0000-4000-8000-000000000002', restored).occurrences
  .filter(row => ['eDisposition.01','eDisposition.02'].includes(row.elementId)).length, 0);
 assert.deepEqual(applyDestinationSelection(cleared, undefined, group.id, instance.instanceId), cleared);
});

test('None persists an explicit answer without a directory association and supports delete and reselection', () => {
 const {document, group, instance} = selected();
 const getInstance = (doc: EncounterDocument) => doc.groups.find(row => row.id === group.id)!.instances[0]!;
 for (const initial of [document, {...document, groups: document.groups.filter(row => row.id !== group.id)}]) {
  const none = applyDestinationSelection(initial, 'none', group.id);
  const restored = deserializeEncounterDocument(serializeEncounterDocument(none));
  assert.equal(encounterDestinationDecision(getInstance(restored)), 'none');
  const mutations = encounterDocumentToDraftMutations('00000000-0000-4000-8000-000000000002', restored);
  const pair = mutations.occurrences.filter(row => ['eDisposition.01','eDisposition.02'].includes(row.elementId));
  assert.equal(pair.length, 2);
  assert.ok(pair.every(row => row.value?.kind === 'null' && row.value.absenceCode === DESTINATION_NONE_CODE));
  assert.ok(pair.every(row => !row.provenanceDetail?.destinationSelection));
  const cleared = applyDestinationSelection(restored, undefined, group.id, getInstance(restored).instanceId);
  assert.equal(encounterDestinationDecision(getInstance(cleared)), 'missing');
  const reselected = applyDestinationSelection(restored, entry, group.id, getInstance(restored).instanceId);
  assert.equal(encounterDestinationDecision(getInstance(reselected)), 'destination');
 }
});
