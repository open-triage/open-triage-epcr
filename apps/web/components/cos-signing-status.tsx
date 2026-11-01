"use client";
import {cosReceiverIssueMessage} from '../app/cos-receiver-issue';
import {useEffect,useState,useRef,useCallback,type ReactNode} from 'react';
import type {CosPatientComparison,CosSigningIssue} from '@open-triage/contracts';
import type {AgencyLanguage} from '../app/localization';
import {resolveMessage} from '../app/localization';
import type {SigningStatus} from '../app/draft-report';
import {cosIssueAction,cosIssueIsWarning, type CosIssueAction} from '../app/cos-signing-actions';

export function CosSigningStatus({language,status,busy,onAcknowledge,onRetry,onEdit,onConfigure,canConfigure=[],onCompare,onApply,canCompare=false,documentKey='',editor,onAcknowledgementChange}: {
 language:AgencyLanguage;status:SigningStatus;busy:boolean;onAcknowledge:()=>void;
 onRetry?:()=>void;onEdit?:(issue:CosSigningIssue)=>void;onConfigure?:(kind:'units'|'users'|'configuration')=>void;
 canConfigure?:string[];onCompare?:()=>Promise<CosPatientComparison>;onApply?:(comparison:CosPatientComparison)=>void;
 canCompare?:boolean;documentKey?:string;editor?:ReactNode;onAcknowledgementChange?:(acknowledged:boolean)=>void;
}){
 const [comparison,setComparison]=useState<CosPatientComparison|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[copied,setCopied]=useState(false);
 const [acknowledgements,setAcknowledgements]=useState<{key:string;values:Record<string,boolean>}>({key:'',values:{}});
 const comparisonEpoch=useRef(0);
 const [verifiedComparison,setVerifiedComparison]=useState<{deliveryId:string|undefined;key:string}|null>(null);
 const comparisonKey=JSON.stringify([status.deliveryId,documentKey]);
 // A submitted conflict is historical. Once the draft matched COS, do not
 // redisplay that old error while a changed draft awaits its fresh comparison.
 const patientResolved=verifiedComparison?.deliveryId===status.deliveryId&&verifiedComparison!==null;
 const patientVerified=patientResolved&&verifiedComparison.key===comparisonKey;
 const t=(key:string,params?:Record<string,string|number>)=>resolveMessage(language,key,params);
 const finding=status.finding;
 const message=(code:string)=>{for(const key of [`cosSigning.issue.${code}`,`cosDelivery.finding.${code}`,`cosDelivery.projection.${code}`]){const value=t(key);if(value!==key)return value;}return t('cosSigning.unknownIssue');};
 const detailed:CosSigningIssue[]=status.issues??status.findings?.map(code=>({code}))??[];
 const issues:CosSigningIssue[]=[...(finding&&!detailed.some(issue=>issue.code===finding)&&!['clinicalProjectionIncomplete','inFlight','contactStored','signingResume','draftChanged'].includes(finding)?[{code:finding}]:[]),...detailed];
 if(finding==='clinicalProjectionIncomplete'&&!issues.some(cosIssueIsWarning))issues.push({code:'clinicalProjectionIncomplete'});
 const currentIssues=issues.filter(issue=>!patientResolved||issue.code!=='patientIdentityConflict');
 // Specific blocking issues explain the aggregate failure; coverage warnings do not.
 const hasSpecificFailure=currentIssues.some(issue=>issue.code!=='reconciliationUnresolved'&&!cosIssueIsWarning(issue)&&(issue.receiverError||message(issue.code)!==t('cosSigning.unknownIssue')));
 const unique=[...new Map(currentIssues.filter(issue=>issue.code!=='reconciliationUnresolved'||
  !(hasSpecificFailure||patientResolved&&!currentIssues.some(other=>other.code!=='reconciliationUnresolved'&&!cosIssueIsWarning(other)))).map(issue=>[JSON.stringify(issue),issue])).values()];
 const needsVerification=unique.some(issue=>cosIssueAction(issue)==='verify')||
  hasSpecificFailure&&currentIssues.some(issue=>issue.code==='reconciliationUnresolved');
 const warningKeys=unique.filter(cosIssueIsWarning).map(issue=>JSON.stringify(issue));
 // Delivery IDs and submitted revisions change during retries without changing
 // the reviewed draft. Only changed content or warning details invalidate consent.
 const acknowledgementKey=JSON.stringify([documentKey,warningKeys]);
 const allAcknowledged=warningKeys.length>0&&acknowledgements.key===acknowledgementKey&&warningKeys.every(key=>acknowledgements.values[key]);
 useEffect(()=>{onAcknowledgementChange?.(allAcknowledged);},[onAcknowledgementChange,allAcknowledged,acknowledgementKey]);
 const callbacks=useRef({onCompare,onApply});
 useEffect(()=>{callbacks.current={onCompare,onApply};},[onCompare,onApply]);
 const patientConflict=status.status==='awaiting-cos' && (status.finding==='patientIdentityConflict' ||
  status.issues?.some(issue=>issue.code==='patientIdentityConflict') || status.findings?.includes('patientIdentityConflict'));
 const comparisonScope=useRef<string|null>(null);
 const compare=async(apply=false)=>{
  const read=callbacks.current.onCompare;
  if(!read)return;
  const epoch=comparisonEpoch.current;
  setLoading(true);setError(null);
  try{
   const result=await read();
   if(epoch!==comparisonEpoch.current)return;
   setVerifiedComparison(result.matches===true?{deliveryId:status.deliveryId,key:comparisonKey}:null);
   if(apply&&result.canApply){callbacks.current.onApply?.(result);setComparison(null);}
   else setComparison(result);
  }catch{if(epoch===comparisonEpoch.current){setVerifiedComparison(null);setError(t('cosSigning.comparisonUnavailable'));}}
  finally{if(epoch===comparisonEpoch.current)setLoading(false);}
 };
 const invalidateComparison=useCallback(()=>{comparisonEpoch.current++;},[]);
 useEffect(()=>{
  const scope=comparisonKey;
  const changed=comparisonScope.current!==scope;
  comparisonScope.current=scope;
  const epoch=++comparisonEpoch.current;
  // Signing temporarily disables actions; it does not change the patient that
  // was verified. Retain that proof while the command/status request is pending.
  void Promise.resolve().then(()=>{
   if(epoch!==comparisonEpoch.current)return;
   if(changed){setComparison(null);setError(null);}
   setLoading(false);
   if(patientConflict&&canCompare&&!busy&&(changed||!patientVerified))void compare();
  });
  return invalidateComparison;
  // Callback identities change on status polling; only the draft and readiness invalidate this lookup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[status.deliveryId,documentKey,patientConflict,canCompare,busy,invalidateComparison]);
 if(status.status!=='awaiting-cos')return null;
 const copy=async()=>{try{await navigator.clipboard.writeText(JSON.stringify({deliveryId:status.deliveryId,revision:status.revision,state:status.deliveryState,issues:unique.map(issue=>({...issue,receiverError:undefined})),context:status.context},null,2));setCopied(true);}catch{setError(t('cosSigning.copyFailed'));}};
 const actionButton=(action:CosIssueAction,issue:CosSigningIssue)=>{
  if(action==='acknowledge'||action==='verify'||issue.code==='patientIdentityConflict')return null;
  if(['units','users','configuration'].includes(action))return canConfigure.includes(action)&&onConfigure
   ?<button type="button" disabled={busy} onClick={()=>onConfigure(action as 'units'|'users'|'configuration')}>{t(`cosSigning.action.${action}`)}</button>
   :<><span>{t('cosSigning.administratorRequired')}</span><button type="button" onClick={()=>void copy()}>{t('cosSigning.copyDetails')}</button></>;
  if(action==='retry')return onRetry?<button type="button" disabled={busy} onClick={onRetry}>{t(`cosSigning.action.${action}`)}</button>:null;
  return onEdit?<button type="button" disabled={busy} onClick={()=>onEdit(issue)}>{t(`cosSigning.action.${action}`)}</button>:null;
 };
 return <section className="review-group cos-signing-status" aria-label={t('cosSigning.heading')}>
  <h2>{t('cosSigning.heading')}</h2>
  <p role="status">{t(busy?'cosSigning.pending':finding==='draftChanged'||patientResolved&&unique.every(cosIssueIsWarning)?'cosSigning.issue.draftChanged':unique.length>0&&unique.every(cosIssueIsWarning)?'cosSigning.reviewWarnings':'cosSigning.unsigned')}</p>
  <ul className="review-findings">{unique.map((issue,i)=><li key={JSON.stringify(issue)} className={cosIssueIsWarning(issue)?'warning':'error'}>
   <p role={i===0?'alert':undefined}>{issue.receiverError?cosReceiverIssueMessage(language,issue):message(issue.code)}</p>
   {(issue.elementId||issue.mappingId)&&<p>{[issue.elementId,issue.mappingId].filter(Boolean).join(' · ')}</p>}
   {issue.code==='staff'||issue.code==='staffConflict'?<p>{status.context?.authorName}</p>:null}
   <div className="cos-issue-actions">{actionButton(cosIssueAction(issue),issue)}
    {issue.code==='patientIdentityConflict'&&onCompare&&onApply&&<button type="button"
     disabled={busy||loading||!canCompare||comparison?.canApply===false}
     onClick={()=>{if(comparison){onApply(comparison);setComparison(null);}else void compare(true);}}>
     {loading?t('cosSigning.loadingPatient'):comparison?t('cosSigning.useCos',{name:comparison.displayName}):t('cosSigning.useCosPatient')}
    </button>}
    {issue.code==='patientIdentityConflict'&&comparison?.canApply===false&&<span>{t('cosSigning.editManually')}</span>}
   </div>
   {cosIssueIsWarning(issue)&&<label className="review-acknowledgement">
    <input type="checkbox" checked={acknowledgements.key===acknowledgementKey&&acknowledgements.values[JSON.stringify(issue)]===true}
     disabled={busy} onChange={event=>setAcknowledgements(current=>({key:acknowledgementKey,values:{...(current.key===acknowledgementKey?current.values:{}),[JSON.stringify(issue)]:event.target.checked}}))}/>
    {t('cosSigning.acknowledgeWarning')}
   </label>}
   {cosIssueAction(issue)==='configuration'&&<p>{t('cosSigning.help.configuration')}</p>}
  </li>)}</ul>
  {needsVerification&&onRetry&&<div className="cos-issue-actions"><button type="button" disabled={busy} onClick={onRetry}
   title={t('cosSigning.help.verify')}>{t('cosSigning.action.verify')}</button></div>}
  {editor}
  {finding==='clinicalProjectionIncomplete'&&<button type="button" disabled={busy||!allAcknowledged} onClick={onAcknowledge}>{t('cosSigning.sendAnyway')}</button>}
  {error&&<p role="alert">{error}</p>}{copied&&<p role="status">{t('cosSigning.copied')}</p>}
 </section>;
}
