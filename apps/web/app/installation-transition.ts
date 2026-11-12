import { clearClinicianSession,loadClinicianSession } from "./clinician-session";
import { lockProtectedClinicalStorage } from "./protected-clinical-storage";
import { clearProtectedRuntimeReports } from "./offline-reports";

import { INSTALLATION_TRANSITION_KEY, INSTALLATION_GENERATION_KEY, INSTALLATION_SESSION_HINT_KEY, InstallationContextChangedError } from "./installation-transition-generation";
export { INSTALLATION_TRANSITION_KEY } from "./installation-transition-generation";
export const INSTALLATION_TRANSITION_EVENT = "open-triage:installation-transition";
export const INSTALLATION_TRANSITION_COMPLETE_EVENT = "open-triage:installation-transition-complete";
const eventName = INSTALLATION_TRANSITION_EVENT;
const lockName = "open-triage.installation-clinical-context";

type NativeTransitionState = {configured:boolean; blocked?:boolean; replacementPending?:boolean; handoffPending?:boolean; connectionContext?:string; origin?:string; managedContext?:string};
/** Resume only an abandoned JS barrier, under the same exclusive lock as confirmation. */
export async function resumeNativeInstallationTransition<T extends NativeTransitionState>(state:T,reconcile:(context:string,purpose:"enrollment"|"logout")=>Promise<T>,isCurrent:()=>boolean=()=>true):Promise<T|null> {
 const marker=window.localStorage.getItem(INSTALLATION_TRANSITION_KEY);
 if(!marker||!state.configured||state.blocked||state.replacementPending||state.handoffPending)return state;
 if(marker.startsWith("handoff:"))return null;
 const generation=window.localStorage.getItem(INSTALLATION_GENERATION_KEY);
 const purpose=marker.startsWith("enrollment:")&&generation===marker?"enrollment":"logout";
 const matches=()=>isCurrent()&&window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)===marker&&window.localStorage.getItem(INSTALLATION_GENERATION_KEY)===generation;
 if(!navigator.locks||!state.connectionContext)return null;
 return navigator.locks.request(lockName,{mode:"exclusive",ifAvailable:true},async lock=>{
  if(!lock||!matches())return null;
  try {await lockProtectedClinicalStorage();} finally {clearProtectedRuntimeReports();}
  if(!matches())return null;
  clearClinicianSession(window.localStorage);
  if(purpose!=="enrollment")window.localStorage.removeItem(INSTALLATION_SESSION_HINT_KEY);
  const next=await reconcile(state.connectionContext!,purpose);
  if(!matches()||!next.configured||next.blocked||next.replacementPending||!next.connectionContext||next.origin!==state.origin||next.managedContext!==state.managedContext)return null;
  window.localStorage.removeItem(INSTALLATION_TRANSITION_KEY);
  window.dispatchEvent(new Event(INSTALLATION_TRANSITION_COMPLETE_EVENT));
  return next;
 });
}

/** A signed-in tab holds a shared barrier until its existing storage lifecycle has settled. */
export function participateInInstallationTransition(endContext: () => Promise<void>): () => void {
 const abort = new AbortController();
 let release = () => {}, ending = false;
 const end = () => {
  if (ending) return;
  ending = true;
  void endContext().finally(() => { release(); abort.abort(); });
 };
 const storage = (event: StorageEvent) => { if(event.key === INSTALLATION_TRANSITION_KEY && event.newValue) end(); };
 window.addEventListener("storage", storage);
 window.addEventListener(eventName, end);
 if(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)) end();
 else void navigator.locks.request(lockName,{mode:"shared",signal:abort.signal},async()=>{
  if(ending) return;
  await new Promise<void>(resolve=>{release=resolve;});
 }).catch(()=>{});
 return ()=>{
  window.removeEventListener("storage",storage);window.removeEventListener(eventName,end);
  if(ending) return; // The requested reassignment owns completion and release.
  ending=true;
  // A lifecycle teardown settles keys without mutating personal authentication.
  // In particular, development effect replay must never sign the clinician out.
  void lockProtectedClinicalStorage().catch(()=>{}).finally(()=>{clearProtectedRuntimeReports();release();abort.abort();});
 };
}

/** Common boundary for local and future federated login: no personal evidence is reused. */
export async function transitionInstallation<T>(replaceBinding: () => Promise<T>, purpose:"enrollment"|"logout"|"handoff"="logout"): Promise<T> {
 if(!navigator.locks) throw new Error("Secure cross-tab coordination is required");
 const generation=`${purpose}:${crypto.randomUUID()}`;
 const prior=purpose==="enrollment"?loadClinicianSession(window.localStorage):null;
 if(prior?.csrfToken){const candidate={...prior};delete candidate.accessToken;window.localStorage.setItem(INSTALLATION_SESSION_HINT_KEY,JSON.stringify({generation,session:candidate}));}
 else window.localStorage.removeItem(INSTALLATION_SESSION_HINT_KEY);
 window.localStorage.setItem(INSTALLATION_GENERATION_KEY,generation);
 window.localStorage.setItem(INSTALLATION_TRANSITION_KEY,generation);
 window.dispatchEvent(new Event(eventName));
 const requireOwnership=()=>{if(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)!==generation||window.localStorage.getItem(INSTALLATION_GENERATION_KEY)!==generation)throw new InstallationContextChangedError();};
 try {
  return await navigator.locks.request(lockName,{mode:"exclusive"},async()=>{
   requireOwnership();
   // The enrollment page may have no mounted clinician gate of its own.
   await lockProtectedClinicalStorage();
   requireOwnership();
   clearProtectedRuntimeReports();
   clearClinicianSession(window.localStorage);
   const result=await replaceBinding();
   const encoded=window.localStorage.getItem(INSTALLATION_SESSION_HINT_KEY);
   if(purpose==="enrollment"&&encoded&&window.localStorage.getItem(INSTALLATION_GENERATION_KEY)===generation){
    try {if(JSON.parse(encoded).generation===generation&&window.localStorage.getItem(INSTALLATION_SESSION_HINT_KEY)===encoded)window.localStorage.removeItem(INSTALLATION_SESSION_HINT_KEY);}catch{/* Malformed public candidates supply no authority. */}
   }
   return result;
  });
 } finally {
  if(window.localStorage.getItem(INSTALLATION_TRANSITION_KEY)===generation&&window.localStorage.getItem(INSTALLATION_GENERATION_KEY)===generation){
   window.localStorage.removeItem(INSTALLATION_TRANSITION_KEY);
   window.dispatchEvent(new Event(INSTALLATION_TRANSITION_COMPLETE_EVENT));
  }
 }
}
