"use client";
import { DEFAULT_PAIRING_EXPIRY_MINUTES, MAX_PAIRING_EXPIRY_MINUTES } from "@open-triage/contracts";
import { createAndroidPairing } from "../app/android-pairing";
import { compactAndroidPairingQr } from "../app/android-pairing-qr";
import { PairingQrError } from "../app/android-scanner";
import { resolveMessage } from "../app/localization";
import React,{useRef,useState} from "react";
import QRCode from "qrcode";
import Image from "next/image";
import { issueUnitEnrollment,loadUnitInstallations,revokeUnitInstallation } from "../app/admin-context";
import { listAccessRemoved } from "../app/list-refresh";
import type { InstallationSummary } from "../app/installation-enrollment";
import { useReturnFocus } from "./use-return-focus";
export function UnitInstallations({unitId,unitName,csrfToken,language}:{unitId:string;unitName:string;csrfToken:string;language:string}) {
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [items,setItems]=useState<InstallationSummary[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [qr,setQr]=useState<string|null>(null),[link,setLink]=useState<string|null>(null),[expires,setExpires]=useState<string|null>(null);
 const [expiryMinutes,setExpiryMinutes]=useState(String(DEFAULT_PAIRING_EXPIRY_MINUTES));
 const [name,setName]=useState("");
 const [pairingFile,setPairingFile]=useState<string|null>(null);
 const validName=!!name.trim()&&name.length<=100&&!/[\u0000-\u001f\u007f]/u.test(name);
 const minutes=Number(expiryMinutes);
 const validExpiry=Number.isInteger(minutes)&&minutes>=1&&minutes<=MAX_PAIRING_EXPIRY_MINUTES;
 const [androidQr,setAndroidQr]=useState<string|null>(null),[qrError,setQrError]=useState<string|null>(null);
 const [qrTarget,setQrTarget]=useState<"browser"|"android">("browser");
 const [confirming,setConfirming]=useState<InstallationSummary|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const qrGeneration=useRef(0);
 const issueFocus=useRef<{element:HTMLButtonElement;generation:number}|null>(null);
 useReturnFocus(busy,busy,()=>{
 const pending=issueFocus.current;issueFocus.current=null;
 return pending?.generation===qrGeneration.current&&dialog.current?.open&&
 (document.activeElement===document.body||document.activeElement===dialog.current)?pending.element:null;
 });
 function clearAndroidQr(){qrGeneration.current++;setAndroidQr(null);setQrError(null);setPairingFile(null);}
 function clearIssuedPairing(){clearAndroidQr();setQr(null);setLink(null);setExpires(null);setError(false);}
 function downloadPairing(encoded:string){
 const url=URL.createObjectURL(new Blob([encoded],{type:"application/json"}));
 const anchor=document.createElement("a");anchor.href=url;anchor.download="open-triage-pairing.json";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function issue(target:"browser"|"android"){
 if(!validExpiry||!validName)return;
 const focused=document.activeElement instanceof HTMLButtonElement?document.activeElement:null;
 const generation=++qrGeneration.current;setBusy(true);setQrError(null);
 issueFocus.current=focused?{element:focused,generation}:null;
 try{
 const issued=await issueUnitEnrollment(csrfToken,unitId,minutes,name.trim());
 const url=`${issued.origin}${process.env.NEXT_PUBLIC_BASE_PATH??""}/enroll/#code=${encodeURIComponent(issued.token)}`;
 if(generation!==qrGeneration.current)return;
 setLink(url);setExpires(issued.expiresAt);setAndroidQr(null);setQr(null);setQrError(null);setQrTarget(target);setPairingFile(null);setError(false);
 const file=target==="android"?createAndroidPairing(issued,issued.caPem):null;
 setPairingFile(file);
 const encoded=file?await compactAndroidPairingQr(file):url;
 const image=await QRCode.toDataURL(encoded,target==="android"?{width:512,margin:4,errorCorrectionLevel:"M"}:{width:240,margin:2});
 if(generation!==qrGeneration.current)return;
 if(target==="android")setAndroidQr(image);else setQr(image);
 }catch(reason){if(generation===qrGeneration.current){
 if(target==="android")setQrError(reason instanceof PairingQrError && reason.code==="QR_TOO_LARGE"?"android.qrTooLarge":"android.pairingFailed");
 else setError(true);
 }}finally{if(generation===qrGeneration.current)setBusy(false);}
 }
 async function load(next?:string){setBusy(true);try{const page=await loadUnitInstallations(unitId,next);setItems(page.items);setCursor(page.nextCursor);setError(false);}catch(reason){if(listAccessRemoved(reason)){setItems([]);setCursor(null);setQr(null);setLink(null);clearAndroidQr();setQrTarget("browser");setExpires(null);}setError(true);}finally{setBusy(false);}}
 function close(){dialog.current?.close();setBusy(false);issueFocus.current=null;setLink(null);setQr(null);setExpires(null);clearAndroidQr();setQrTarget("browser");setConfirming(null);setName("");setExpiryMinutes(String(DEFAULT_PAIRING_EXPIRY_MINUTES));trigger.current?.focus();}
 return <><button ref={trigger} type="button" onClick={()=>{dialog.current?.showModal();void load();}}>{resolveMessage(language,"admin.unitDevices")}</button>
 <dialog ref={dialog} className="unit-dialog" aria-label={`${resolveMessage(language,"admin.unitDevices")} ${unitName}`} onCancel={e=>{e.preventDefault();close();}}>
 <h3>{unitName}: {resolveMessage(language,"admin.unitDevices")}</h3>
 {error&&<p role="alert" className="admin-error">{resolveMessage(language,"enrollment.actionFailed")}</p>}
 <div className="admin-table-scroll unit-installation-inventory"><table className="admin-table"><thead><tr><th>{resolveMessage(language,"enrollment.inventoryName")}</th><th>{resolveMessage(language,"enrollment.status")}</th><th>{resolveMessage(language,"enrollment.actions")}</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.revokedAt?resolveMessage(language,"enrollment.revoked"):resolveMessage(language,"enrollment.enrolled")}</td><td><button className="button-danger" disabled={busy||!!i.revokedAt} onClick={()=>setConfirming(i)}>{resolveMessage(language,"enrollment.revoke")} {i.name}</button></td></tr>)}</tbody></table></div>
 {confirming&&<section aria-label={resolveMessage(language,"enrollment.confirmRevocationTitle")}><p>{resolveMessage(language,"enrollment.revoke")} {confirming.name}?</p>
 <button className="button-danger" disabled={busy} onClick={async()=>{setBusy(true);try{await revokeUnitInstallation(csrfToken,unitId,confirming.id);setItems(rows=>rows.map(row=>row.id===confirming.id?{...row,revokedAt:new Date().toISOString()}:row));setConfirming(null);setError(false);}catch{setError(true);}finally{setBusy(false);}}}>{resolveMessage(language,"enrollment.confirmRevocation")}</button>
 <button disabled={busy} onClick={()=>setConfirming(null)}>{resolveMessage(language,"enrollment.cancel")}</button></section>}
 <div className="admin-role-editor-actions"><button disabled={busy} onClick={()=>void load()}>{resolveMessage(language,"enrollment.refresh")}</button><button disabled={busy||!cursor} onClick={()=>cursor&&void load(cursor)}>{resolveMessage(language,"enrollment.nextPage")}</button></div>
 <label>{resolveMessage(language,"enrollment.name")}<input required maxLength={100} value={name} disabled={busy} onChange={event=>{setName(event.target.value);clearIssuedPairing();}}/></label>
 <label>{resolveMessage(language,"enrollment.expiryMinutes")}<input type="number" min={1} max={MAX_PAIRING_EXPIRY_MINUTES} step={1} required value={expiryMinutes} disabled={busy} onChange={e=>{setExpiryMinutes(e.target.value);clearIssuedPairing();}}/></label>
 <div className="admin-role-editor-actions">
 <button type="button" disabled={busy||!validExpiry||!validName} aria-pressed={qrTarget==="android"&&!!androidQr} className={qrTarget==="android"&&androidQr?"button-primary":undefined} onClick={()=>void issue("android")}>{resolveMessage(language,"android.showPairingQr")}</button>
 <button type="button" disabled={busy||!validExpiry||!validName} aria-pressed={qrTarget==="browser"&&!!qr} className={qrTarget==="browser"&&qr?"button-primary":undefined} onClick={()=>void issue("browser")}>{resolveMessage(language,"enrollment.showBrowserQr")}</button>
 </div>
 {qrError&&<p role="alert" className="admin-error">{resolveMessage(language,qrError)}</p>}
 {qrTarget==="android"&&androidQr&&<figure className="unit-pairing-qr"><figcaption>{resolveMessage(language,"android.pairingQrAlt")}</figcaption><Image unoptimized src={androidQr} alt={resolveMessage(language,"android.pairingQrAlt")} width={512} height={512}/></figure>}
 {link&&<>{qrTarget==="browser"&&qr&&<figure className="unit-pairing-qr"><figcaption>{resolveMessage(language,"enrollment.browserQrTitle")}</figcaption><Image unoptimized src={qr} alt={resolveMessage(language,"enrollment.qrAlt")} width={240} height={240}/></figure>}<p>{resolveMessage(language,"enrollment.expires")} {expires}</p>
 {qrTarget==="browser"&&<label>{resolveMessage(language,"enrollment.link")}<input readOnly value={link} onFocus={e=>e.target.select()}/></label>}
 {qrTarget==="android"&&pairingFile&&<p><button type="button" disabled={busy} onClick={()=>downloadPairing(pairingFile)}>{resolveMessage(language,"enrollment.generateFile")}</button></p>}</>}
 <button type="button" onClick={close}>{resolveMessage(language,"enrollment.close")}</button>
 </dialog></>;
}
