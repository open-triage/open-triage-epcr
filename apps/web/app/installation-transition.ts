import { clearClinicianSession } from "./clinician-session";
import { lockProtectedClinicalStorage } from "./protected-clinical-storage";
import { clearProtectedRuntimeReports } from "./offline-reports";

import { INSTALLATION_TRANSITION_KEY, INSTALLATION_GENERATION_KEY } from "./installation-transition-generation";
export { INSTALLATION_TRANSITION_KEY } from "./installation-transition-generation";
const eventName = "open-triage:installation-transition";
const lockName = "open-triage.installation-clinical-context";

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
export async function transitionInstallation<T>(replaceBinding: () => Promise<T>): Promise<T> {
 if(!navigator.locks) throw new Error("Secure cross-tab coordination is required");
 const generation=crypto.randomUUID();
 window.localStorage.setItem(INSTALLATION_GENERATION_KEY,generation);
 window.localStorage.setItem(INSTALLATION_TRANSITION_KEY,generation);
 window.dispatchEvent(new Event(eventName));
 try {
  return await navigator.locks.request(lockName,{mode:"exclusive"},async()=>{
   // The enrollment page may have no mounted clinician gate of its own.
   await lockProtectedClinicalStorage();
   clearProtectedRuntimeReports();
   clearClinicianSession(window.localStorage);
   return replaceBinding();
  });
 } finally { window.localStorage.removeItem(INSTALLATION_TRANSITION_KEY); }
}
