"use client";
import { createAndroidPairing } from "../app/android-pairing";
import { parseAndroidPairingQr, PairingQrError } from "../app/android-scanner";
import { resolveMessage } from "../app/localization";
import React,{useRef,useState} from "react";
import QRCode from "qrcode";
import Image from "next/image";
import { issueUnitEnrollment,loadUnitInstallations,revokeUnitInstallation } from "../app/admin-context";
import { listAccessRemoved } from "../app/list-refresh";
import type { InstallationSummary } from "../app/installation-enrollment";
export function UnitInstallations({unitId,unitName,csrfToken,language}:{unitId:string;unitName:string;csrfToken:string;language:string}) {
 const t=(en:string,sv:string)=>language==="sv"?sv:en;
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [items,setItems]=useState<InstallationSummary[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [qr,setQr]=useState<string|null>(null),[link,setLink]=useState<string|null>(null),[expires,setExpires]=useState<string|null>(null);
 const [caPem,setCaPem]=useState("");
 const [androidQr,setAndroidQr]=useState<string|null>(null),[qrError,setQrError]=useState<string|null>(null);
 const [code,setCode]=useState<{token:string;origin:string;expiresAt:string}|null>(null);
 const [confirming,setConfirming]=useState<InstallationSummary|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const qrGeneration=useRef(0);
 function clearAndroidQr(){qrGeneration.current++;setAndroidQr(null);setQrError(null);}
 async function showAndroidQr(){
 if(!code)return;const generation=++qrGeneration.current;setBusy(true);setAndroidQr(null);setQrError(null);
 try{const encoded=createAndroidPairing(code,caPem);parseAndroidPairingQr(encoded);const image=await QRCode.toDataURL(encoded,{width:512,margin:4,errorCorrectionLevel:"M"});if(generation===qrGeneration.current)setAndroidQr(image);}
 catch(reason){if(generation===qrGeneration.current)setQrError(reason instanceof PairingQrError && reason.code==="QR_TOO_LARGE"?"android.qrTooLarge":"android.pairingFailed");}
 finally{setBusy(false);}
 }
 async function load(next?:string){setBusy(true);try{const page=await loadUnitInstallations(unitId,next);setItems(page.items);setCursor(page.nextCursor);setError(false);}catch(reason){if(listAccessRemoved(reason)){setItems([]);setCursor(null);setQr(null);setLink(null);setCode(null);setCaPem("");clearAndroidQr();setExpires(null);}setError(true);}finally{setBusy(false);}}
 function close(){dialog.current?.close();setLink(null);setQr(null);setExpires(null);setCode(null);setCaPem("");clearAndroidQr();setConfirming(null);trigger.current?.focus();}
 return <><button ref={trigger} type="button" onClick={()=>{dialog.current?.showModal();void load();}}>{resolveMessage(language,"admin.unitDevices")}</button>
 <dialog ref={dialog} className="unit-dialog" aria-label={`${resolveMessage(language,"admin.unitDevices")} ${unitName}`} onCancel={e=>{e.preventDefault();close();}}>
 <h3>{unitName}: {resolveMessage(language,"admin.unitDevices")}</h3>
 <p>{t("Clearing site data or changing browser requires enrollment again. Old entries remain in the inventory. Pairing grants no clinician permissions.","Rensad webbplatsdata eller byte av webbläsare kräver ny koppling. Gamla poster behålls. Koppling ger inga kliniska behörigheter.")}</p>
 {error&&<p role="alert" className="admin-error">{t("Could not complete the action. Loaded inventory is retained.","Kunde inte slutföra åtgärden. Hämtade inventarier behålls.")}</p>}
 <div className="admin-table-scroll unit-installation-inventory"><table className="admin-table"><thead><tr><th>{t("Name","Namn")}</th><th>{t("Status","Status")}</th><th>{t("Actions","Åtgärder")}</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.revokedAt?t("Revoked","Återkallad"):t("Enrolled","Kopplad")}</td><td><button className="button-danger" disabled={busy||!!i.revokedAt} onClick={()=>setConfirming(i)}>{t("Revoke","Återkalla")} {i.name}</button></td></tr>)}</tbody></table></div>
 <p>{resolveMessage(language,"admin.unitRevocationEffect")}</p>
 {confirming&&<section aria-label={t("Confirm installation revocation","Bekräfta återkallelse av installation")}><p>{t("Revoke","Återkalla")} {confirming.name}?</p>
 <button className="button-danger" disabled={busy} onClick={async()=>{setBusy(true);try{await revokeUnitInstallation(csrfToken,unitId,confirming.id);setItems(rows=>rows.map(row=>row.id===confirming.id?{...row,revokedAt:new Date().toISOString()}:row));setConfirming(null);setError(false);}catch{setError(true);}finally{setBusy(false);}}}>{t("Confirm revocation","Bekräfta återkallelse")}</button>
 <button disabled={busy} onClick={()=>setConfirming(null)}>{t("Cancel","Avbryt")}</button></section>}
 <div className="admin-role-editor-actions"><button disabled={busy} onClick={()=>void load()}>{t("Refresh","Uppdatera")}</button><button disabled={busy||!cursor} onClick={()=>cursor&&void load(cursor)}>{t("Next page","Nästa sida")}</button></div>
 <button className="button-primary" disabled={busy} onClick={async()=>{const generation=++qrGeneration.current;setBusy(true);try{
 const code=await issueUnitEnrollment(csrfToken,unitId);
 const url=`${code.origin}${process.env.NEXT_PUBLIC_BASE_PATH??""}/enroll/#code=${encodeURIComponent(code.token)}`;
 const image=await QRCode.toDataURL(url,{width:240,margin:2});
 if(generation!==qrGeneration.current)return;
 setCode(code);setLink(url);setExpires(code.expiresAt);setAndroidQr(null);setQrError(null);setQr(image);setError(false);
 }catch{if(generation===qrGeneration.current)setError(true);}finally{setBusy(false);}}}>{t("Issue five-minute QR code","Utfärda femminuters QR-kod")}</button>
 {code&&<><label>{resolveMessage(language,"android.publicCa")}<textarea maxLength={48000} value={caPem} onChange={e=>{setCaPem(e.target.value);clearAndroidQr();}} /></label>
 <button type="button" disabled={busy} onClick={()=>{try{const blob=new Blob([createAndroidPairing(code,caPem)],{type:"application/json"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download="open-triage-pairing.json";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setError(false);}catch{setError(true);}}}>{resolveMessage(language,"android.downloadPairing")}</button></>}
 {code&&<><button type="button" disabled={busy} onClick={()=>void showAndroidQr()}>{resolveMessage(language,"android.showPairingQr")}</button>
 {qrError&&<p role="alert" className="admin-error">{resolveMessage(language,qrError)}</p>}
 {androidQr&&<figure className="unit-pairing-qr"><figcaption>{resolveMessage(language,"android.pairingQrAlt")}</figcaption><Image unoptimized src={androidQr} alt={resolveMessage(language,"android.pairingQrAlt")} width={512} height={512}/></figure>}</>}
 {qr&&link&&<><figure className="unit-pairing-qr"><figcaption>{resolveMessage(language,"enrollment.browserQrTitle")}</figcaption><Image unoptimized src={qr} alt={t("Single-use enrollment QR code","QR-kod för engångskoppling")} width={240} height={240}/></figure><p>{t("Expires","Giltig till")} {expires}</p>
 <label>{t("Enrollment link — open in the intended installation","Kopplingslänk — öppna i avsedd installation")}<input readOnly value={link} onFocus={e=>e.target.select()}/></label></>}
 <button type="button" onClick={close}>{t("Close","Stäng")}</button>
 </dialog></>;
}
