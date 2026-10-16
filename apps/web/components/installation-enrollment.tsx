"use client";
import Link from "next/link";
import { resolveMessage } from "../app/localization";
import React,{useEffect,useState} from "react";
import { installationRequest, type InstallationSummary } from "../app/installation-enrollment";
export function InstallationEnrollment() {
 const [sv,setSv]=useState(false),[token,setToken]=useState(""),[name,setName]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [unit,setUnit]=useState<{unitName:string;callSign:string}|null>(null),[installation,setInstallation]=useState<InstallationSummary|null>(null);
 const [reassigned,setReassigned]=useState(false);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const t=(key:string)=>resolveMessage(sv?"sv":"en",key);
 useEffect(()=>{
 let active=true,revision=0;
 async function initialize(){
 const version=++revision;
 const code=new URLSearchParams(location.hash.slice(1)).get("code")??"";
 setToken(code);setSv(new URLSearchParams(location.search).get("language")==="sv");
 setInstallation(null);setUnit(null);setReady(false);setConfirmed(false);setName("");setError(false);
 // Remove enrollment secrets from history immediately; never submit until explicit confirmation.
 history.replaceState(null,"",location.pathname+location.search);
 try {
 const current=await installationRequest<{enrolled:boolean;installation?:InstallationSummary}>("current");
 if(!active||version!==revision)return;
 if(current.enrolled&&current.installation){setInstallation(current.installation);setName(current.installation.name);if(!code){setToken("");setReady(true);return;}}
 if(code) {const preview=await installationRequest<{unitName:string;callSign:string}>("preview",{token:code});if(active&&version===revision)setUnit(preview);}
 if(active&&version===revision)setReady(true);
 }catch{if(active&&version===revision)setError(true);}
 }
 const changed=()=>void initialize();
 window.addEventListener("hashchange",changed);
 void Promise.resolve().then(()=>{if(active)void initialize();});
 return()=>{active=false;window.removeEventListener("hashchange",changed);};
 },[]);
 return <main className="admin-directory installation-enrollment"><h1>{t("enrollment.title")}</h1>
 {error&&<p className="admin-error" role="alert">{t("enrollment.failed")}</p>}
 {installation&&!unit?<p role="status">{t("enrollment.paired")} {installation.name}</p>:ready&&unit&&<form onSubmit={async event=>{
 event.preventDefault();setBusy(true);setError(false);
 try {const result=await installationRequest<InstallationSummary>("enroll",{token,name,confirmInstallation:confirmed,...(installation?{reassign:true}:{})});setReassigned(!!installation);setInstallation(result);setUnit(null);setToken("");}
 catch {setError(true);}finally{setBusy(false);}
 }}>
 <p>{unit.unitName} — {unit.callSign}</p>
 <label>{t("enrollment.name")}<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />{t("enrollment.confirm")}</label>
 <button className="button-primary" disabled={busy||!confirmed||!name.trim()} type="submit">{t(installation?"enrollment.reassign":"enrollment.title")}</button>
 </form>}
 {ready&&!unit&&!installation&&<p role="status">{t("enrollment.missingCode")}</p>}
 {reassigned&&<p><Link href="/">{t("enrollment.signIn")}</Link></p>}
 </main>;
}
