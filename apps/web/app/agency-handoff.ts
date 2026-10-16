import type {AuthenticatedSession} from '@open-triage/contracts';
import {apiRequestUrl,browserRequestInit} from './browser-api';
import {platformRequestError} from './platform-errors';
import {transitionInstallation} from './installation-transition';
import {storeClinicianSession} from './clinician-session';
import {resolveMessage} from './localization';
const intentKey='open-triage.agency-handoff.intent.v1';
async function request<T>(stage:string,body:unknown,csrf?:string):Promise<T>{
 const url=apiRequestUrl(`/api/sessions/agency-handoff/${stage}`);if(!url)throw new Error(resolveMessage(document.documentElement.lang,'admin.authenticationApiRequired'));
 const response=await fetch(url,browserRequestInit({method:'POST',headers:{'content-type':'application/json','x-agency-handoff':'1',...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(body)}));
 if(!response.ok)throw await platformRequestError(response);return response.json();
}
function random(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
async function hash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
/** Only eligible server-verified superusers can initiate a cross-host handoff. */
export async function startAgencyHandoff(organizationId:string,csrf:string):Promise<boolean>{
 const verifier=random();
 const result=await request<{transactionId?:string;targetUrl:string|null;targetOrigin?:string}>('start',{organizationId,verifierHash:await hash(verifier)},csrf);
 if(!result.targetUrl)return false;
 window.sessionStorage.setItem(intentKey,JSON.stringify({transactionId:result.transactionId,verifier,csrf,targetOrigin:result.targetOrigin,expiresAt:Date.now()+90000}));
 await transitionInstallation(async()=>{});
 window.location.assign(result.targetUrl);return true;
}
type Resume={redirecting:true}|{session:AuthenticatedSession}|null;
let pending:Promise<Resume>|undefined;
export function resumeAgencyHandoff():Promise<Resume>{
 if(pending)return pending;
 const params=new URLSearchParams(window.location.hash.slice(1)),stage=params.get('agencyHandoff');
 if(!stage)return Promise.resolve(null);
 window.history.replaceState(null,'',window.location.pathname+window.location.search);
 pending=(async()=>{
  const transactionId=params.get('transactionId');
  const fail=()=>new Error(resolveMessage(document.documentElement.lang,'platform.error.auth.agencyHandoffInvalid'));
  if(!transactionId)throw fail();
  if(stage==='prepare'){
   const result=await request<{sourceUrl:string}>('challenge',{transactionId});
   // Lock every target-host workspace before leaving its page. This preserves
   // opaque pending work while removing the previous user's in-memory keys.
   await transitionInstallation(async()=>{});
   window.location.assign(result.sourceUrl);return {redirecting:true} as const;
  }
  if(stage==='issue'){
   const raw=window.sessionStorage.getItem(intentKey);if(!raw)throw fail();
   const intent=JSON.parse(raw) as {transactionId:string;verifier:string;csrf:string;targetOrigin:string;expiresAt:number};
   if(intent.transactionId!==transactionId||intent.expiresAt<=Date.now())throw fail();
   const result=await request<{targetUrl:string}>('issue',{transactionId,verifier:intent.verifier,challengeHash:params.get('challengeHash')??''},intent.csrf);
   if(new URL(result.targetUrl).origin!==intent.targetOrigin)throw fail();
   window.sessionStorage.removeItem(intentKey);window.location.assign(result.targetUrl);return {redirecting:true} as const;
  }
  if(stage==='consume'){
   const session=await transitionInstallation(()=>request<AuthenticatedSession>('consume',{transactionId,code:params.get('code')??''}));
   storeClinicianSession(window.localStorage,session);return {session};
  }
  throw fail();
 })();return pending;
}
