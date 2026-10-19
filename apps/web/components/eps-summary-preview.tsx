import {narrativeText} from '@open-triage/contracts';
import {resolveMessage} from '../app/localization';
import {EpsPatientDemographicsView,type EpsPatientDemographics} from './eps-patient-demographics';
import {epsPreviewSections} from './eps-preview-sections';

export type EpsPreviewBundle={entry:{resource:EpsPatientDemographics & {
 resourceType:string;identifier?:{system?:string;value?:string}[];
 section?:{title:string;code?:{coding?:{code?:string}[]};emptyReason?:unknown;text:{div:string}}[];
}}[]};
const sectionKeys:Record<string,string>={'11450-4':'problems','48765-2':'allergies','10160-0':'medications','47519-4':'procedures','46264-8':'devices','81338-6':'patientStory','11329-0':'patientHistory'};
/** Both draft checklist and signed Review previews display the same export projection. */
export function EpsSummaryPreview({bundle,language}:{bundle:EpsPreviewBundle;language:string}){
 return <>
  <EpsPatientDemographicsView patient={bundle.entry.find(entry=>entry.resource.resourceType==='Patient')?.resource} language={language}/>
  <div className="eps-submission-narrative">{epsPreviewSections(bundle.entry.flatMap(entry=>entry.resource.section??[])).map((section,index)=>{
   const key=sectionKeys[section.code?.coding?.[0]?.code??''];
   return <section key={index}><h3>{key?resolveMessage(language,`hospital.outputSections.${key}`):section.title}</h3><p>{narrativeText(section.text.div)}</p></section>;
  })}</div>
 </>;
}
