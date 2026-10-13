"use client";
import React,{useRef,useState} from "react";
import QRCode from "qrcode";
import Image from "next/image";
import { issueUnitEnrollment,loadUnitInstallations } from "../app/admin-context";
import { listAccessRemoved } from "../app/list-refresh";
import type { InstallationSummary } from "../app/installation-enrollment";
export function UnitInstallations({unitId,unitName,csrfToken,language}:{unitId:string;unitName:string;csrfToken:string;language:string}) {
 const t=(en:string,sv:string)=>language==="sv"?sv:en;
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [items,setItems]=useState<InstallationSummary[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [qr,setQr]=useState<string|null>(null),[link,setLink]=useState<string|null>(null),[expires,setExpires]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 async function load(next?:string){setBusy(true);try{const page=await loadUnitInstallations(unitId,next);setItems(page.items);setCursor(page.nextCursor);setError(false);}catch(reason){if(listAccessRemoved(reason)){setItems([]);setCursor(null);setQr(null);setLink(null);}setError(true);}finally{setBusy(false);}}
 function close(){dialog.current?.close();setLink(null);setQr(null);setExpires(null);trigger.current?.focus();}
 return <><button ref={trigger} type="button" onClick={()=>{dialog.current?.showModal();void load();}}>{t("Installations","Installationer")} {unitName}</button>
 <dialog ref={dialog} className="unit-dialog" aria-label={`${t("Installations","Installationer")} ${unitName}`} onCancel={e=>{e.preventDefault();close();}}>
 <h3>{unitName}: {t("Installations","Installationer")}</h3>
 <p>{t("Clearing site data or changing browser requires enrollment again. Old entries remain in the inventory. Pairing grants no clinician permissions.","Rensad webbplatsdata eller byte av webbläsare kräver ny koppling. Gamla poster behålls. Koppling ger inga kliniska behörigheter.")}</p>
 {error&&<p role="alert" className="admin-error">{t("Could not refresh or issue code. Loaded inventory is retained.","Kunde inte uppdatera eller utfärda kod. Hämtade inventarier behålls.")}</p>}
 <div className="admin-table-scroll unit-installation-inventory"><table className="admin-table"><thead><tr><th>{t("Name","Namn")}</th><th>{t("Status","Status")}</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.revokedAt?t("Revoked","Återkallad"):t("Enrolled","Kopplad")}</td></tr>)}</tbody></table></div>
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
