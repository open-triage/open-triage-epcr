// Local synthetic payload preparation only. Never reads credentials or sends HTTP.
// Run after building the API: node --env-file=.env.local scripts/cos-sandbox-vitals.mjs
import { writeFileSync } from 'node:fs';
import { buildCosVitals } from '../apps/api/dist/hospital/cos-vitals.js';

const required=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const deliveryId='0f25a0cd-998c-48bb-8898-05e430fb1f7d';
const source={reportId:deliveryId,signedAt:required('COS_SANDBOX_MEASUREMENT_TIME'),amendments:[],groups:[{id:'vitals-1',group_id:'eVitals.VitalGroup',documented_time:required('COS_SANDBOX_MEASUREMENT_TIME')}],occurrences:[
  {id:'pulse',element_id:'eVitals.10',group_instance_id:'vitals-1',value_kind:'integer',value_integer:72},
  {id:'respiration',element_id:'eVitals.14',group_instance_id:'vitals-1',value_kind:'integer',value_integer:16},
  {id:'temperature',element_id:'eVitals.24',group_instance_id:'vitals-1',value_kind:'numeric',value_numeric:'36.7'},
]};
const mappings=[
  {id:'pulse',source:{kind:'nemsis',elementId:'eVitals.10'},vital:'heartRate',unit:'/min',linkId:'364075005'},
  {id:'respiration',source:{kind:'nemsis',elementId:'eVitals.14'},vital:'respiratoryRate',unit:'/min',linkId:'86290005'},
  {id:'temperature',source:{kind:'nemsis',elementId:'eVitals.24'},vital:'bodyTemperature',unit:'Cel',linkId:'276885007'},
];
const context={deliveryId,
  patient:{system:'urn:oid:1.2.752.129.2.1.3.1',value:required('COS_SANDBOX_PATIENT_IDENTIFIER')},
  // A new local contact identity, not an assertion that it exists in COSMIC.
  encounter:{system:'urn:opentriage:cos:sandbox:encounter',value:deliveryId},
  staff:required('COS_SANDBOX_PRACTITIONER_HSA_ID'),careUnit:required('COS_SANDBOX_CARE_UNIT_HSA_ID')};
const {items,entries,findings}=buildCosVitals(source,mappings,context,100);
if(findings.length)throw new Error('Synthetic vital projection is incomplete');
const path='/tmp/opentriage-cos-vitals-draft.json';
writeFileSync(path,JSON.stringify({status:'local-draft-not-submitted',
  outstanding:['Create/link this new prehospital contact','Verify receiver link IDs/template','Attach the signed PDF using the verified inline valueUri contract','Confirm stored note and document by read-back'],
  context,vitalMappings:mappings,questionnaireItems:items,bundleEntries:entries},null,2)+'\n',{mode:0o600});
console.log(`Prepared ${entries.length} synthetic observations using the COS exporter: ${path}`);
console.log('Draft fragment only; no credentials read and no request sent.');
