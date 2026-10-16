"use client";
import {useEffect,useRef,useState} from "react";
import {useAdminError} from "../app/admin-localization";
import {resolveMessage} from "../app/localization";
import {unlinkAdminUserSso} from "../app/admin-context";
import {authenticationInstallationGeneration,assertAuthenticationInstallationGeneration} from "../app/installation-transition-generation";

export function UserSso({userId,revision,csrfToken,language,onComplete,onBusyChange,onDirtyChange}:{
 userId:string;revision:number;csrfToken:string;language:string;onComplete:()=>void;
 onBusyChange:(busy:boolean)=>void;onDirtyChange:(dirty:boolean)=>void;
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const mounted=useRef(true),adminError=useAdminError();
 const t=(key:string)=>resolveMessage(language,key);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusyChange(false);onDirtyChange(false);};},[onBusyChange,onDirtyChange]);
 return <form className="admin-sso-unlink" onSubmit={async event=>{
  event.preventDefault();if(busy)return;
  const generation=authenticationInstallationGeneration();
  const current=()=>{if(!mounted.current)return false;try{assertAuthenticationInstallationGeneration(generation);return true;}catch{return false;}};
  setBusy(true);onBusyChange(true);setError("");
  try{
   if(!current())return;
   
   await unlinkAdminUserSso(csrfToken,userId,revision);
   if(current()){onDirtyChange(false);onComplete();}
  }catch(reason){if(current()){setError(adminError(reason,"admin.ssoUnlinkFailed"));}}
  finally{if(current()){setBusy(false);onBusyChange(false);}}
 }}>
  <fieldset disabled={busy}><legend>{t("admin.ssoConnection")}</legend>
   {error&&<p className="admin-error" role="alert">{error}</p>}
   <button type="submit" className="button-danger" disabled={busy}>{t("admin.ssoUnlink")}</button>
  </fieldset>
 </form>;
}
