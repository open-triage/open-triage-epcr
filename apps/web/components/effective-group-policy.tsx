"use client";
import type {UpdateAgencyMediaSettingsCommand} from "@open-triage/contracts";
import {resolveMessage} from "../app/localization";
export type EffectiveGroupPolicyDraft=NonNullable<UpdateAgencyMediaSettingsCommand["authenticationPolicy"]>;
const fields=["maximumSessionHours","temporaryPasswordHours","accountAttemptsPer15Minutes","networkAttemptsPer5Minutes"] as const;
const labels={maximumSessionHours:"admin.authenticationMaximumSessionHours",temporaryPasswordHours:"admin.authenticationTemporaryPasswordHours",accountAttemptsPer15Minutes:"admin.authenticationAccountAttemptsPer15Minutes",networkAttemptsPer5Minutes:"admin.authenticationNetworkAttemptsPer5Minutes"} as const;
export function validEffectiveGroupPolicy(value:EffectiveGroupPolicyDraft){return fields.every((field,index)=>Number.isSafeInteger(value[field])&&value[field]>=1&&value[field]<=(index<2?168:1000));}
export function EffectiveGroupPolicyFields({value,onChange,disabled,language}:{value:EffectiveGroupPolicyDraft;onChange:(value:EffectiveGroupPolicyDraft)=>void;disabled:boolean;language:string}){
 const t=(key:string)=>resolveMessage(language,key);
 return <fieldset className="authentication-policy" disabled={disabled}>
  <legend>{t("admin.authenticationEffectivePolicy")}</legend>
  {fields.map((field,index)=><label key={field} htmlFor={`auth-${field}`}>{t(labels[field])}
   <input id={`auth-${field}`} type="number" required min="1" max={index<2?168:1000} step="1" value={Number.isFinite(value[field])?value[field]:""} onChange={event=>onChange({...value,[field]:event.target.valueAsNumber})}/>
  </label>)}
 </fieldset>;
}
