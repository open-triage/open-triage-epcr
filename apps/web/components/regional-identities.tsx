"use client";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import type { AdminAssignableRoleSummary } from "@open-triage/contracts";
import React,{useCallback,useEffect,useRef,useState} from "react";
import { apiRequestUrl,browserRequestInit } from "../app/browser-api";
import { PersonalAuthenticationField,usePasswordAuthentication } from "./personal-authentication";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { platformRequestError } from "../app/platform-errors";
import { listAccessRemoved } from "../app/list-refresh";
import { activateListRow } from "./list-row-action";
import { useAvailableHeight } from "./use-available-height";
import { confirmDiscardChanges,useUnsavedChanges } from "./unsaved-changes";
type Identity={id:string;providerId:string;revision:number;issuer:string;subject:string;displayName:string|null;email:string|null;createdAt:string;status:string;linkedUserId:string|null;reviewProviders?:{source:"draft"|"active";revision:number}[]};
type User={id:string;displayName:string;username:string|null;owner:boolean;superadmin:boolean};
type Directory={items:Identity[];nextCursor:string|null};
async function request<T>(path:string,csrfToken:string,body?:unknown):Promise<T>{
 const url=apiRequestUrl(`/api/admin/${path}`);if(!url)throw new Error("Live API required");
 const response=await fetch(url,browserRequestInit(body?{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(body)}:{}));
 if(!response.ok)throw await platformRequestError(response);return response.json();
}
export function RegionalIdentitiesPanel({language,csrfToken,canLink,canApprove=false}:{language:string;csrfToken:string;canLink:boolean;canApprove?:boolean}){
 const needsPassword=usePasswordAuthentication();
 const text=useCallback((key:string)=>resolveMessage(language as AgencyLanguage,key),[language]);
 const [items,setItems]=useState<Identity[]>([]),[cursor,setCursor]=useState<string|null>(null),[currentCursor,setCurrentCursor]=useState<string>();
 const [selected,setSelected]=useState<Identity|null>(null),[users,setUsers]=useState<User[]>([]),[userCursor,setUserCursor]=useState<string|null>(null);
 const [search,setSearch]=useState(""),[userId,setUserId]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState<"link"|"approve">("link"),[displayName,setDisplayName]=useState(""),[roleIds,setRoleIds]=useState<string[]>([]),[roleOptions,setRoleOptions]=useState<AdminAssignableRoleSummary[]>([]),[providerSource,setProviderSource]=useState("draft"),[rolesLoaded,setRolesLoaded]=useState(false);
 const requestId=useRef(0),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement|null>(null),table=useAvailableHeight<HTMLDivElement>(100);
 const dirty=!!userId||!!password||!!displayName||!!roleIds.length;useUnsavedChanges(dirty);
 const load=useCallback(async(page?:string)=>{
  const version=++requestId.current;setBusy(true);
  try{const result=await request<Directory>(`authentication/identities${page?`?cursor=${page}`:""}`,csrfToken);if(version!==requestId.current)return;
   setItems(result.items);setCursor(result.nextCursor);setCurrentCursor(page);setError("");
  }catch(reason){if(version!==requestId.current)return;if(listAccessRemoved(reason)){setItems([]);setSelected(null);setUsers([]);}setError(text("admin.regionalIdentityRefreshFailedPreviouslyLoadedResults"));}
  finally{if(version===requestId.current)setBusy(false);}
 },[csrfToken,text]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal();},[selected]);
 function close(saved=false){if(!saved&&!confirmDiscardChanges(dirty))return;setSelected(null);setUserId("");setPassword("");setUsers([]);setSearch("");setDisplayName("");setRoleIds([]);requestAnimationFrame(()=>trigger.current?.focus());}
 async function loadUsers(page?:string){setBusy(true);try{
  const result=await request<{items:User[];nextCursor:string|null}>(`users?state=active&limit=25&search=${encodeURIComponent(search)}${page?`&cursor=${encodeURIComponent(page)}`:""}`,csrfToken);
  setUsers(result.items.filter(user=>!user.owner&&!user.superadmin));setUserCursor(result.nextCursor);setError("");
 }catch(reason){if(listAccessRemoved(reason)){setUsers([]);setSelected(null);setItems([]);}setError(text("admin.regionalIdentityCouldNotLoadUsersPreviously"));}finally{setBusy(false);}}
 function open(item:Identity,button:HTMLButtonElement){trigger.current=button;setSelected(item);setError("");setUserId("");setPassword("");setSearch("");setUserCursor(null);setMode(canLink?"link":"approve");setDisplayName("");setRoleIds([]);setRoleOptions([]);setRolesLoaded(false);setProviderSource(item.reviewProviders?.some(provider=>provider.source==="active")?"active":"draft");void loadUsers();
  if(canApprove)void request<{items:AdminAssignableRoleSummary[]}>("user-role-options",csrfToken).then(result=>{setRoleOptions(result.items);setRolesLoaded(true);}).catch(()=>setError(text("admin.regionalIdentityRolesLoadFailed")));}
 return <section className="admin-directory regional-identities" aria-labelledby="regional-identities-heading">
  <h3 id="regional-identities-heading">{text("admin.regionalIdentityRegionalIdentityRequests")}</h3>
  <p>{text("admin.regionalIdentityAValidatedRegionalIdentityRemains")}</p>
  {error&&<p className="admin-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
  <button type="button" disabled={busy} onClick={()=>void load(currentCursor)}>{text("admin.regionalIdentityRefreshRequests")}</button>
  <div className="admin-table-scroll" ref={table}><table className="admin-table"><thead><tr><th>{text("admin.regionalIdentityProfileHints")}</th><th>{text("admin.regionalIdentityIdentity")}</th><th>{text("admin.regionalIdentityStatus")}</th><th>{text("admin.regionalIdentityActions")}</th></tr></thead><tbody>
   {items.map(item=><tr key={item.id} className="admin-directory-row" onClick={event=>activateListRow(event)}>
    <td>{item.displayName??text("admin.regionalIdentityNoDisplayName")}<br/>{item.email??text("admin.regionalIdentityNoEmail")}</td>
    <td><span>{item.issuer}</span><br/><span>{item.subject}</span></td>
    <td>{item.status==="linked"?text("admin.regionalIdentityLinked"):text("admin.regionalIdentityPending")}{item.linkedUserId&&<><br/>{item.linkedUserId}</>}</td>
    <td><button data-list-row-action type="button" disabled={busy} aria-label={`${text("admin.regionalIdentityReview")} ${item.displayName??item.subject}`} onClick={event=>open(item,event.currentTarget)}>{text("admin.regionalIdentityReview")}</button></td>
   </tr>)}
  </tbody></table>{!items.length&&!busy&&<p>{text("admin.regionalIdentityNoRegionalIdentityRequests")}</p>}</div>
  <div className="admin-role-editor-actions"><button type="button" disabled={busy||!currentCursor} onClick={()=>void load()}>{text("admin.regionalIdentityFirstPage")}</button><button type="button" disabled={busy||!cursor} onClick={()=>cursor&&void load(cursor)}>{text("admin.regionalIdentityNextPage")}</button></div>
  {selected&&<dialog ref={dialog} className="unit-dialog regional-identity-dialog" aria-labelledby="identity-review-heading" onCancel={event=>{event.preventDefault();close();}}>
   <h3 id="identity-review-heading">{text("admin.regionalIdentityReviewRegionalIdentity")}</h3>
   <dl><dt>{text("admin.regionalIdentityIssuer")}</dt><dd>{selected.issuer}</dd><dt>{text("admin.regionalIdentitySubject")}</dt><dd>{selected.subject}</dd><dt>{text("admin.regionalIdentityIntegration")}</dt><dd>{selected.providerId} / {text("admin.regionalIdentityRevision")} {selected.revision}</dd><dt>{text("admin.regionalIdentityProfileHints")}</dt><dd>{selected.displayName??"—"} / {selected.email??"—"}</dd></dl>
   {selected.status==="linked"?<p>{text("admin.regionalIdentityLinkedToExistingUser")}: {selected.linkedUserId}</p>:canLink||canApprove?<><nav className="form-actions" aria-label={text("admin.regionalIdentityReviewAction")}>{canLink&&<button type="button" aria-pressed={mode==="link"} disabled={busy} onClick={()=>setMode("link")}>{text("admin.regionalIdentityChooseLink")}</button>}{canApprove&&<button type="button" aria-pressed={mode==="approve"} disabled={busy} onClick={()=>setMode("approve")}>{text("admin.regionalIdentityChooseApproval")}</button>}</nav><form onSubmit={async event=>{
    event.preventDefault();if(needsPassword&&!password||busy||mode==="link"&&!userId||mode==="approve"&&!displayName.trim())return;setBusy(true);setError("");
    try{await reauthenticateClinicianSession(password,csrfToken);setPassword("");const provider=selected.reviewProviders?.find(value=>value.source===providerSource);
    const linked=await request<Identity>(`authentication/identities/${selected.id}/${mode}`,csrfToken,mode==="link"?{userId,providerSource,expectedProviderRevision:provider?.revision}:{displayName,roleIds,providerSource,expectedProviderRevision:provider?.revision});setItems(current=>current.map(item=>item.id===linked.id?linked:item));setStatus(mode==="approve"?text("admin.regionalIdentityApproved"):text("admin.regionalIdentityIdentityLinkedUserRolesAnd"));close(true);}
    catch(reason){setPassword("");if(listAccessRemoved(reason)){setSelected(null);setUsers([]);setItems([]);}setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
   }}>
    {mode==="link"?<><label>{text("admin.regionalIdentityFindExistingUser")}<input type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <div className="form-actions"><button type="button" disabled={busy} onClick={()=>void loadUsers()}>{text("admin.regionalIdentitySearchUsers")}</button><button type="button" disabled={busy||!userCursor} onClick={()=>userCursor&&void loadUsers(userCursor)}>{text("admin.regionalIdentityMoreUsers")}</button></div>
    <label>{text("admin.regionalIdentityExistingApplicationUser")}<select required value={userId} disabled={busy} onChange={event=>setUserId(event.target.value)}><option value="">{text("admin.regionalIdentityChooseExplicitly")}</option>{userId&&!users.some(user=>user.id===userId)&&<option value={userId}>{userId}</option>}{users.map(user=><option key={user.id} value={user.id}>{user.displayName} ({user.username??text("admin.ssoOnly")}) — {user.id}</option>)}</select></label>
    <p>{text("admin.regionalIdentityConfirmThisIsTheSame")}</p>
    </>:<>
     <p>{text("admin.regionalIdentityApprovalHelp")}</p>
     <label>{text("admin.displayName")}<input required maxLength={200} value={displayName} onChange={event=>setDisplayName(event.target.value)} autoComplete="off"/></label>
     <fieldset className="admin-role-selection"><legend>{text("admin.completeRetainedRole")}</legend>{roleOptions.map(role=><label key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} disabled={busy||!role.active||!role.assignmentMutable} onChange={event=>setRoleIds(current=>event.target.checked?[...current,role.id]:current.filter(id=>id!==role.id))}/>{role.displayName}</label>)}</fieldset>
     <p>{text("admin.regionalIdentityEmptyRoles")}</p>
    </>}
     <label>{text("admin.regionalIdentityReviewProvider")}<select required value={providerSource} onChange={event=>setProviderSource(event.target.value)}>{selected.reviewProviders?.map(provider=><option key={provider.source} value={provider.source}>{text(provider.source==="active"?"admin.regionalIdentityActiveProvider":"admin.regionalIdentityDraftProvider")} — {text("admin.regionalIdentityRevision")} {provider.revision}</option>)}</select></label>
     {providerSource==="draft"&&<p className="admin-muted">{text("admin.regionalIdentityDraftProvider")}</p>}
    <PersonalAuthenticationField language={language} value={password} onChange={setPassword} label={mode==="approve"?text("admin.regionalIdentityApprovePassword"):text("admin.regionalIdentityYourPasswordToLinkIdentity")}/>
    {error&&<p className="admin-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button-primary" type="submit" disabled={busy||(needsPassword&&!password)||!selected.reviewProviders?.some(provider=>provider.source===providerSource)||(mode==="link"?!userId:!rolesLoaded||!displayName.trim()||!selected.reviewProviders?.some(provider=>provider.source===providerSource))}>{mode==="approve"?text("admin.regionalIdentityApproveNew"):text("admin.regionalIdentityLinkExistingUser")}</button></div>
   </form></>:<p>{text("admin.regionalIdentityUserManagementAndAuthenticationWrite")}</p>}
   <button type="button" disabled={busy} onClick={()=>close()}>{text("admin.regionalIdentityCloseReview")}</button>
  </dialog>}
 </section>;
}
