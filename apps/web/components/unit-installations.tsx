"use client";
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
 const [confirming,setConfirming]=useState<InstallationSummary|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 async function load(next?:string){setBusy(true);try{const page=await loadUnitInstallations(unitId,next);setItems(page.items);setCursor(page.nextCursor);setError(false);}catch(reason){if(listAccessRemoved(reason)){setItems([]);setCursor(null);setQr(null);setLink(null);}setError(true);}finally{setBusy(false);}}
 function close(){dialog.current?.close();setLink(null);setQr(null);setExpires(null);setConfirming(null);trigger.current?.focus();}
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
 <button className="button-primary" disabled={busy} onClick={async()=>{setBusy(true);try{
 const code=await issueUnitEnrollment(csrfToken,unitId);
 const url=`${code.origin}${process.env.NEXT_PUBLIC_BASE_PATH??""}/enroll/#code=${encodeURIComponent(code.token)}`;
 setLink(url);setExpires(code.expiresAt);setQr(await QRCode.toDataURL(url,{width:240,margin:2}));setError(false);
 }catch{setError(true);}finally{setBusy(false);}}}>{t("Issue five-minute QR code","Utfärda femminuters QR-kod")}</button>
 {qr&&link&&<><Image unoptimized src={qr} alt={t("Single-use enrollment QR code","QR-kod för engångskoppling")} width={240} height={240}/><p>{t("Expires","Giltig till")} {expires}</p>
 <label>{t("Enrollment link — open in the intended installation","Kopplingslänk — öppna i avsedd installation")}<input readOnly value={link} onFocus={e=>e.target.select()}/></label></>}
 <button type="button" onClick={close}>{t("Close","Stäng")}</button>
 </dialog></>;
}
