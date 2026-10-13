"use client";
import React,{useCallback,useEffect,useRef,useState} from "react";
import { apiRequestUrl,browserRequestInit } from "../app/browser-api";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { platformRequestError } from "../app/platform-errors";
import { listAccessRemoved } from "../app/list-refresh";
import { activateListRow } from "./list-row-action";
import { useAvailableHeight } from "./use-available-height";
import { confirmDiscardChanges,useUnsavedChanges } from "./unsaved-changes";
type Identity={id:string;providerId:string;revision:number;issuer:string;subject:string;displayName:string|null;email:string|null;createdAt:string;status:string;linkedUserId:string|null};
type User={id:string;displayName:string;username:string;owner:boolean;superadmin:boolean};
type Directory={items:Identity[];nextCursor:string|null};
async function request<T>(path:string,csrfToken:string,body?:unknown):Promise<T>{
 const url=apiRequestUrl(`/api/admin/${path}`);if(!url)throw new Error("Live API required");
 const response=await fetch(url,browserRequestInit(body?{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(body)}:{}));
 if(!response.ok)throw await platformRequestError(response);return response.json();
}
export function RegionalIdentitiesPanel({language,csrfToken,canLink}:{language:string;csrfToken:string;canLink:boolean}){
 const sv=language==="sv",text=useCallback((en:string,sw:string)=>sv?sw:en,[sv]);
 const [items,setItems]=useState<Identity[]>([]),[cursor,setCursor]=useState<string|null>(null),[currentCursor,setCurrentCursor]=useState<string>();
 const [selected,setSelected]=useState<Identity|null>(null),[users,setUsers]=useState<User[]>([]),[userCursor,setUserCursor]=useState<string|null>(null);
 const [search,setSearch]=useState(""),[userId,setUserId]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
 const requestId=useRef(0),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement|null>(null),table=useAvailableHeight<HTMLDivElement>(100);
 const dirty=!!userId||!!password;useUnsavedChanges(dirty);
 const load=useCallback(async(page?:string)=>{
  const version=++requestId.current;setBusy(true);
  try{const result=await request<Directory>(`authentication/identities${page?`?cursor=${page}`:""}`,csrfToken);if(version!==requestId.current)return;
   setItems(result.items);setCursor(result.nextCursor);setCurrentCursor(page);setError("");
  }catch(reason){if(version!==requestId.current)return;if(listAccessRemoved(reason)){setItems([]);setSelected(null);setUsers([]);}setError(text("Refresh failed. Previously loaded results are retained.","Uppdatering misslyckades. Tidigare resultat behålls."));}
  finally{if(version===requestId.current)setBusy(false);}
 },[csrfToken,text]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal();},[selected]);
 function close(saved=false){if(!saved&&!confirmDiscardChanges(dirty))return;setSelected(null);setUserId("");setPassword("");setUsers([]);setSearch("");requestAnimationFrame(()=>trigger.current?.focus());}
 async function loadUsers(page?:string){setBusy(true);try{
  const result=await request<{items:User[];nextCursor:string|null}>(`users?state=active&limit=25&search=${encodeURIComponent(search)}${page?`&cursor=${encodeURIComponent(page)}`:""}`,csrfToken);
  setUsers(result.items.filter(user=>!user.owner&&!user.superadmin));setUserCursor(result.nextCursor);setError("");
 }catch(reason){if(listAccessRemoved(reason)){setUsers([]);setSelected(null);setItems([]);}setError(text("Could not load users. Previously loaded choices are retained.","Kunde inte läsa in användare. Tidigare alternativ behålls."));}finally{setBusy(false);}}
 function open(item:Identity,button:HTMLButtonElement){trigger.current=button;setSelected(item);setError("");setUserId("");setPassword("");setSearch("");setUserCursor(null);void loadUsers();}
 return <section className="admin-directory regional-identities" aria-labelledby="regional-identities-heading">
  <h3 id="regional-identities-heading">{text("Regional identity requests","Regionala identitetsförfrågningar")}</h3>
  <p>{text("A validated regional identity remains pending until reviewed. Profile names and emails are untrusted hints; matching emails never merge accounts. Linking preserves the existing user’s roles and history. A provider test grants no application session.","En validerad regional identitet väntar på granskning. Profilnamn och e-post är obetrodda ledtrådar; matchande e-post slår aldrig samman konton. Länkning bevarar användarens roller och historik. Leverantörstest ger ingen applikationssession.")}</p>
  {error&&<p className="admin-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  <button type="button" disabled={busy} onClick={()=>void load(currentCursor)}>{text("Refresh requests","Uppdatera förfrågningar")}</button>
  <div className="admin-table-scroll" ref={table}><table className="admin-table"><thead><tr><th>{text("Profile hints","Profilledtrådar")}</th><th>{text("Identity","Identitet")}</th><th>{text("Status","Status")}</th><th>{text("Actions","Åtgärder")}</th></tr></thead><tbody>
   {items.map(item=><tr key={item.id} className="admin-directory-row" onClick={event=>activateListRow(event)}>
    <td>{item.displayName??text("No display name","Inget visningsnamn")}<br/>{item.email??text("No email","Ingen e-post")}</td>
    <td><span>{item.issuer}</span><br/><span>{item.subject}</span></td>
    <td>{item.status==="linked"?text("Linked","Länkad"):text("Pending","Väntande")}{item.linkedUserId&&<><br/>{item.linkedUserId}</>}</td>
    <td><button data-list-row-action type="button" disabled={busy} aria-label={`${text("Review","Granska")} ${item.displayName??item.subject}`} onClick={event=>open(item,event.currentTarget)}>{text("Review","Granska")}</button></td>
   </tr>)}
  </tbody></table>{!items.length&&!busy&&<p>{text("No regional identity requests.","Inga regionala identitetsförfrågningar.")}</p>}</div>
  <div className="admin-role-editor-actions"><button type="button" disabled={busy||!currentCursor} onClick={()=>void load()}>{text("First page","Första sidan")}</button><button type="button" disabled={busy||!cursor} onClick={()=>cursor&&void load(cursor)}>{text("Next page","Nästa sida")}</button></div>
  {selected&&<dialog ref={dialog} className="unit-dialog regional-identity-dialog" aria-labelledby="identity-review-heading" onCancel={event=>{event.preventDefault();close();}}>
   <h3 id="identity-review-heading">{text("Review regional identity","Granska regional identitet")}</h3>
   <dl><dt>{text("Issuer","Utfärdare")}</dt><dd>{selected.issuer}</dd><dt>{text("Subject","Subjekt")}</dt><dd>{selected.subject}</dd><dt>{text("Integration","Integration")}</dt><dd>{selected.providerId} / {text("Revision","Version")} {selected.revision}</dd><dt>{text("Profile hints","Profilledtrådar")}</dt><dd>{selected.displayName??"—"} / {selected.email??"—"}</dd></dl>
   {selected.status==="linked"?<p>{text("Linked to existing user","Länkad till befintlig användare")}: {selected.linkedUserId}</p>:canLink?<form onSubmit={async event=>{
    event.preventDefault();if(!userId||!password||busy)return;setBusy(true);setError("");
    try{await reauthenticateClinicianSession(password,csrfToken);setPassword("");const linked=await request<Identity>(`authentication/identities/${selected.id}/link`,csrfToken,{userId});setItems(current=>current.map(item=>item.id===linked.id?linked:item));setStatus(text("Identity linked. User roles and history are preserved; the test grants no application access.","Identiteten är länkad. Användarroller och historik bevaras; testet ger ingen applikationsåtkomst."));close(true);}
    catch(reason){setPassword("");if(listAccessRemoved(reason)){setSelected(null);setUsers([]);setItems([]);}setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
   }}>
    <label>{text("Find existing user","Sök befintlig användare")}<input type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <div className="form-actions"><button type="button" disabled={busy} onClick={()=>void loadUsers()}>{text("Search users","Sök användare")}</button><button type="button" disabled={busy||!userCursor} onClick={()=>userCursor&&void loadUsers(userCursor)}>{text("More users","Fler användare")}</button></div>
    <label>{text("Existing application user","Befintlig applikationsanvändare")}<select required value={userId} disabled={busy} onChange={event=>setUserId(event.target.value)}><option value="">{text("Choose explicitly","Välj uttryckligen")}</option>{userId&&!users.some(user=>user.id===userId)&&<option value={userId}>{userId}</option>}{users.map(user=><option key={user.id} value={user.id}>{user.displayName} ({user.username}) — {user.id}</option>)}</select></label>
    <p>{text("Confirm this is the same person before linking. Installation recovery accounts cannot be linked here.","Bekräfta att det är samma person innan länkning. Installationens återställningskonton kan inte länkas här.")}</p>
    <label>{text("Your password to link identity","Ditt lösenord för att länka identitet")}<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>
    {error&&<p className="admin-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button-primary" type="submit" disabled={busy||!userId||!password}>{text("Link existing user","Länka befintlig användare")}</button></div>
   </form>:<p>{text("User management and authentication write permissions are required to link.","Skrivbehörighet för användare och autentisering krävs för länkning.")}</p>}
   <button type="button" disabled={busy} onClick={()=>close()}>{text("Close review","Stäng granskning")}</button>
  </dialog>}
 </section>;
}
