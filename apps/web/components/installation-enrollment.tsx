"use client";
import Link from "next/link";
import React,{useEffect,useState} from "react";
import { installationRequest, type InstallationSummary } from "../app/installation-enrollment";
export function InstallationEnrollment() {
 const [sv,setSv]=useState(false),[token,setToken]=useState(""),[name,setName]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [unit,setUnit]=useState<{unitName:string;callSign:string}|null>(null),[installation,setInstallation]=useState<InstallationSummary|null>(null);
 const [reassigned,setReassigned]=useState(false);
 const [transfer,setTransfer]=useState(false),[transferUrl,setTransferUrl]=useState("");
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[origin,setOrigin]=useState("");
 const t=(en:string,sw:string)=>sv?sw:en;
 useEffect(()=>{
 let active=true,revision=0;
 async function initialize(){
 const version=++revision;
 const code=new URLSearchParams(location.hash.slice(1)).get("code")??"";
 setToken(code);setSv(new URLSearchParams(location.search).get("language")==="sv");setOrigin(location.origin);
 setInstallation(null);setUnit(null);setReady(false);setConfirmed(false);setName("");setError(false);setTransfer(false);
 setTransferUrl(`${location.origin}${location.pathname}${location.search}#code=${encodeURIComponent(code)}`);
 // Remove enrollment secrets from history immediately; never submit until explicit confirmation.
 history.replaceState(null,"",location.pathname+location.search);
 try {
 const current=await installationRequest<{enrolled:boolean;installation?:InstallationSummary}>("current");
 if(!active||version!==revision)return;
 if(current.enrolled&&current.installation){setInstallation(current.installation);setName(current.installation.name);if(!code){setToken("");setTransferUrl("");setReady(true);return;}}
 if(code) {const preview=await installationRequest<{unitName:string;callSign:string}>("preview",{token:code});if(active&&version===revision)setUnit(preview);}
 if(active&&version===revision)setReady(true);
 }catch{if(active&&version===revision)setError(true);}
 }
 const changed=()=>void initialize();
 window.addEventListener("hashchange",changed);
 void Promise.resolve().then(()=>{if(active)void initialize();});
 return()=>{active=false;window.removeEventListener("hashchange",changed);};
 },[]);
 return <main className="admin-directory installation-enrollment"><h1>{t("Pair this installation","Koppla denna installation")}</h1>
 <p>{t("A registration identifies this browser or installed PWA, not the physical device.","En registrering identifierar denna webbläsare eller installerade PWA, inte den fysiska enheten.")} {origin}</p>
 <p>{t("If scanning opened a different browser, close this page and open the enrollment link in the intended OpenTriage browser or PWA. Nothing is paired automatically.","Om skanningen öppnade en annan webbläsare, stäng sidan och öppna länken i avsedd OpenTriage-webbläsare eller PWA. Ingen koppling sker automatiskt.")}</p>
 <p>{t("Pairing survives clinician logout and shift changes and grants no clinical permissions. Clearing site data or changing browser requires a new code; the old inventory entry remains.","Kopplingen behålls vid utloggning och skiftbyte och ger inga kliniska behörigheter. Rensad webbplatsdata eller byte av webbläsare kräver en ny kod; den gamla inventarieposten finns kvar.")}</p>
 {error&&<p className="admin-error" role="alert">{t("Enrollment failed. Request a new five-minute code and retry in the intended installation.","Kopplingen misslyckades. Begär en ny femminuterskod och försök i avsedd installation.")}</p>}
 {installation&&!unit?<p role="status">{t("This installation is enrolled:","Denna installation är kopplad:")} {installation.name}</p>:ready&&<form onSubmit={async event=>{
 event.preventDefault();setBusy(true);setError(false);
 try {const result=await installationRequest<InstallationSummary>("enroll",{token,name,confirmInstallation:confirmed,...(installation?{reassign:true}:{})});setReassigned(!!installation);setInstallation(result);setUnit(null);setToken("");setTransferUrl("");setTransfer(false);}
 catch {setError(true);}finally{setBusy(false);}
 }}>
 {unit&&<><button type="button" onClick={()=>{setTransfer(true);if(navigator.clipboard)void navigator.clipboard.writeText(transferUrl).catch(()=>{});}}>{t("Copy enrollment link for the intended installation","Kopiera kopplingslänk för avsedd installation")}</button>
 {transfer&&<label>{t("Copy this link, then open it in the intended browser or PWA","Kopiera länken och öppna den i avsedd webbläsare eller PWA")}<input readOnly value={transferUrl} onFocus={event=>event.target.select()}/></label>}</>}
 {installation&&unit&&<p role="alert">{t("Reassignment signs out every clinician tab. Pending encrypted reports retain their original author and recovery deadline. Sign in again after moving this installation.","Omplacering loggar ut alla klinikerflikar. Väntande krypterade rapporter behåller sin ursprungliga författare och återställningsfrist. Logga in igen efter omplaceringen.")}</p>}
 {unit?<p>{unit.unitName} — {unit.callSign}</p>:<p>{t("Open a new enrollment link from your administrator in this installation.","Öppna en ny kopplingslänk från administratören i denna installation.")}</p>}
 <label>{t("Installation name","Installationsnamn")}<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />{t("I confirm this is the intended browser or PWA installation.","Jag bekräftar att detta är avsedd webbläsare eller PWA-installation.")}</label>
 <button className="button-primary" disabled={busy||!unit||!confirmed||!name.trim()} type="submit">{installation?t("Reassign and sign out","Omplacera och logga ut"):t("Pair this installation","Koppla denna installation")}</button>
 </form>}
 {reassigned&&<p><Link href="/">{t("Sign in again to use the incoming unit","Logga in igen för att använda den nya enheten")}</Link></p>}
 </main>;
}
