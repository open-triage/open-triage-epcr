import {resolveMessage} from '../app/localization';
export type EpsPatientDemographics={name?:{family?:string;given?:string[];suffix?:string[]}[];birthDate?:string;gender?:string};
export function EpsPatientDemographicsView({patient,language}:{patient?:EpsPatientDemographics;language:string}){
 if(!patient)return null;
 const t=(key:string)=>resolveMessage(language,`epsSubmission.demographics.${key}`);
 const name=patient.name?.map(n=>[...(n.given??[]),n.family,...(n.suffix??[])].filter(Boolean).join(' ')).filter(Boolean).join('; ');
 return <section aria-label={t('title')}><h3>{t('title')}</h3><dl>
 <dt>{t('name')}</dt><dd>{name||resolveMessage(language,'eps.unknown')}</dd>
 <dt>{t('birthDate')}</dt><dd>{patient.birthDate||resolveMessage(language,'eps.unknown')}</dd>
 <dt>{t('gender')}</dt><dd>{patient.gender?t(`gender.${patient.gender}`):resolveMessage(language,'eps.unknown')}</dd>
 </dl></section>;
}
