import type {CosSigningIssue} from '@open-triage/contracts';
import {resolveMessage,type AgencyLanguage} from './localization';

export function cosReceiverIssueMessage(language:AgencyLanguage,issue:CosSigningIssue):string {
 const error=issue.receiverError;
 if(!error)return resolveMessage(language,'cosSigning.unknownIssue');
 const code=['receiverRejected','receiverResponseUncertain'].includes(issue.code)?issue.code:'receiverVerificationFailed';
 return resolveMessage(language,`cosSigning.${code}`,{
  artifact:resolveMessage(language,`cosDelivery.artifact.${issue.artifact}`),status:error.httpStatus,
  reason:error.reason||resolveMessage(language,'cosSigning.receiverReasonUnavailable'),
 });
}
